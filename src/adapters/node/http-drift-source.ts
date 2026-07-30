import type { HttpClient } from "../../ports/http.js";
import { HttpRequestError } from "../../ports/http.js";
import type { RetryControl } from "../../ports/retry.js";
import { SystemRetryControl } from "./system-retry.js";
import type {
  PerpLiquidationSourceFact,
  PerpLiquidationSourcePort,
  PerpLiquidationSourceRequest,
  PerpLiquidationSourceSnapshot,
  PerpMetricCoverage
} from "../../ports/perp-liquidation-source.js";
import type {
  FundingRatePayloadV1,
  LeverageProxyPayloadV1,
  LiquidationEventPayloadV1,
  OpenInterestPayloadV1,
  PerpBasisPayloadV1,
  PerpObservationKind
} from "../../contracts/perp-liquidation.js";
import {
  add,
  divide,
  multiply,
  parseDecimal,
  type Rational
} from "../../domain/derived-feature/decimal.js";

export interface DriftPrecisions {
  readonly basePrecisionExp?: number;
  readonly quotePrecisionExp?: number;
  readonly pricePrecisionExp?: number;
}

export interface HttpDriftSourceConfig {
  readonly baseUrl: string;
  readonly symbol: string;
  readonly marketIndex: number;
  readonly http: HttpClient;
  readonly retry?: RetryControl;
  readonly maxAttempts?: number;
  readonly precisions?: DriftPrecisions;
}

const BASE_BACKOFF_MS = 25;
const MAX_BACKOFF_MS = 400;

function computeBackoffMs(attempt: number, retryControl: RetryControl): number {
  const base = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  return base + retryControl.jitterUnit() * base;
}

function sanitizeDiagnostic(str: string): string {
  return str.replace(/(?:key|secret|token|password)=[^&\s]+/gi, "[REDACTED]");
}

function isValidDecimalString(val: unknown): val is string {
  if (typeof val !== "string") return false;
  if (val === "" || val.trim() !== val) return false;
  if (/[eE]/.test(val)) return false;
  if (val === "NaN" || val === "Infinity" || val === "-Infinity") return false;
  const num = Number(val);
  return Number.isFinite(num) && !Number.isNaN(num);
}

function isPositiveDecimalString(val: unknown): val is string {
  if (!isValidDecimalString(val)) return false;
  return Number(val) > 0;
}

function normalizeTimestamp(ts: unknown): number | null {
  let num: number | null = null;
  if (typeof ts === "number" && Number.isFinite(ts)) {
    num = ts;
  } else if (typeof ts === "string" && isValidDecimalString(ts)) {
    num = Number(ts);
  }
  if (num === null || !Number.isInteger(num) || num < 0) return null;
  return num < 1e11 ? num * 1000 : num;
}

function absDecimal(val: string): string {
  if (val.startsWith("-") || val.startsWith("+")) {
    return val.slice(1);
  }
  return val;
}

function rationalToString(r: Rational): string {
  if (r.denominator === 1n) {
    return r.numerator.toString();
  }
  const isNeg = r.numerator < 0n;
  const absNum = isNeg ? -r.numerator : r.numerator;
  const absDen = r.denominator;
  const intPart = absNum / absDen;
  const rem = absNum % absDen;
  if (rem === 0n) {
    return (isNeg ? "-" : "") + intPart.toString();
  }

  let scale = 0;
  let tempDen = absDen;
  while (tempDen % 10n === 0n && tempDen > 1n) {
    scale++;
    tempDen /= 10n;
  }
  if (tempDen === 1n) {
    const fracStr = rem.toString().padStart(scale, "0");
    return `${isNeg ? "-" : ""}${intPart.toString()}.${fracStr}`;
  }

  const fracDigits = 12;
  const scaledNum = (absNum * 10n ** BigInt(fracDigits)) / absDen;
  const scaledInt = scaledNum / 10n ** BigInt(fracDigits);
  const scaledFrac = (scaledNum % 10n ** BigInt(fracDigits))
    .toString()
    .padStart(fracDigits, "0")
    .replace(/0+$/, "");
  if (scaledFrac === "") {
    return `${isNeg ? "-" : ""}${scaledInt.toString()}`;
  }
  return `${isNeg ? "-" : ""}${scaledInt.toString()}.${scaledFrac}`;
}

