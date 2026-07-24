import type {
  OnChainFlowSourcePort,
  OnChainFlowSourceRequest,
  OnChainFlowSourceSnapshot,
  OnChainFlowSourceError,
  HeliusTransactionFlowEvent
} from "../../ports/on-chain-flow-source.js";
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

export interface HttpHeliusFlowSourceOptions {
  readonly http: HttpClient;
  readonly url: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly retryControl?: RetryControl;
}

export class HttpHeliusFlowSource implements OnChainFlowSourcePort {
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryControl: RetryControl;

  constructor(private readonly options: HttpHeliusFlowSourceOptions) {
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.maxAttempts = options.maxAttempts ?? 2;
    this.retryControl = options.retryControl ?? new SystemRetryControl();
  }

  async collect(request: OnChainFlowSourceRequest): Promise<OnChainFlowSourceSnapshot> {
    if (request.pair !== "SOL/USDC") {
      throw mapToOnChainFlowSourceError(
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

    const url = `${this.options.url}?fromUnixMs=${request.fromUnixMs}&toUnixMs=${request.toUnixMs}`;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      try {
        const response = await this.options.http.getJson<unknown>(url, {
          headers,
          timeoutMs: this.timeoutMs,
          maxAttempts: 1
        });

        return acceptHeliusSnapshot(response);
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
          throw mapToOnChainFlowSourceError(httpError, this.options.apiKey);
        }

        await this.retryControl.sleep(computeBackoffMs(attempt, this.retryControl));
      }
    }

    throw mapToOnChainFlowSourceError(
      new HttpRequestError("network", lastError ? lastError.message : "Unknown error", null, true),
      this.options.apiKey
    );
  }
}

function mapToOnChainFlowSourceError(e: HttpRequestError, apiKey?: string): OnChainFlowSourceError {
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

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function acceptHeliusSnapshot(response: unknown): OnChainFlowSourceSnapshot {
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
  if (typeof obj.asOfUnixMs !== "number") {
    throw new HttpRequestError("invalid_json", "Missing or invalid asOfUnixMs", null, false);
  }
  if (typeof obj.license !== "string") {
    throw new HttpRequestError("invalid_json", "Missing or invalid license", null, false);
  }
  if (!Array.isArray(obj.events)) {
    throw new HttpRequestError("invalid_json", "Missing or invalid events", null, false);
  }

  const events = obj.events as unknown[];
  const validatedEvents: HeliusTransactionFlowEvent[] = [];

  for (const event of events) {
    if (typeof event !== "object" || event === null) {
      throw new HttpRequestError("invalid_json", "Invalid event: not an object", null, false);
    }

    const e = event as Record<string, unknown>;

    if (e.eventKind !== "helius_transaction") {
      throw new HttpRequestError(
        "invalid_json",
        `Invalid event kind: ${String(e.eventKind)}. Helius adapter only accepts helius_transaction events.`,
        null,
        false
      );
    }

    if (typeof e.transactionHash !== "string") {
      throw new HttpRequestError("invalid_json", "Missing or invalid transactionHash", null, false);
    }
    if (typeof e.slot !== "number") {
      throw new HttpRequestError("invalid_json", "Missing or invalid slot", null, false);
    }
    if (typeof e.timestampUnixMs !== "number") {
      throw new HttpRequestError("invalid_json", "Missing or invalid timestampUnixMs", null, false);
    }
    if (e.flowSide !== "buy" && e.flowSide !== "sell") {
      throw new HttpRequestError("invalid_json", "Missing or invalid flowSide", null, false);
    }
    if (typeof e.nativeAmount !== "number" || !isFiniteNumber(e.nativeAmount)) {
      throw new HttpRequestError("invalid_json", "Missing or invalid nativeAmount", null, false);
    }
    if (
      !Array.isArray(e.sourceReferences) ||
      !e.sourceReferences.every((s) => typeof s === "string")
    ) {
      throw new HttpRequestError(
        "invalid_json",
        "Missing or invalid sourceReferences",
        null,
        false
      );
    }

    validatedEvents.push({
      eventKind: "helius_transaction",
      transactionHash: e.transactionHash as string,
      slot: e.slot as number,
      timestampUnixMs: e.timestampUnixMs as number,
      flowSide: e.flowSide as "buy" | "sell",
      nativeAmount: e.nativeAmount as number,
      sourceReferences: e.sourceReferences as readonly string[]
    });
  }

  return Object.freeze({
    source: "helius-api" as const,
    providerId: obj.providerId as string,
    providerRunId: obj.providerRunId as string,
    asOfUnixMs: obj.asOfUnixMs as number,
    license: obj.license as string,
    retention: "bounded" as const,
    events: Object.freeze(validatedEvents)
  });
}
