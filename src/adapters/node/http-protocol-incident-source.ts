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
import type { Clock } from "../../ports/clock.js";
import type { RunIdFactory } from "../../ports/run-id.js";
import { SystemRetryControl } from "./system-retry.js";
import { SystemClock } from "./system-clock.js";
import { UuidRunIdFactory } from "./uuid-run-id-factory.js";

const STATUSPAGE_INCIDENTS_PATH = "/api/v2/incidents.json";
const PROVIDER_ID = "solana-status-api";
const SOURCE_ID = "solana-status-incidents";
const LICENSE = "MIT";

const BASE_BACKOFF_MS = 25;
const MAX_BACKOFF_MS = 400;

function computeBackoffMs(attempt: number, retryControl: RetryControl): number {
  const base = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  return base + retryControl.jitterUnit() * base;
}

function buildIncidentsUrl(baseUrl: string): string {
  const cleanUrl = baseUrl.replace(/\/+$/, "");
  if (cleanUrl.endsWith(STATUSPAGE_INCIDENTS_PATH) || cleanUrl.endsWith("/incidents.json")) {
    return cleanUrl;
  }
  return `${cleanUrl}${STATUSPAGE_INCIDENTS_PATH}`;
}

function mapImpact(impact: unknown): ProtocolIncidentSourceClaim["severity"] {
  switch (impact) {
    case "critical":
      return "CRITICAL";
    case "major":
      return "HIGH";
    case "minor":
      return "MEDIUM";
    case "none":
    case "maintenance":
      return "LOW";
    default:
      throw new HttpRequestError(
        "invalid_json",
        "Invalid incident: missing or unsupported impact",
        null,
        false
      );
  }
}

export interface HttpProtocolIncidentSourceOptions {
  readonly http: HttpClient;
  readonly url: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly retryControl?: RetryControl;
  readonly clock?: Clock;
  readonly runIdFactory?: RunIdFactory;
}

export class HttpProtocolIncidentSource implements ProtocolIncidentSourcePort {
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryControl: RetryControl;
  private readonly clock: Clock;
  private readonly runIdFactory: RunIdFactory;

  constructor(private readonly options: HttpProtocolIncidentSourceOptions) {
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.maxAttempts = options.maxAttempts ?? 2;
    this.retryControl = options.retryControl ?? new SystemRetryControl();
    this.clock = options.clock ?? new SystemClock();
    this.runIdFactory = options.runIdFactory ?? new UuidRunIdFactory();
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

    const headers: Record<string, string> = {
      "User-Agent": "solana-clmm-intelligence/1.0"
    };
    if (this.options.apiKey) {
      headers["Authorization"] = `Bearer ${this.options.apiKey}`;
    }

    const targetUrl = buildIncidentsUrl(this.options.url);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      try {
        const response = await this.options.http.getJson<unknown>(targetUrl, {
          headers,
          timeoutMs: this.timeoutMs,
          maxAttempts: 1
        });

        return acceptStatuspageResponse(response, this.clock, this.runIdFactory);
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

        const isRetryable =
          httpError.retryable ||
          httpError.kind === "network" ||
          httpError.kind === "timeout" ||
          (httpError.status !== null &&
            (httpError.status === 408 || httpError.status === 429 || httpError.status >= 500));

        if (!isRetryable || attempt >= this.maxAttempts - 1) {
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

function extractTimestampMs(val: unknown): number | null {
  if (typeof val === "string" && val.length > 0) {
    const ms = Date.parse(val);
    if (!isNaN(ms)) {
      return ms;
    }
  }
  return null;
}

function extractAsOfUnixMs(obj: Record<string, unknown>, clock: Clock): number {
  const timestamps: number[] = [];

  if (typeof obj.page === "object" && obj.page !== null) {
    const page = obj.page as Record<string, unknown>;
    const pageTs = extractTimestampMs(page.updated_at);
    if (pageTs !== null) {
      timestamps.push(pageTs);
    }
  }

  if (Array.isArray(obj.incidents)) {
    for (const incident of obj.incidents) {
      if (typeof incident === "object" && incident !== null) {
        const inc = incident as Record<string, unknown>;
        for (const key of ["updated_at", "resolved_at", "created_at", "started_at"]) {
          const ts = extractTimestampMs(inc[key]);
          if (ts !== null) {
            timestamps.push(ts);
          }
        }
        if (Array.isArray(inc.incident_updates)) {
          for (const update of inc.incident_updates) {
            if (typeof update === "object" && update !== null) {
              const upd = update as Record<string, unknown>;
              for (const key of ["created_at", "updated_at", "display_at"]) {
                const ts = extractTimestampMs(upd[key]);
                if (ts !== null) {
                  timestamps.push(ts);
                }
              }
            }
          }
        }
      }
    }
  }

  if (timestamps.length > 0) {
    return Math.max(...timestamps);
  }

  const clockNowMs = Date.parse(clock.now());
  return isNaN(clockNowMs) ? Date.now() : clockNowMs;
}

function acceptStatuspageResponse(
  response: unknown,
  clock: Clock,
  runIdFactory: RunIdFactory
): ProtocolIncidentSourceSnapshot {
  if (typeof response !== "object" || response === null) {
    throw new HttpRequestError("invalid_json", "Response is not an object", null, false);
  }

  const obj = response as Record<string, unknown>;

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

    if (typeof inc.id !== "string" || inc.id.length === 0) {
      throw new HttpRequestError(
        "invalid_json",
        "Invalid incident: missing or invalid id",
        null,
        false
      );
    }
    if (typeof inc.name !== "string" || inc.name.length === 0) {
      throw new HttpRequestError(
        "invalid_json",
        "Invalid incident: missing or invalid name",
        null,
        false
      );
    }
    if (typeof inc.shortlink !== "string" || inc.shortlink.length === 0) {
      throw new HttpRequestError(
        "invalid_json",
        "Invalid incident: missing or invalid shortlink",
        null,
        false
      );
    }

    const severity = mapImpact(inc.impact);

    validatedIncidents.push({
      incidentId: inc.id,
      incidentType: inc.name,
      severity,
      sourceReferences: [inc.shortlink]
    });
  }

  return Object.freeze({
    providerId: PROVIDER_ID,
    providerRunId: runIdFactory.nextRunId(),
    sourceId: SOURCE_ID,
    network: "solana-mainnet" as const,
    asOfUnixMs: extractAsOfUnixMs(obj, clock),
    license: LICENSE,
    retention: "bounded" as const,
    confirmationLevel: "explicit" as const,
    incidents: Object.freeze(validatedIncidents)
  });
}