function addDecimals(aStr: string, bStr: string): string | null {
  const rA = parseDecimal(aStr);
  const rB = parseDecimal(bStr);
  if (typeof rA === "string" || typeof rB === "string") return null;
  const sum = add(rA, rB);
  return rationalToString(sum);
}

function multiplyDecimals(aStr: string, bStr: string): string | null {
  const rA = parseDecimal(aStr);
  const rB = parseDecimal(bStr);
  if (typeof rA === "string" || typeof rB === "string") return null;
  const prod = multiply(rA, rB);
  return rationalToString(prod);
}

function divideDecimals(aStr: string, bStr: string): string | null {
  const rA = parseDecimal(aStr);
  const rB = parseDecimal(bStr);
  if (typeof rA === "string" || typeof rB === "string") return null;
  const quot = divide(rA, rB);
  if (typeof quot === "string") return null;
  return rationalToString(quot);
}

export class HttpDriftSource implements PerpLiquidationSourcePort {
  private readonly baseUrl: string;
  private readonly symbol: string;
  private readonly marketIndex: number;
  private readonly http: HttpClient;
  private readonly retryControl: RetryControl;
  private readonly maxAttempts: number;

  constructor(config: HttpDriftSourceConfig) {
    this.baseUrl = config.baseUrl;
    this.symbol = config.symbol;
    this.marketIndex = config.marketIndex;
    this.http = config.http;
    this.retryControl = config.retry ?? new SystemRetryControl();
    this.maxAttempts = config.maxAttempts ?? 2;
  }

