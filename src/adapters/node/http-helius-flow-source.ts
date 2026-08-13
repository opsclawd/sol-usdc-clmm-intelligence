import type {
  OnChainFlowSourcePort,
  OnChainFlowSourceRequest,
  OnChainFlowSourceSnapshot,
  OnChainFlowSourceError,
  HeliusDexNetFlowEvent
} from "../../ports/on-chain-flow-source.js";
import { HttpRequestError } from "../../ports/http.js";
import type { HttpClient } from "../../ports/http.js";
import type { RetryControl } from "../../ports/retry.js";
import { SystemRetryControl } from "./system-retry.js";

const BASE_BACKOFF_MS = 25;
const MAX_BACKOFF_MS = 400;
const LIMIT_PARAM = 100;
// The whirlpool produces roughly 750 transactions per 15-minute lookback, so a
// single page covers only seconds. Walk back with Helius's `before` signature
// cursor until the page reaches past `fromUnixMs`. Measured live: 8 pages
// covered 27.7 minutes, so 25 pages leaves headroom for activity spikes without
// letting a runaway pool drain the API budget.
const MAX_PAGES = 25;
const CANONICAL_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

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

interface HeliusRawTransaction {
  signature: string;
  slot: number;
  timestamp: number;
  type: string;
  nativeTransfers: Array<{ amount: number }>;
  tokenTransfers: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    mint: string;
    tokenAmount: number;
  }>;
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

    const walletAddress = request.walletAddress;
    if (!walletAddress) {
      throw mapToOnChainFlowSourceError(
        new HttpRequestError("invalid_json", "walletAddress is required", null, false),
        this.options.apiKey
      );
    }

    const encodedWallet = encodeURIComponent(walletAddress);
    const baseUrl = `${this.options.url}/v0/addresses/${encodedWallet}/transactions`;

    const headers: Record<string, string> = {};

    const allTransactions: HeliusRawTransaction[] = [];
    const seenSignatures = new Set<string>();
    let beforeSignature: string | undefined;
    let coveredLookback = false;

    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(baseUrl);
      if (this.options.apiKey) {
        url.searchParams.set("api-key", this.options.apiKey);
      }
      url.searchParams.set("limit", String(LIMIT_PARAM));
      if (beforeSignature !== undefined) {
        url.searchParams.set("before", beforeSignature);
      }

      let lastError: Error | null = null;
      let pageTransactions: HeliusRawTransaction[] | null = null;

      for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
        try {
          const response = await this.options.http.getJson<unknown>(url.toString(), {
            headers,
            timeoutMs: this.timeoutMs,
            maxAttempts: 1
          });
          pageTransactions = parseHeliusTransactionPage(response);
          break;
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

      if (pageTransactions === null) {
        throw mapToOnChainFlowSourceError(
          new HttpRequestError(
            "network",
            lastError ? lastError.message : "Unknown error",
            null,
            true
          ),
          this.options.apiKey
        );
      }

      // `before` is exclusive, but dedupe defensively so a provider repeat
      // cannot duplicate an observation or spin the cursor in place.
      let lastSignature: string | undefined;
      for (const tx of pageTransactions) {
        if (typeof tx.signature === "string" && tx.signature.length > 0) {
          lastSignature = tx.signature;
          if (seenSignatures.has(tx.signature)) continue;
          seenSignatures.add(tx.signature);
        }
        allTransactions.push(tx);
      }

      // A short page means the address history is exhausted.
      if (pageTransactions.length < LIMIT_PARAM) {
        coveredLookback = true;
        break;
      }

      const oldestTimestampMs = getOldestTransactionTimestampMs(pageTransactions);
      if (oldestTimestampMs !== undefined && oldestTimestampMs <= request.fromUnixMs) {
        coveredLookback = true;
        break;
      }

      if (lastSignature === undefined) {
        // No usable cursor to advance with; stop rather than refetch page 1.
        break;
      }
      beforeSignature = lastSignature;
    }

    // Reaching the page cap means the window is only partly observed. Report it
    // rather than presenting a truncated view as a complete one.
    const completeness: "full" | "partial" = coveredLookback ? "full" : "partial";
    const allEvents = aggregateTransactionsToNetFlow(
      allTransactions,
      walletAddress,
      request,
      completeness,
      this.options.url
    );

    const providerRunId = `helius-address-history:${walletAddress}:${request.fromUnixMs}:${request.toUnixMs}`;

    return Object.freeze({
      source: "helius-api" as const,
      providerId: "helius-address-history",
      providerRunId,
      asOfUnixMs: request.toUnixMs,
      license: "Helius API",
      retention: "bounded",
      events: Object.freeze(allEvents)
    });
  }
}

