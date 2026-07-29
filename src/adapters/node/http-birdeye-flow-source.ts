import type {
  OnChainFlowSourcePort,
  OnChainFlowSourceRequest,
  OnChainFlowSourceSnapshot,
  OnChainFlowSourceError,
  BirdeyeWhaleSwapEvent,
  BirdeyeDexNetFlowEvent
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

export interface HttpBirdeyeFlowSourceOptions {
  readonly http: HttpClient;
  readonly url: string;
  readonly apiKey?: string;
  readonly poolAddress: string;
  readonly whaleSwapMinUsdc: string;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly retryControl?: RetryControl;
}

interface BirdeyePairTradeItem {
  txHash: string;
  source: string;
  blockUnixTime: number;
  txType: string;
  address: string;
  owner: string;
  from: {
    symbol: string;
    decimals: number;
    address: string;
    amount: number;
    uiAmount: number;
    price: number;
  };
  to: {
    symbol: string;
    decimals: number;
    address: string;
    amount: number;
    uiAmount: number;
    price: number;
  };
}

interface BirdeyePairTradesResponse {
  data: {
    items: BirdeyePairTradeItem[];
    hasNext: boolean;
  };
  success: boolean;
}

export class HttpBirdeyeFlowSource implements OnChainFlowSourcePort {
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryControl: RetryControl;
  private readonly poolAddress: string;
  private readonly whaleSwapMinUsdc: string;

  constructor(private readonly options: HttpBirdeyeFlowSourceOptions) {
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.maxAttempts = options.maxAttempts ?? 2;
    this.retryControl = options.retryControl ?? new SystemRetryControl();
    this.poolAddress = options.poolAddress;
    this.whaleSwapMinUsdc = options.whaleSwapMinUsdc;
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

    const baseUrl = new URL("/defi/txs/pair", this.options.url);

    const headers: Record<string, string> = {
      "x-chain": "solana"
    };
    if (this.options.apiKey) {
      headers["X-API-Key"] = this.options.apiKey;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      try {
        const url = new URL(baseUrl);
        url.searchParams.set("address", this.poolAddress);
        url.searchParams.set("tx_type", "swap");
        url.searchParams.set("offset", "0");
        url.searchParams.set("limit", "100");
        url.searchParams.set("after_time", String(Math.floor(request.fromUnixMs / 1000)));
        url.searchParams.set("before_time", String(Math.floor(request.toUnixMs / 1000)));

        const response = await this.options.http.getJson<BirdeyePairTradesResponse>(
          url.toString(),
          {
            headers,
            timeoutMs: this.timeoutMs,
            maxAttempts: 1
          }
        );

        return this.acceptBirdeyeSnapshot(response, request);
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

  private acceptBirdeyeSnapshot(
    response: BirdeyePairTradesResponse,
    request: OnChainFlowSourceRequest
  ): OnChainFlowSourceSnapshot {
    if (typeof response !== "object" || response === null) {
      throw new HttpRequestError("invalid_json", "Response is not an object", null, false);
    }

    if (typeof response.success !== "boolean" || response.success !== true) {
      throw new HttpRequestError("invalid_json", "Response success is not true", null, false);
    }

    if (typeof response.data !== "object" || response.data === null) {
      throw new HttpRequestError(
        "invalid_json",
        "Response data is missing or not an object",
        null,
        false
      );
    }

    if (!Array.isArray(response.data.items)) {
      throw new HttpRequestError(
        "invalid_json",
        "Response data.items is not an array",
        null,
        false
      );
    }

    const seenTxHashes = new Set<string>();
    let buyVolumeUsdc = BigInt(0);
    let sellVolumeUsdc = BigInt(0);
    const whaleEvents: BirdeyeWhaleSwapEvent[] = [];

    const USDC_SCALE = 6;
    const whaleMinRaw = parseDecimalStringForBigInt(this.whaleSwapMinUsdc, USDC_SCALE);

    for (const item of response.data.items) {
      if (!this.isValidItem(item)) {
        throw new HttpRequestError("invalid_json", "Invalid item in response", null, false);
      }

      if (seenTxHashes.has(item.txHash)) {
        continue;
      }
      seenTxHashes.add(item.txHash);

      const fromSymbol = item.from.symbol;
      const toSymbol = item.to.symbol;
      const usdcItem = item.to.symbol === "USDC" ? item.to : item.from;
      const usdcAmountRaw = parseDecimalStringForBigInt(String(usdcItem.uiAmount), USDC_SCALE);

      if (fromSymbol === "SOL" && toSymbol === "USDC") {
        sellVolumeUsdc += usdcAmountRaw;

        if (usdcAmountRaw >= whaleMinRaw) {
          whaleEvents.push(
            this.createWhaleSwapEvent(
              item,
              "outbound",
              formatDecimalStringFromBigInt(usdcAmountRaw, USDC_SCALE)
            )
          );
        }
      } else if (fromSymbol === "USDC" && toSymbol === "SOL") {
        buyVolumeUsdc += usdcAmountRaw;

        if (usdcAmountRaw >= whaleMinRaw) {
          whaleEvents.push(
            this.createWhaleSwapEvent(
              item,
              "inbound",
              formatDecimalStringFromBigInt(usdcAmountRaw, USDC_SCALE)
            )
          );
        }
      }
    }

    const netFlowInt = buyVolumeUsdc - sellVolumeUsdc;
    const netFlowIsNegative = netFlowInt < BigInt(0);
    const absoluteNetFlowUsdc = formatDecimalStringFromBigInt(
      netFlowInt < BigInt(0) ? -netFlowInt : netFlowInt,
      USDC_SCALE
    );

    const buyVolumeUsdcStr = formatDecimalStringFromBigInt(buyVolumeUsdc, USDC_SCALE);
    const sellVolumeUsdcStr = formatDecimalStringFromBigInt(sellVolumeUsdc, USDC_SCALE);
    const netFlowUsdcStr = netFlowIsNegative ? "-" + absoluteNetFlowUsdc : absoluteNetFlowUsdc;

    const dexNetFlowEvent: BirdeyeDexNetFlowEvent = {
      eventKind: "dex_net_flow",
      sourceEventId: `birdeye-pair:${this.poolAddress}:${request.fromUnixMs}:${request.toUnixMs}`,
      observedAtUnixMs: request.toUnixMs,
      amountUsdc: absoluteNetFlowUsdc,
      direction: netFlowIsNegative ? "outbound" : "inbound",
      venue: "solana",
      addressContext: { addressType: "contract", address: this.poolAddress },
      sourceReferences: [`${new URL("/defi/txs/pair", this.options.url).toString()}`],
      sourceQuality: { provider: "birdeye-api", freshness: "windowed", completeness: "full" },
      freshnessContext: { blockTimestampUnixMs: request.toUnixMs },
      windowStartUnixMs: request.fromUnixMs,
      windowEndUnixMs: request.toUnixMs,
      buyVolumeUsdc: buyVolumeUsdcStr,
      sellVolumeUsdc: sellVolumeUsdcStr,
      netFlowUsdc: netFlowUsdcStr
    };

    const allEvents: (BirdeyeWhaleSwapEvent | BirdeyeDexNetFlowEvent)[] = [
      dexNetFlowEvent,
      ...whaleEvents
    ];

    return Object.freeze({
      source: "birdeye-api" as const,
      providerId: "birdeye-pair-trades",
      providerRunId: `birdeye-pair:${this.poolAddress}:${request.fromUnixMs}:${request.toUnixMs}`,
      asOfUnixMs: request.toUnixMs,
      license: "Birdeye API",
      retention: "bounded",
      events: Object.freeze(allEvents)
    });
  }

  private isValidItem(item: BirdeyePairTradeItem): boolean {
    if (typeof item !== "object" || item === null) return false;
    if (typeof item.txHash !== "string" || item.txHash.length === 0) return false;
    if (typeof item.owner !== "string" || item.owner.length === 0) return false;
    if (typeof item.blockUnixTime !== "number" || !Number.isFinite(item.blockUnixTime))
      return false;
    if (typeof item.from !== "object" || item.from === null) return false;
    if (typeof item.to !== "object" || item.to === null) return false;
    if (typeof item.from.symbol !== "string") return false;
    if (typeof item.to.symbol !== "string") return false;
    if (typeof item.from.amount !== "number") return false;
    if (typeof item.to.amount !== "number") return false;
    if (typeof item.from.uiAmount !== "number" || !Number.isFinite(item.from.uiAmount))
      return false;
    if (typeof item.to.uiAmount !== "number" || !Number.isFinite(item.to.uiAmount)) return false;
    if (item.from.uiAmount < 0 || item.to.uiAmount < 0) return false;
    const fromSymbol = item.from.symbol;
    const toSymbol = item.to.symbol;
    if (
      !(
        (fromSymbol === "SOL" && toSymbol === "USDC") ||
        (fromSymbol === "USDC" && toSymbol === "SOL")
      )
    ) {
      return false;
    }
    return true;
  }

  private createWhaleSwapEvent(
    item: BirdeyePairTradeItem,
    direction: "inbound" | "outbound",
    amountUsdc: string
  ): BirdeyeWhaleSwapEvent {
    return {
      eventKind: "whale_swap",
      sourceEventId: item.txHash,
      observedAtUnixMs: item.blockUnixTime * 1000,
      amountUsdc: amountUsdc,
      direction: direction,
      venue: "solana",
      addressContext: { addressType: "wallet", address: item.owner },
      sourceReferences: [`https://solscan.io/tx/${item.txHash}`],
      sourceQuality: { provider: "birdeye-api", freshness: "windowed", completeness: "full" },
      freshnessContext: { blockTimestampUnixMs: item.blockUnixTime * 1000 },
      transactionSignature: item.txHash,
      eventIndex: 0,
      stablecoinOperation: "transfer"
    };
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

function toPlainDecimalString(value: string): string {
  if (!value.includes("e") && !value.includes("E")) {
    return value;
  }
  const parts = value.split(/[eE]/);
  const mantissa = parts[0];
  const expStr = parts[1];
  if (!mantissa || expStr === undefined) return value;

  const exp = parseInt(expStr, 10);
  if (Number.isNaN(exp)) return value;

  const sign = mantissa.startsWith("-") ? "-" : "";
  const absMantissa = sign ? mantissa.slice(1) : mantissa;
  const [intPart = "", fracPart = ""] = absMantissa.split(".");

  if (exp === 0) {
    return sign + intPart + (fracPart ? "." + fracPart : "");
  } else if (exp > 0) {
    if (exp >= fracPart.length) {
      return sign + intPart + fracPart + "0".repeat(exp - fracPart.length);
    } else {
      return sign + intPart + fracPart.slice(0, exp) + "." + fracPart.slice(exp);
    }
  } else {
    const absExp = -exp;
    if (absExp <= intPart.length) {
      const splitIdx = intPart.length - absExp;
      const newInt = intPart.slice(0, splitIdx) || "0";
      const newFrac = intPart.slice(splitIdx) + fracPart;
      return sign + newInt + "." + newFrac;
    } else {
      const zeros = "0".repeat(absExp - intPart.length);
      return sign + "0." + zeros + intPart + fracPart;
    }
  }
}

function parseDecimalStringForBigInt(value: string, targetScale: number): bigint {
  const plain = toPlainDecimalString(value);
  const isNegative = plain.startsWith("-");
  const absValue = isNegative ? plain.slice(1) : plain;
  const dotIndex = absValue.indexOf(".");
  let digits: string;
  let scale: number;

  if (dotIndex === -1) {
    digits = absValue;
    scale = 0;
  } else {
    const intPart = absValue.slice(0, dotIndex);
    const fracPart = absValue.slice(dotIndex + 1);
    digits = intPart + fracPart;
    scale = fracPart.length;
  }

  let adjustedDigits: string;
  if (scale > targetScale) {
    const overflow = scale - targetScale;
    adjustedDigits = digits.slice(0, digits.length - overflow);
  } else {
    adjustedDigits = digits + "0".repeat(targetScale - scale);
  }

  if (adjustedDigits === "" || adjustedDigits === "-") {
    return BigInt(0);
  }

  const result = BigInt(adjustedDigits);
  return isNegative ? -result : result;
}

function formatDecimalStringFromBigInt(value: bigint, scale: number): string {
  if (value === BigInt(0)) return "0";
  const isNegative = value < BigInt(0);
  const absValue = isNegative ? -value : value;
  const absStr = absValue.toString();
  const padded = absStr.padStart(scale + 1, "0");
  const intPart = padded.slice(0, -scale) || "0";
  const fracPart = padded.slice(-scale);
  const result = intPart + (scale > 0 ? "." + fracPart : "");
  const trimmed = result.replace(/\.?0+$/, "");
  return isNegative ? "-" + trimmed : trimmed;
}