  private async fetchWithRetry<T>(url: string): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      try {
        return await this.http.getJson<T>(url);
      } catch (e: unknown) {
        lastError = e instanceof Error ? e : new Error(String(e));
        let retryable = true;
        let isMalformed = false;

        if (e instanceof HttpRequestError) {
          retryable = e.retryable;
          if (e.kind === "invalid_json") {
            isMalformed = true;
          }
        }

        if (isMalformed || !retryable || attempt >= this.maxAttempts - 1) {
          throw lastError;
        }
        await this.retryControl.sleep(computeBackoffMs(attempt, this.retryControl));
      }
    }
    throw lastError ?? new Error(`Failed to fetch ${url}`);
  }

  private async fetchFundingRates(
    request: PerpLiquidationSourceRequest
  ): Promise<{ coverage: PerpMetricCoverage; facts: PerpLiquidationSourceFact[] }> {
    let coverage: PerpMetricCoverage = {
      kind: "funding_rate",
      status: "unavailable",
      diagnostic: "Not collected"
    };
    const facts: PerpLiquidationSourceFact[] = [];

    try {
      const url = `${this.baseUrl}/market/${encodeURIComponent(this.symbol)}/fundingRates`;
      const res = await this.fetchWithRetry<unknown>(url);
      if (
        typeof res !== "object" ||
        res === null ||
        !Array.isArray((res as Record<string, unknown>).records)
      ) {
        coverage = {
          kind: "funding_rate",
          status: "malformed",
          diagnostic: "Expected object with records array from fundingRates endpoint"
        };
      } else {
        const records = (res as Record<string, unknown>).records as unknown[];
        const fundingFacts: PerpLiquidationSourceFact[] = [];
        for (const item of records) {
          if (typeof item === "object" && item !== null) {
            const row = item as Record<string, unknown>;
            const rawId = row.id ?? row.recordId;
            const idStr = rawId !== undefined && rawId !== null ? String(rawId) : "";
            const tsMs = normalizeTimestamp(row.ts ?? row.timestamp ?? row.observedAtUnixMs);
            const fundingRateStr = row.fundingRate ?? row.rate;

            if (idStr !== "" && tsMs !== null && isValidDecimalString(fundingRateStr)) {
              const payload: FundingRatePayloadV1 = {
                schemaVersion: 1,
                evidenceFamily: "perp_liquidation",
                pair: request.pair,
                venue: "drift-api",
                instrument: this.symbol,
                sourceEventId: `drift-funding-${idStr}`,
                observedAtUnixMs: tsMs,
                kind: "funding_rate",
                fundingRate: fundingRateStr,
                fundingIntervalHours: 1
              };
              fundingFacts.push({ venue: "drift-api", kind: "funding_rate", payload });
            }
          }
        }
        coverage = { kind: "funding_rate", status: "available" };
        facts.push(...fundingFacts);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      coverage = {
        kind: "funding_rate",
        status:
          msg.includes("Expected") || msg.includes("SyntaxError") ? "malformed" : "unavailable",
        diagnostic: sanitizeDiagnostic(msg)
      };
    }

    return { coverage, facts };
  }

  private async fetchMarketStats(
    request: PerpLiquidationSourceRequest,
    asOfUnixMs: number
  ): Promise<{
    oiCoverage: PerpMetricCoverage;
    basisCoverage: PerpMetricCoverage;
    leverageCoverage: PerpMetricCoverage;
    facts: PerpLiquidationSourceFact[];
  }> {
    let oiCoverage: PerpMetricCoverage = {
      kind: "open_interest",
      status: "unavailable",
      diagnostic: "Not collected"
    };
    let basisCoverage: PerpMetricCoverage = {
      kind: "perp_basis",
      status: "unavailable",
      diagnostic: "Not collected"
    };
    let leverageCoverage: PerpMetricCoverage = {
      kind: "leverage_proxy",
      status: "unavailable",
      diagnostic: "Not collected"
    };
    const facts: PerpLiquidationSourceFact[] = [];

    try {
      const url = `${this.baseUrl}/stats/markets`;
      const res = await this.fetchWithRetry<unknown>(url);
      if (
        typeof res !== "object" ||
        res === null ||
        !Array.isArray((res as Record<string, unknown>).markets)
      ) {
        const diag = "Expected object with markets array from stats/markets endpoint";
        return {
          oiCoverage: { kind: "open_interest", status: "malformed", diagnostic: diag },
          basisCoverage: { kind: "perp_basis", status: "malformed", diagnostic: diag },
          leverageCoverage: { kind: "leverage_proxy", status: "malformed", diagnostic: diag },
          facts
        };
      }

      const markets = (res as Record<string, unknown>).markets as unknown[];
      const marketRow = markets.find(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          (item as Record<string, unknown>).symbol === this.symbol
      ) as Record<string, unknown> | undefined;

      if (!marketRow) {
        const diag = `Configured symbol ${this.symbol} not found in markets stats`;
        return {
          oiCoverage: { kind: "open_interest", status: "malformed", diagnostic: diag },
          basisCoverage: { kind: "perp_basis", status: "malformed", diagnostic: diag },
          leverageCoverage: { kind: "leverage_proxy", status: "malformed", diagnostic: diag },
          facts
        };
      }

      const oraclePrice = marketRow.oraclePrice;
      const markPrice = marketRow.markPrice;
      const openInterest = marketRow.openInterest as Record<string, unknown> | undefined;

      const longOi = openInterest?.long;
      const shortOi = openInterest?.short;

      if (
        !isPositiveDecimalString(oraclePrice) ||
        !isPositiveDecimalString(markPrice) ||
        !isValidDecimalString(longOi) ||
        !isValidDecimalString(shortOi)
      ) {
        const diag = "Invalid prices or open interest in market stats";
        return {
          oiCoverage: { kind: "open_interest", status: "malformed", diagnostic: diag },
          basisCoverage: { kind: "perp_basis", status: "malformed", diagnostic: diag },
          leverageCoverage: { kind: "leverage_proxy", status: "malformed", diagnostic: diag },
          facts
        };
      }

      const absLong = absDecimal(longOi);
      const absShort = absDecimal(shortOi);

      const openInterestBase = addDecimals(absLong, absShort);
      const openInterestUsdc = openInterestBase
        ? multiplyDecimals(openInterestBase, markPrice)
        : null;

      if (
        openInterestBase &&
        openInterestUsdc &&
        isPositiveDecimalString(openInterestBase) &&
        isPositiveDecimalString(openInterestUsdc)
      ) {
        const oiPayload: OpenInterestPayloadV1 = {
          schemaVersion: 1,
          evidenceFamily: "perp_liquidation",
          pair: request.pair,
          venue: "drift-api",
          instrument: this.symbol,
          sourceEventId: `drift-oi-${asOfUnixMs}`,
          observedAtUnixMs: asOfUnixMs,
          kind: "open_interest",
          openInterestBase,
          openInterestUsdc,
          sampleWindowSeconds: 300
        };
        oiCoverage = { kind: "open_interest", status: "available" };
        facts.push({ venue: "drift-api", kind: "open_interest", payload: oiPayload });
      } else {
        oiCoverage = {
          kind: "open_interest",
          status: "malformed",
          diagnostic: "Calculated open interest values are invalid"
        };
      }

      const basisPayload: PerpBasisPayloadV1 = {
        schemaVersion: 1,
        evidenceFamily: "perp_liquidation",
        pair: request.pair,
        venue: "drift-api",
        instrument: this.symbol,
        sourceEventId: `drift-basis-${asOfUnixMs}`,
        observedAtUnixMs: asOfUnixMs,
        kind: "perp_basis",
        perpPriceUsdc: markPrice,
        spotPriceUsdc: oraclePrice
      };
      basisCoverage = { kind: "perp_basis", status: "available" };
      facts.push({ venue: "drift-api", kind: "perp_basis", payload: basisPayload });

      if (Number(absShort) === 0 || absShort === "0" || absShort === "0.0") {
        leverageCoverage = {
          kind: "leverage_proxy",
          status: "unavailable",
          diagnostic: "Zero short open interest for leverage proxy"
        };
      } else {
        const ratio = divideDecimals(absLong, absShort);
        if (ratio && isPositiveDecimalString(ratio)) {
          const leveragePayload: LeverageProxyPayloadV1 = {
            schemaVersion: 1,
            evidenceFamily: "perp_liquidation",
            pair: request.pair,
            venue: "drift-api",
            instrument: this.symbol,
            sourceEventId: `drift-leverage-${asOfUnixMs}`,
            observedAtUnixMs: asOfUnixMs,
            kind: "leverage_proxy",
            longShortRatio: ratio,
            methodology: "market_net_position_ratio"
          };
          leverageCoverage = { kind: "leverage_proxy", status: "available" };
          facts.push({ venue: "drift-api", kind: "leverage_proxy", payload: leveragePayload });
        } else {
          leverageCoverage = {
            kind: "leverage_proxy",
            status: "unavailable",
            diagnostic: "Invalid leverage proxy ratio"
          };
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const diag = sanitizeDiagnostic(msg);
      const status =
        msg.includes("Expected") || msg.includes("SyntaxError") ? "malformed" : "unavailable";
      oiCoverage = { kind: "open_interest", status, diagnostic: diag };
      basisCoverage = { kind: "perp_basis", status, diagnostic: diag };
      leverageCoverage = { kind: "leverage_proxy", status, diagnostic: diag };
    }

    return { oiCoverage, basisCoverage, leverageCoverage, facts };
  }

  private async fetchLiquidations(
    request: PerpLiquidationSourceRequest
  ): Promise<{ coverage: PerpMetricCoverage; facts: PerpLiquidationSourceFact[] }> {
    let coverage: PerpMetricCoverage = {
      kind: "liquidation_event",
      status: "unavailable",
      diagnostic: "Not collected"
    };
    const facts: PerpLiquidationSourceFact[] = [];

    try {
      const url = `${this.baseUrl}/stats/liquidations`;
      const res = await this.fetchWithRetry<unknown>(url);
      if (
        typeof res !== "object" ||
        res === null ||
        !Array.isArray((res as Record<string, unknown>).records)
      ) {
        return {
          coverage: {
            kind: "liquidation_event",
            status: "malformed",
            diagnostic: "Expected object with records array from liquidations endpoint"
          },
          facts: []
        };
      }

      const records = (res as Record<string, unknown>).records as unknown[];
      const liqFacts: PerpLiquidationSourceFact[] = [];

      for (const item of records) {
        if (typeof item === "object" && item !== null) {
          const row = item as Record<string, unknown>;

          const mIndex = row.marketIndex ?? row.market;
          if (mIndex !== undefined && Number(mIndex) !== this.marketIndex) {
            continue;
          }

          const lType = row.liquidationType ?? row.marketType ?? row.type;
          if (lType !== undefined && String(lType) !== "perp") {
            continue;
          }

          const tsMs = normalizeTimestamp(row.ts ?? row.timestamp ?? row.observedAtUnixMs);
          if (tsMs === null || tsMs < request.fromUnixMs || tsMs > request.toUnixMs) {
            continue;
          }

          const side = row.side ?? row.direction;
          const amountBase = row.amountBase ?? row.baseAssetAmount ?? row.baseAmount;
          const notionalUsdc = row.notionalUsdc ?? row.quoteAssetAmount ?? row.quoteAmount;
          const rawId = row.id ?? row.liquidationId ?? row.recordId;
          const idStr = rawId !== undefined && rawId !== null ? String(rawId) : "";

          if (
            (side !== "long" && side !== "short") ||
            !isPositiveDecimalString(amountBase) ||
            !isPositiveDecimalString(notionalUsdc) ||
            idStr === ""
          ) {
            return {
              coverage: {
                kind: "liquidation_event",
                status: "malformed",
                diagnostic:
                  "Relevant liquidation record lacks unambiguous side or valid positive amounts"
              },
              facts: []
            };
          }

          const payload: LiquidationEventPayloadV1 = {
            schemaVersion: 1,
            evidenceFamily: "perp_liquidation",
            pair: request.pair,
            venue: "drift-api",
            instrument: this.symbol,
            sourceEventId: idStr,
            observedAtUnixMs: tsMs,
            kind: "liquidation_event",
            side: side as "long" | "short",
            amountBase,
            notionalUsdc
          };
          liqFacts.push({ venue: "drift-api", kind: "liquidation_event", payload });
        }
      }

      coverage = { kind: "liquidation_event", status: "available" };
      facts.push(...liqFacts);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      coverage = {
        kind: "liquidation_event",
        status:
          msg.includes("Expected") || msg.includes("SyntaxError") ? "malformed" : "unavailable",
        diagnostic: sanitizeDiagnostic(msg)
      };
    }

    return { coverage, facts };
  }

  async collect(request: PerpLiquidationSourceRequest): Promise<PerpLiquidationSourceSnapshot> {
    const asOfUnixMs = Date.now();
    const providerRunId = `drift-api-${asOfUnixMs}`;

    const [fundingRes, marketStatsRes, liqRes] = await Promise.all([
      this.fetchFundingRates(request),
      this.fetchMarketStats(request, asOfUnixMs),
      this.fetchLiquidations(request)
    ]);

    const coverage: Record<PerpObservationKind, PerpMetricCoverage> = {
      funding_rate: fundingRes.coverage,
      open_interest: marketStatsRes.oiCoverage,
      perp_basis: marketStatsRes.basisCoverage,
      leverage_proxy: marketStatsRes.leverageCoverage,
      liquidation_event: liqRes.coverage
    };

    const facts: PerpLiquidationSourceFact[] = [
      ...fundingRes.facts,
      ...marketStatsRes.facts,
      ...liqRes.facts
    ];

    return {
      source: "drift-api",
      providerRunId,
      asOfUnixMs,
      coverage,
      facts
    };
  }
}