function redactApiKey(diagnostic: string, apiKey?: string): string {
  let redacted = diagnostic;
  if (apiKey && apiKey.length > 0) {
    redacted = redacted.split(apiKey).join("[REDACTED]");
    const encodedKey = encodeURIComponent(apiKey);
    if (encodedKey !== apiKey) {
      redacted = redacted.split(encodedKey).join("[REDACTED]");
    }
  }
  redacted = redacted.replace(/([?&]api-?key=)([^&\s"']+)/gi, "$1[REDACTED]");
  return redacted;
}

function getOldestTransactionTimestampMs(transactions: HeliusRawTransaction[]): number | undefined {
  let oldestMs: number | undefined;
  for (const tx of transactions) {
    if (
      typeof tx === "object" &&
      tx !== null &&
      typeof tx.timestamp === "number" &&
      Number.isInteger(tx.timestamp)
    ) {
      const txMs = tx.timestamp * 1000;
      if (oldestMs === undefined || txMs < oldestMs) {
        oldestMs = txMs;
      }
    }
  }
  return oldestMs;
}

function mapToOnChainFlowSourceError(e: HttpRequestError, apiKey?: string): OnChainFlowSourceError {
  const redactedDiagnostic = redactApiKey(e.message, apiKey);

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

function parseHeliusTransactionPage(response: unknown): HeliusRawTransaction[] {
  if (!Array.isArray(response)) {
    throw new HttpRequestError("invalid_json", "Response is not an array", null, false);
  }
  return response as HeliusRawTransaction[];
}

function parseUsdcAmountToRaw(tokenAmount: unknown): bigint | null {
  if (tokenAmount === null || tokenAmount === undefined) return null;
  const str = String(tokenAmount);
  if (!/^\d+(\.\d{1,6})?$/.test(str)) return null;
  const [intPart, fracPart = ""] = str.split(".");
  const paddedFrac = fracPart.padEnd(6, "0");
  return BigInt(intPart + paddedFrac);
}

function formatUsdc(raw: bigint): string {
  if (raw === 0n) return "0";
  const rawStr = raw.toString().padStart(7, "0");
  const intPart = rawStr.slice(0, rawStr.length - 6);
  const fracPart = rawStr.slice(rawStr.length - 6).replace(/0+$/, "");
  return fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart;
}

function aggregateTransactionsToNetFlow(
  transactions: HeliusRawTransaction[],
  poolAddress: string,
  request: OnChainFlowSourceRequest,
  completeness: "full" | "partial",
  baseUrl: string
): readonly [HeliusDexNetFlowEvent] {
  let buyRaw = 0n;
  let sellRaw = 0n;

  for (const tx of transactions) {
    if (typeof tx !== "object" || tx === null) continue;
    if (typeof tx.signature !== "string" || tx.signature.length === 0) continue;
    if (typeof tx.slot !== "number" || !Number.isInteger(tx.slot) || tx.slot < 0) continue;
    if (typeof tx.timestamp !== "number" || !Number.isInteger(tx.timestamp)) continue;

    const txMs = tx.timestamp * 1000;
    if (txMs < request.fromUnixMs || txMs > request.toUnixMs) continue;

    if (!Array.isArray(tx.tokenTransfers)) continue;

    for (const transfer of tx.tokenTransfers) {
      if (typeof transfer !== "object" || transfer === null) continue;
      if (typeof transfer.mint !== "string" || transfer.mint !== CANONICAL_USDC_MINT) continue;

      const isInbound = transfer.toUserAccount === poolAddress;
      const isOutbound = transfer.fromUserAccount === poolAddress;

      if ((!isInbound && !isOutbound) || (isInbound && isOutbound)) continue;

      const usdcRaw = parseUsdcAmountToRaw(transfer.tokenAmount);
      if (usdcRaw === null) continue;

      if (isInbound) {
        buyRaw += usdcRaw;
      } else {
        sellRaw += usdcRaw;
      }
    }
  }

  const netRaw = buyRaw - sellRaw;
  const absoluteNetRaw = netRaw < 0n ? -netRaw : netRaw;

  const event: HeliusDexNetFlowEvent = Object.freeze({
    eventKind: "dex_net_flow",
    sourceEventId: `helius-address-history:${poolAddress}:${request.fromUnixMs}:${request.toUnixMs}`,
    observedAtUnixMs: request.toUnixMs,
    amountUsdc: formatUsdc(absoluteNetRaw),
    direction: netRaw < 0n ? "outbound" : "inbound",
    venue: "solana",
    addressContext: { addressType: "contract" as const, address: poolAddress },
    sourceReferences: [
      new URL(`/v0/addresses/${encodeURIComponent(poolAddress)}/transactions`, baseUrl).toString()
    ],
    sourceQuality: {
      provider: "helius-api" as const,
      freshness: "windowed" as const,
      completeness
    },
    freshnessContext: { blockTimestampUnixMs: request.toUnixMs },
    windowStartUnixMs: request.fromUnixMs,
    windowEndUnixMs: request.toUnixMs,
    buyVolumeUsdc: formatUsdc(buyRaw),
    sellVolumeUsdc: formatUsdc(sellRaw),
    netFlowUsdc: `${netRaw < 0n ? "-" : ""}${formatUsdc(absoluteNetRaw)}`
  });

  return Object.freeze([event]);
}
