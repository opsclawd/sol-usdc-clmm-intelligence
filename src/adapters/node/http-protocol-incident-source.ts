import type {
  ProtocolIncidentSourcePort,
  ProtocolIncidentSourceRequest,
  ProtocolIncidentSourceSnapshot,
  ProtocolIncidentSourceError,
  ProtocolIncidentSourceClaim
} from "../../ports/protocol-incident-source.js";
import { HttpRequestError } from "../../ports/http.js";
import type { HttpClient } from "../../ports/http.js";
import type { RetryControl } from "../../ports/retry.js";
import { SystemRetryControl } from "./system-retry.js";

const BASE_BACKOFF_MS = 25;
const MAX_BACKOFF_MS = 400;

function computeBackoffMs(attempt: number, retryControl: RetryControl): number {
  const base = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  return base + retryControl.jitterUnit() * base;
}

export interface HttpProtocolIncidentSourceOptions {
  readonly http: HttpClient;
  readonly url: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly retryControl?: RetryControl;
}

export class HttpProtocolIncidentSource implements ProtocolIncidentSourcePort {
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryControl: RetryControl;

  constructor(private readonly options: HttpProtocolIncidentSourceOptions) {
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.maxAttempts = options.maxAttempts ?? 2;
    this.retryControl = options.retryControl ?? new SystemRetryControl();
  }

  async collect(request: ProtocolIncidentSourceRequest): Promise<ProtocolIncidentSourceSnapshot> {
    if (request.network !== "solana-mainnet") {
      throw mapToProtocolIncidentSourceError(
        new HttpRequestError(
          "invalid_json",
          `Unsupported network: ${String(request.network)}`,
          null,
          false
        ),
        this.options.apiKey
      );
    }

    const headers: Record<string, string> = {};
    if (this.options.apiKey) {
      headers["Authorization"] = `Bearer ${this.options.apiKey}`;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      try {
        const response = await this.options.http.getJson<unknown>(this.options.url, {
          headers,
          timeoutMs: this.timeoutMs,
          maxAttempts: 1
        });

        return acceptProtocolIncidentSnapshot(response);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));

        let httpError: HttpRequestError;

        if (e instanceof DOMException && e.name === "AbortError") {
          httpError = new HttpRequestError("timeout", lastError.message, null, true);
        } else if (e instanceof HttpRequestError) {
          httpError = e;
        } else {
          httpError = new HttpRequestError("network", lastError.message, null, true);
        }

        if (!httpError.retryable || attempt >= this.maxAttempts - 1) {
          throw mapToProtocolIncidentSourceError(httpError, this.options.apiKey);
        }

        await this.retryControl.sleep(computeBackoffMs(attempt, this.retryControl));
      }
    }

    throw mapToProtocolIncidentSourceError(
      new HttpRequestError("network", lastError ? lastError.message : "Unknown error", null, true),
      this.options.apiKey
    );
  }
}

function mapToProtocolIncidentSourceError(
  e: HttpRequestError,
  apiKey?: string
): ProtocolIncidentSourceError {
  const diagnostic = e.message;
  const redactedDiagnostic = apiKey ? diagnostic.split(apiKey).join("[REDACTED]") : diagnostic;

  switch (e.kind) {
    case "timeout":
      return { kind: "timeout", diagnostic: redactedDiagnostic };
    case "network":
    case "http_status":
      if (e.status !== null && (e.status === 404 || e.status === 429 || e.status >= 500)) {
        return { kind: "unavailable", diagnostic: redactedDiagnostic };
      }
      return { kind: "network", diagnostic: redactedDiagnostic };
    case "invalid_json":
      return { kind: "malformed", diagnostic: redactedDiagnostic };
    default:
      return { kind: "network", diagnostic: redactedDiagnostic };
  }
}

function acceptProtocolIncidentSnapshot(response: unknown): ProtocolIncidentSourceSnapshot {
  if (typeof response !== "object" || response === null) {
    throw new HttpRequestError("invalid_json", "Response is not an object", null, false);
  }

  const obj = response as Record<string, unknown>;

  if (typeof obj.providerId !== "string") {
    throw new HttpRequestError("invalid_json", "Missing or invalid providerId", null, false);
  }
  if (typeof obj.providerRunId !== "string") {
    throw new HttpRequestError("invalid_json", "Missing or invalid providerRunId", null, false);
  }
  if (typeof obj.sourceId !== "string") {
    throw new HttpRequestError("invalid_json", "Missing or invalid sourceId", null, false);
  }
  if (typeof obj.asOfUnixMs !== "number") {
    throw new HttpRequestError("invalid_json", "Missing or invalid asOfUnixMs", null, false);
  }
  if (typeof obj.license !== "string" || obj.license.length === 0) {
    throw new HttpRequestError(
      "invalid_json",
      "Missing or invalid license: must be a non-empty string",
      null,
      false
    );
  }
  if (obj.retention !== "bounded") {
    throw new HttpRequestError(
      "invalid_json",
      "Missing or invalid retention: must be 'bounded'",
      null,
      false
    );
  }
  if (obj.confirmationLevel !== "explicit") {
    throw new HttpRequestError(
      "invalid_json",
      "Missing or invalid confirmationLevel: must be 'explicit'",
      null,
      false
    );
  }
  if (!Array.isArray(obj.incidents)) {
    throw new HttpRequestError("invalid_json", "Missing or invalid incidents", null, false);
  }

  const incidents = obj.incidents as unknown[];
  const validatedIncidents: ProtocolIncidentSourceClaim[] = [];

  for (const incident of incidents) {
    if (typeof incident !== "object" || incident === null) {
      throw new HttpRequestError("invalid_json", "Invalid incident: not an object", null, false);
    }

    const inc = incident as Record<string, unknown>;

    if (typeof inc.incidentId !== "string") {
      throw new HttpRequestError(
        "invalid_json",
        "Invalid incident: missing or invalid incidentId",
        null,
        false
      );
    }
    if (typeof inc.incidentType !== "string") {
      throw new HttpRequestError(
        "invalid_json",
        "Invalid incident: missing or invalid incidentType",
        null,
        false
      );
    }
    if (typeof inc.severity !== "string") {
      throw new HttpRequestError(
        "invalid_json",
        "Invalid incident: missing or invalid severity",
        null,
        false
      );
    }
    if (
      !Array.isArray(inc.sourceReferences) ||
      !inc.sourceReferences.every((s) => typeof s === "string")
    ) {
      throw new HttpRequestError(
        "invalid_json",
        "Invalid incident: missing or invalid sourceReferences",
        null,
        false
      );
    }

    validatedIncidents.push({
      incidentId: inc.incidentId,
      incidentType: inc.incidentType,
      severity: inc.severity,
      sourceReferences: inc.sourceReferences as readonly string[]
    });
  }

  return Object.freeze({
    providerId: obj.providerId,
    providerRunId: obj.providerRunId,
    sourceId: obj.sourceId,
    network: "solana-mainnet" as const,
    asOfUnixMs: obj.asOfUnixMs,
    license: obj.license,
    retention: "bounded" as const,
    confirmationLevel: "explicit" as const,
    incidents: Object.freeze(validatedIncidents)
  });
}
