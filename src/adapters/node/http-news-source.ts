import type {
  NewsSourcePort,
  NewsSourceRequest,
  NewsSourceSnapshot,
  NewsSourceError,
  BoundedNewsSourceRecord
} from "../../ports/news-source.js";
import { HttpRequestError } from "../../ports/http.js";
import type { HttpClient } from "../../ports/http.js";
import type { RetryControl } from "../../ports/retry.js";
import { SystemRetryControl } from "./system-retry.js";
import { acceptBoundedNewsRecord } from "../../domain/news-events/validate.js";

const BASE_BACKOFF_MS = 25;
const MAX_BACKOFF_MS = 400;
const MAX_ALLOWED_ATTEMPTS = 2;

function computeBackoffMs(attempt: number, retryControl: RetryControl): number {
  const base = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  return base + retryControl.jitterUnit() * base;
}

export interface HttpNewsSourceOptions {
  readonly http: HttpClient;
  readonly url: string;
  readonly apiKey?: string;
  readonly source?: "crypto-news-api" | "regulatory-monitor-api";
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly retryControl?: RetryControl;
}

export class HttpNewsSource implements NewsSourcePort {
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryControl: RetryControl;

  constructor(private readonly options: HttpNewsSourceOptions) {
    this.timeoutMs = options.timeoutMs ?? 5000;
    const requestedMax = options.maxAttempts ?? 2;
    this.maxAttempts = Math.min(MAX_ALLOWED_ATTEMPTS, Math.max(1, requestedMax));
    this.retryControl = options.retryControl ?? new SystemRetryControl();
  }

  async collect(request: NewsSourceRequest): Promise<NewsSourceSnapshot> {
    if (request.pair !== "SOL/USDC") {
      throw mapToNewsSourceError(
        new HttpRequestError(
          "invalid_json",
          `Unsupported pair: ${String(request.pair)}`,
          null,
          false
        ),
        this.options.apiKey
      );
    }

    if (this.options.source !== undefined && request.source !== this.options.source) {
      throw mapToNewsSourceError(
        new HttpRequestError(
          "invalid_json",
          `Source mismatch: request source '${request.source}' does not match configured source '${this.options.source}'`,
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

    const url = new URL(this.options.url);
    url.searchParams.set("pair", request.pair);
    url.searchParams.set("source", request.source);
    url.searchParams.set("fromUnixMs", String(request.fromUnixMs));
    url.searchParams.set("toUnixMs", String(request.toUnixMs));

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      try {
        const response = await this.options.http.getJson<unknown>(url.toString(), {
          headers,
          timeoutMs: this.timeoutMs,
          maxAttempts: 1
        });

        return acceptNewsSourceSnapshot(response, request.source);
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
          throw mapToNewsSourceError(httpError, this.options.apiKey);
        }

        await this.retryControl.sleep(computeBackoffMs(attempt, this.retryControl));
      }
    }

    throw mapToNewsSourceError(
      new HttpRequestError("network", lastError ? lastError.message : "Unknown error", null, true),
      this.options.apiKey
    );
  }
}

function mapToNewsSourceError(e: HttpRequestError, apiKey?: string): NewsSourceError {
  const diagnostic = e.message;
  const redactedDiagnostic = apiKey ? diagnostic.split(apiKey).join("[REDACTED]") : diagnostic;

  switch (e.kind) {
    case "timeout":
      return { kind: "timeout", diagnostic: redactedDiagnostic };
    case "network":
      return { kind: "network", diagnostic: redactedDiagnostic };
    case "http_status":
      if (e.status !== null && (e.status === 404 || e.status === 429 || e.status >= 500)) {
        return { kind: "unavailable", diagnostic: redactedDiagnostic };
      }
      if (e.status !== null && e.status >= 400 && e.status < 500) {
        return { kind: "network", diagnostic: redactedDiagnostic };
      }
      return { kind: "network", diagnostic: redactedDiagnostic };
    case "invalid_json":
      return { kind: "malformed", diagnostic: redactedDiagnostic };
    default:
      return { kind: "network", diagnostic: redactedDiagnostic };
  }
}

function acceptNewsSourceSnapshot(response: unknown, requestSource: string): NewsSourceSnapshot {
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
  if (typeof obj.retrievedAtUnixMs !== "number") {
    throw new HttpRequestError("invalid_json", "Missing or invalid retrievedAtUnixMs", null, false);
  }
  if (!Array.isArray(obj.records)) {
    throw new HttpRequestError("invalid_json", "Missing or invalid records", null, false);
  }

  const source = obj.source;
  if (source !== "crypto-news-api" && source !== "regulatory-monitor-api") {
    throw new HttpRequestError("invalid_json", "Missing or invalid source", null, false);
  }
  if (source !== requestSource) {
    throw new HttpRequestError(
      "invalid_json",
      `Source mismatch: expected '${requestSource}', got '${source}'`,
      null,
      false
    );
  }

  const records = obj.records as unknown[];
  const validatedRecords: BoundedNewsSourceRecord[] = [];

  for (const record of records) {
    if (typeof record !== "object" || record === null) {
      throw new HttpRequestError("invalid_json", "Invalid record: not an object", null, false);
    }

    const r = record as Record<string, unknown>;
    const recordInput = {
      ...r,
      source: obj.source,
      providerId: obj.providerId,
      providerRunId: obj.providerRunId,
      retrievedAtUnixMs: obj.retrievedAtUnixMs
    };

    try {
      const validated = acceptBoundedNewsRecord(recordInput);
      validatedRecords.push(validated);
    } catch (e) {
      throw new HttpRequestError(
        "invalid_json",
        `Record validation failed: ${e instanceof Error ? e.message : String(e)}`,
        null,
        false
      );
    }
  }

  const snapshot: NewsSourceSnapshot = {
    source: source as NewsSourceSnapshot["source"],
    providerId: obj.providerId,
    providerRunId: obj.providerRunId,
    retrievedAtUnixMs: obj.retrievedAtUnixMs,
    records: validatedRecords
  };

  return deepFreezeSnapshot(snapshot);
}

function deepFreezeRecord(record: BoundedNewsSourceRecord): BoundedNewsSourceRecord {
  Object.freeze(record.extractedClaims);
  Object.freeze(record.topicTags);
  Object.freeze(record.publisher);
  Object.freeze(record.sourceQuality);
  Object.freeze(record.affectedAssets);
  Object.freeze(record.affectedProtocols);
  Object.freeze(record.affectedJurisdictions);
  Object.freeze(record.sourceReferences);
  Object.freeze(record.rawProvenance);
  return Object.freeze(record);
}

function deepFreezeSnapshot(snapshot: NewsSourceSnapshot): NewsSourceSnapshot {
  snapshot.records.forEach((record) => deepFreezeRecord(record));
  Object.freeze(snapshot.records);
  return Object.freeze(snapshot);
}
