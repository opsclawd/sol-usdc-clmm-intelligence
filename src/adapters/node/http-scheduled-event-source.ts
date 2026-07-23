import type {
  ScheduledEventSourcePort,
  ScheduledEventSourceRequest,
  ScheduledEventSourceSnapshot,
  ScheduledEventSourceError,
  ScheduledEventSourceClaim
} from "../../ports/scheduled-event-source.js";
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

export interface HttpScheduledEventSourceOptions {
  readonly http: HttpClient;
  readonly url: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly retryControl?: RetryControl;
}

export class HttpScheduledEventSource implements ScheduledEventSourcePort {
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryControl: RetryControl;

  constructor(private readonly options: HttpScheduledEventSourceOptions) {
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.maxAttempts = options.maxAttempts ?? 2;
    this.retryControl = options.retryControl ?? new SystemRetryControl();
  }

  async collect(request: ScheduledEventSourceRequest): Promise<ScheduledEventSourceSnapshot> {
    if (request.pair !== "SOL/USDC") {
      throw mapToScheduledEventSourceError(
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
        const url = new URL(this.options.url);
        url.searchParams.set("fromUnixMs", String(request.fromUnixMs));
        url.searchParams.set("toUnixMs", String(request.toUnixMs));
        const response = await this.options.http.getJson<unknown>(url.toString(), {
          headers,
          timeoutMs: this.timeoutMs,
          maxAttempts: 1
        });

        return acceptScheduledEventSnapshot(response);
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
          throw mapToScheduledEventSourceError(httpError, this.options.apiKey);
        }

        await this.retryControl.sleep(computeBackoffMs(attempt, this.retryControl));
      }
    }

    throw mapToScheduledEventSourceError(
      new HttpRequestError("network", lastError ? lastError.message : "Unknown error", null, true),
      this.options.apiKey
    );
  }
}

function mapToScheduledEventSourceError(
  e: HttpRequestError,
  apiKey?: string
): ScheduledEventSourceError {
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

function acceptScheduledEventSnapshot(response: unknown): ScheduledEventSourceSnapshot {
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
  if (!Array.isArray(obj.events)) {
    throw new HttpRequestError("invalid_json", "Missing or invalid events", null, false);
  }

  const events = obj.events as unknown[];
  const validatedEvents: ScheduledEventSourceClaim[] = [];

  for (const event of events) {
    if (typeof event !== "object" || event === null) {
      throw new HttpRequestError("invalid_json", "Invalid event: not an object", null, false);
    }

    const ev = event as Record<string, unknown>;

    if (typeof ev.eventId !== "string") {
      throw new HttpRequestError(
        "invalid_json",
        "Invalid event: missing or invalid eventId",
        null,
        false
      );
    }
    if (typeof ev.eventType !== "string") {
      throw new HttpRequestError(
        "invalid_json",
        "Invalid event: missing or invalid eventType",
        null,
        false
      );
    }
    if (typeof ev.scheduledUnixMs !== "number") {
      throw new HttpRequestError(
        "invalid_json",
        "Invalid event: missing or invalid scheduledUnixMs",
        null,
        false
      );
    }
    if (
      !Array.isArray(ev.sourceReferences) ||
      !ev.sourceReferences.every((s) => typeof s === "string")
    ) {
      throw new HttpRequestError(
        "invalid_json",
        "Invalid event: missing or invalid sourceReferences",
        null,
        false
      );
    }

    validatedEvents.push({
      eventId: ev.eventId,
      eventType: ev.eventType,
      scheduledUnixMs: ev.scheduledUnixMs,
      sourceReferences: ev.sourceReferences as readonly string[]
    });
  }

  return Object.freeze({
    providerId: obj.providerId,
    providerRunId: obj.providerRunId,
    sourceId: obj.sourceId,
    pair: "SOL/USDC",
    asOfUnixMs: obj.asOfUnixMs,
    license: obj.license,
    retention: "bounded" as const,
    confirmationLevel: "explicit" as const,
    events: Object.freeze(validatedEvents)
  });
}
