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

export interface DriftPrecisions {
  readonly basePrecisionExp: number;
  readonly quotePrecisionExp: number;
  readonly pricePrecisionExp: number;
}

export interface HttpDriftSourceConfig {
  readonly baseUrl: string;
  readonly marketIndex: number;
  readonly http: HttpClient;
  readonly retry?: RetryControl;
  readonly maxAttempts?: number;
  readonly precisions: DriftPrecisions;
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

function scaleIntegerString(valStr: string, exp: number): string {
  const big = BigInt(valStr);
  const scale = 10n ** BigInt(exp);
  const integerPart = big / scale;
  const remainder = big % scale;

  if (remainder === 0n) {
    return integerPart.toString();
  }

  const remainderStr = (remainder < 0n ? -remainder : remainder)
    .toString()
    .padStart(exp, "0")
    .replace(/0+$/, "");
  const sign = big < 0n && integerPart === 0n ? "-" : "";
  return `${sign}${integerPart.toString()}.${remainderStr}`;
}

export class HttpDriftSource implements PerpLiquidationSourcePort {
  private readonly baseUrl: string;
  private readonly marketIndex: number;
  private readonly http: HttpClient;
  private readonly retryControl: RetryControl;
  private readonly maxAttempts: number;
  private readonly precisions: DriftPrecisions;

