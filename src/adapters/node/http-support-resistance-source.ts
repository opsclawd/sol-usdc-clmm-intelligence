import type {
  SupportResistanceSourcePort,
  SupportResistanceSourceRequest,
  SupportResistanceSourceSnapshot,
  SupportResistanceSourceError,
  SupportResistanceSourceClaim
} from "../../ports/support-resistance-source.js";
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

export interface HttpSupportResistanceSourceOptions {
  readonly http: HttpClient;
  readonly url: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly retryControl?: RetryControl;
}

export class HttpSupportResistanceSource implements SupportResistanceSourcePort {
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryControl: RetryControl;

  constructor(private readonly options: HttpSupportResistanceSourceOptions) {
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.maxAttempts = options.maxAttempts ?? 2;
    this.retryControl = options.retryControl ?? new SystemRetryControl();
  }

  async collect(request: SupportResistanceSourceRequest): Promise<SupportResistanceSourceSnapshot> {
    if (request.pair !== "SOL/USDC") {
      throw mapToSupportResistanceSourceError(
        new HttpRequestError(
          "invalid_json",
          `Unsupported pair: ${String(request.pair)}`,
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

        return acceptSupportResistanceSnapshot(response);
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
          throw mapToSupportResistanceSourceError(httpError, this.options.apiKey);
        }

        await this.retryControl.sleep(computeBackoffMs(attempt, this.retryControl));
      }
    }

    throw mapToSupportResistanceSourceError(
      new HttpRequestError("network", lastError ? lastError.message : "Unknown error", null, true),
      this.options.apiKey
    );
  }
}

function mapToSupportResistanceSourceError(
  e: HttpRequestError,
  apiKey?: string
): SupportResistanceSourceError {
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

function acceptSupportResistanceSnapshot(response: unknown): SupportResistanceSourceSnapshot {
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
  if (obj.pair !== "SOL/USDC") {
    throw new HttpRequestError("invalid_json", "Missing or invalid pair", null, false);
  }
  if (typeof obj.asOfUnixMs !== "number") {
    throw new HttpRequestError("invalid_json", "Missing or invalid asOfUnixMs", null, false);
  }
  if (!Array.isArray(obj.claims)) {
    throw new HttpRequestError("invalid_json", "Missing or invalid claims", null, false);
  }

  const claims = obj.claims as unknown[];
  const validatedClaims: SupportResistanceSourceClaim[] = [];

  for (const claim of claims) {
    if (typeof claim !== "object" || claim === null) {
      throw new HttpRequestError("invalid_json", "Invalid claim: not an object", null, false);
    }

    const c = claim as Record<string, unknown>;

    if (c.levelType !== "point" && c.levelType !== "zone") {
      throw new HttpRequestError(
        "invalid_json",
        "Invalid claim: missing or invalid levelType",
        null,
        false
      );
    }
    if (c.evidenceSide !== "SUPPORT" && c.evidenceSide !== "RESISTANCE") {
      throw new HttpRequestError(
        "invalid_json",
        "Invalid claim: missing or invalid evidenceSide",
        null,
        false
      );
    }
    if (typeof c.timeframe !== "string") {
      throw new HttpRequestError(
        "invalid_json",
        "Invalid claim: missing or invalid timeframe",
        null,
        false
      );
    }
    if (
      !Array.isArray(c.sourceReferences) ||
      !c.sourceReferences.every((s) => typeof s === "string")
    ) {
      throw new HttpRequestError(
        "invalid_json",
        "Invalid claim: missing or invalid sourceReferences",
        null,
        false
      );
    }

    if (c.levelType === "point") {
      if (typeof c.levelUsdcPerSol !== "number") {
        throw new HttpRequestError(
          "invalid_json",
          "Invalid point claim: missing levelUsdcPerSol",
          null,
          false
        );
      }
      validatedClaims.push({
        levelType: "point",
        levelUsdcPerSol: c.levelUsdcPerSol,
        evidenceSide: c.evidenceSide as "SUPPORT" | "RESISTANCE",
        timeframe: c.timeframe as string,
        sourceReferences: c.sourceReferences as readonly string[]
      });
    } else {
      if (typeof c.zoneLowerUsdcPerSol !== "number" || typeof c.zoneUpperUsdcPerSol !== "number") {
        throw new HttpRequestError(
          "invalid_json",
          "Invalid zone claim: missing zone bounds",
          null,
          false
        );
      }
      validatedClaims.push({
        levelType: "zone",
        zoneLowerUsdcPerSol: c.zoneLowerUsdcPerSol,
        zoneUpperUsdcPerSol: c.zoneUpperUsdcPerSol,
        evidenceSide: c.evidenceSide as "SUPPORT" | "RESISTANCE",
        timeframe: c.timeframe as string,
        sourceReferences: c.sourceReferences as readonly string[]
      });
    }
  }

  return Object.freeze({
    providerId: obj.providerId,
    providerRunId: obj.providerRunId,
    pair: "SOL/USDC",
    asOfUnixMs: obj.asOfUnixMs,
    claims: Object.freeze(validatedClaims)
  });
}