  constructor(config: HttpDriftSourceConfig) {
    this.baseUrl = config.baseUrl;
    this.marketIndex = config.marketIndex;
    this.http = config.http;
    this.retryControl = config.retry ?? new SystemRetryControl();
    this.maxAttempts = config.maxAttempts ?? 2;
    this.precisions = config.precisions;
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
      const url = `${this.baseUrl}/fundingRates?marketIndex=${this.marketIndex}`;
      const res = await this.fetchWithRetry<unknown>(url);
      if (!Array.isArray(res)) {
        coverage = {
          kind: "funding_rate",
          status: "malformed",
          diagnostic: "Expected array from fundingRates endpoint"
        };
      } else {
        const fundingFacts: PerpLiquidationSourceFact[] = [];
        for (const item of res) {
          if (
            typeof item === "object" &&
            item !== null &&
            (item as Record<string, unknown>).marketIndex === this.marketIndex &&
            (item as Record<string, unknown>).recordId &&
            (item as Record<string, unknown>).ts
          ) {
            const row = item as Record<string, unknown>;
            const rawTs = Number(row.ts);
            const tsMs = rawTs < 1e11 ? rawTs * 1000 : rawTs;
            const fundingDecimal = scaleIntegerString(String(row.fundingRate), 9);

            const payload: FundingRatePayloadV1 = {
              schemaVersion: 1,
              evidenceFamily: "perp_liquidation",
              pair: request.pair,
              venue: "drift-api",
              instrument: `SOL-PERP-${this.marketIndex}`,
              sourceEventId: `drift-funding-${row.recordId}`,
              observedAtUnixMs: tsMs,
              kind: "funding_rate",
              fundingRate: fundingDecimal,
              fundingIntervalHours: 1
            };
            fundingFacts.push({ venue: "drift-api", kind: "funding_rate", payload });
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

  private async fetchMarketState(
    request: PerpLiquidationSourceRequest,
    asOfUnixMs: number
  ): Promise<{
    oiCoverage: PerpMetricCoverage;
    basisCoverage: PerpMetricCoverage;
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
    const facts: PerpLiquidationSourceFact[] = [];

    try {
      const url = `${this.baseUrl}/marketState?marketIndex=${this.marketIndex}`;
      const res = await this.fetchWithRetry<unknown>(url);
      if (
        typeof res === "object" &&
        res !== null &&
        (res as Record<string, unknown>).marketIndex === this.marketIndex
      ) {
        const row = res as Record<string, unknown>;
        const amm = row.amm as Record<string, unknown> | undefined;
        const oracleData = amm?.historicalOracleData as Record<string, unknown> | undefined;

        if (
          row.baseAssetAmountWithUnsettledLp &&
          amm?.lastMarkPrice &&
          oracleData?.lastOraclePrice
        ) {
          const baseDecimal = scaleIntegerString(
            String(row.baseAssetAmountWithUnsettledLp),
            this.precisions.basePrecisionExp
          );
          const markPriceDecimal = scaleIntegerString(
            String(amm.lastMarkPrice),
            this.precisions.pricePrecisionExp
          );
          const oraclePriceDecimal = scaleIntegerString(
            String(oracleData.lastOraclePrice),
            this.precisions.pricePrecisionExp
          );

          const usdcOiNum = Number(baseDecimal) * Number(markPriceDecimal);
          const usdcOiDecimal = usdcOiNum.toFixed(2);

          const oiPayload: OpenInterestPayloadV1 = {
            schemaVersion: 1,
            evidenceFamily: "perp_liquidation",
            pair: request.pair,
            venue: "drift-api",
            instrument: `SOL-PERP-${this.marketIndex}`,
            sourceEventId: `drift-oi-${asOfUnixMs}`,
            observedAtUnixMs: asOfUnixMs,
            kind: "open_interest",
            openInterestBase: baseDecimal,
            openInterestUsdc: usdcOiDecimal,
            sampleWindowSeconds: 300
          };
          oiCoverage = { kind: "open_interest", status: "available" };
          facts.push({ venue: "drift-api", kind: "open_interest", payload: oiPayload });

          const basisPayload: PerpBasisPayloadV1 = {
            schemaVersion: 1,
            evidenceFamily: "perp_liquidation",
            pair: request.pair,
            venue: "drift-api",
            instrument: `SOL-PERP-${this.marketIndex}`,
            sourceEventId: `drift-basis-${asOfUnixMs}`,
            observedAtUnixMs: asOfUnixMs,
            kind: "perp_basis",
            perpPriceUsdc: markPriceDecimal,
            spotPriceUsdc: oraclePriceDecimal
          };
          basisCoverage = { kind: "perp_basis", status: "available" };
          facts.push({ venue: "drift-api", kind: "perp_basis", payload: basisPayload });
        } else {
          oiCoverage = {
            kind: "open_interest",
            status: "malformed",
            diagnostic: "Missing base asset amount or prices in marketState"
          };
          basisCoverage = {
            kind: "perp_basis",
            status: "malformed",
            diagnostic: "Missing prices in marketState"
          };
        }
      } else {
        oiCoverage = {
          kind: "open_interest",
          status: "malformed",
          diagnostic: "Malformed marketState response"
        };
        basisCoverage = {
          kind: "perp_basis",
          status: "malformed",
          diagnostic: "Malformed marketState response"
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const diag = sanitizeDiagnostic(msg);
      const status =
        msg.includes("Expected") || msg.includes("SyntaxError") ? "malformed" : "unavailable";
      oiCoverage = { kind: "open_interest", status, diagnostic: diag };
      basisCoverage = { kind: "perp_basis", status, diagnostic: diag };
    }

    return { oiCoverage, basisCoverage, facts };
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
      const url = `${this.baseUrl}/liquidations?marketIndex=${this.marketIndex}&fromMs=${request.fromUnixMs}&toMs=${request.toUnixMs}`;
      const res = await this.fetchWithRetry<unknown>(url);
      if (!Array.isArray(res)) {
        coverage = {
          kind: "liquidation_event",
          status: "malformed",
          diagnostic: "Expected array from liquidations endpoint"
        };
      } else {
        const liqFacts: PerpLiquidationSourceFact[] = [];
        for (const item of res) {
          if (
            typeof item === "object" &&
            item !== null &&
            (item as Record<string, unknown>).marketIndex === this.marketIndex &&
            (item as Record<string, unknown>).liquidationId &&
            ((item as Record<string, unknown>).direction === "long" ||
              (item as Record<string, unknown>).direction === "short")
          ) {
            const row = item as Record<string, unknown>;
            const amountBase = scaleIntegerString(
              String(row.baseAssetAmount),
              this.precisions.basePrecisionExp
            );
            const notionalUsdc = scaleIntegerString(
              String(row.quoteAssetAmount),
              this.precisions.quotePrecisionExp
            );
            const rawTs = Number(row.ts);

            const payload: LiquidationEventPayloadV1 = {
              schemaVersion: 1,
              evidenceFamily: "perp_liquidation",
              pair: request.pair,
              venue: "drift-api",
              instrument: `SOL-PERP-${this.marketIndex}`,
              sourceEventId: String(row.liquidationId),
              observedAtUnixMs: rawTs < 1e11 ? rawTs * 1000 : rawTs,
              kind: "liquidation_event",
              side: row.direction as "long" | "short",
              amountBase,
              notionalUsdc
            };
            liqFacts.push({ venue: "drift-api", kind: "liquidation_event", payload });
          }
        }
        coverage = { kind: "liquidation_event", status: "available" };
        facts.push(...liqFacts);
      }
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

  private async fetchNetPositionRatio(
    request: PerpLiquidationSourceRequest,
    asOfUnixMs: number
  ): Promise<{ coverage: PerpMetricCoverage; facts: PerpLiquidationSourceFact[] }> {
    let coverage: PerpMetricCoverage = {
      kind: "leverage_proxy",
      status: "unavailable",
      diagnostic: "Not collected"
    };
    const facts: PerpLiquidationSourceFact[] = [];

    try {
      const url = `${this.baseUrl}/netPositionRatio?marketIndex=${this.marketIndex}`;
      const res = await this.fetchWithRetry<unknown>(url);
      if (
        typeof res === "object" &&
        res !== null &&
        typeof (res as Record<string, unknown>).netPositionRatio === "string"
      ) {
        const row = res as Record<string, unknown>;
        const payload: LeverageProxyPayloadV1 = {
          schemaVersion: 1,
          evidenceFamily: "perp_liquidation",
          pair: request.pair,
          venue: "drift-api",
          instrument: `SOL-PERP-${this.marketIndex}`,
          sourceEventId: `drift-leverage-${asOfUnixMs}`,
          observedAtUnixMs: asOfUnixMs,
          kind: "leverage_proxy",
          longShortRatio: row.netPositionRatio as string,
          methodology: "market_net_position_ratio"
        };
        coverage = { kind: "leverage_proxy", status: "available" };
        facts.push({ venue: "drift-api", kind: "leverage_proxy", payload });
      } else {
        coverage = {
          kind: "leverage_proxy",
          status: "unavailable",
          diagnostic: "Net position ratio not supplied"
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      coverage = {
        kind: "leverage_proxy",
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

    const [fundingRes, marketStateRes, liqRes, leverageRes] = await Promise.all([
      this.fetchFundingRates(request),
      this.fetchMarketState(request, asOfUnixMs),
      this.fetchLiquidations(request),
      this.fetchNetPositionRatio(request, asOfUnixMs)
    ]);

    const coverage: Record<PerpObservationKind, PerpMetricCoverage> = {
      funding_rate: fundingRes.coverage,
      open_interest: marketStateRes.oiCoverage,
      perp_basis: marketStateRes.basisCoverage,
      liquidation_event: liqRes.coverage,
      leverage_proxy: leverageRes.coverage
    };

    const facts: PerpLiquidationSourceFact[] = [
      ...fundingRes.facts,
      ...marketStateRes.facts,
      ...liqRes.facts,
      ...leverageRes.facts
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
