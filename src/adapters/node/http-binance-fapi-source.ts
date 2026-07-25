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
  OpenInterestPayloadV1,
  PerpBasisPayloadV1,
  PerpObservationKind
} from "../../contracts/perp-liquidation.js";

export interface HttpBinanceFapiSourceConfig {
  readonly baseUrl: string;
  readonly symbol: string;
  readonly http: HttpClient;
  readonly retry?: RetryControl;
  readonly maxAttempts?: number;
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

function isValidDecimal(val: unknown): val is string {
  if (typeof val !== "string" && typeof val !== "number") return false;
  const str = String(val);
  if (str.trim() === "") return false;
  const num = Number(str);
  return !Number.isNaN(num) && Number.isFinite(num);
}

function isPositiveDecimal(val: unknown): val is string {
  if (!isValidDecimal(val)) return false;
  return Number(val) > 0;
}

export class HttpBinanceFapiSource implements PerpLiquidationSourcePort {
  private readonly baseUrl: string;
  private readonly symbol: string;
  private readonly http: HttpClient;
  private readonly retryControl: RetryControl;
  private readonly maxAttempts: number;

  constructor(config: HttpBinanceFapiSourceConfig) {
    this.baseUrl = config.baseUrl;
    this.symbol = config.symbol;
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

  private async fetchFundingRate(
    request: PerpLiquidationSourceRequest
  ): Promise<{ coverage: PerpMetricCoverage; facts: PerpLiquidationSourceFact[] }> {
    let coverage: PerpMetricCoverage = {
      kind: "funding_rate",
      status: "unavailable",
      diagnostic: "Not collected"
    };
    const facts: PerpLiquidationSourceFact[] = [];

    try {
      const url = `${this.baseUrl}/fapi/v1/fundingRate?symbol=${this.symbol}&limit=10`;
      const res = await this.fetchWithRetry<unknown>(url);
      if (!Array.isArray(res)) {
        coverage = {
          kind: "funding_rate",
          status: "malformed",
          diagnostic: "Expected array from fundingRate endpoint"
        };
      } else {
        let malformed = false;
        const fundingFacts: PerpLiquidationSourceFact[] = [];
        for (const item of res) {
          if (
            typeof item === "object" &&
            item !== null &&
            (item as Record<string, unknown>).symbol === this.symbol &&
            typeof (item as Record<string, unknown>).fundingTime === "number" &&
            isValidDecimal((item as Record<string, unknown>).fundingRate)
          ) {
            const row = item as Record<string, unknown>;
            const payload: FundingRatePayloadV1 = {
              schemaVersion: 1,
              evidenceFamily: "perp_liquidation",
              pair: request.pair,
              venue: "binance-fapi",
              instrument: this.symbol,
              sourceEventId: `binance-funding-${row.fundingTime}`,
              observedAtUnixMs: row.fundingTime as number,
              kind: "funding_rate",
              fundingRate: String(row.fundingRate),
              fundingIntervalHours: 8
            };
            fundingFacts.push({ venue: "binance-fapi", kind: "funding_rate", payload });
          } else {
            malformed = true;
          }
        }
        if (malformed && fundingFacts.length === 0) {
          coverage = {
            kind: "funding_rate",
            status: "malformed",
            diagnostic: "Malformed funding rate items"
          };
        } else {
          coverage = { kind: "funding_rate", status: "available" };
          facts.push(...fundingFacts);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("Expected array") ||
        msg.includes("SyntaxError") ||
        msg.includes("not json")
      ) {
        coverage = {
          kind: "funding_rate",
          status: "malformed",
          diagnostic: sanitizeDiagnostic(msg)
        };
      } else {
        coverage = {
          kind: "funding_rate",
          status: "unavailable",
          diagnostic: sanitizeDiagnostic(msg)
        };
      }
    }

    return { coverage, facts };
  }

  private async fetchOpenInterest(
    request: PerpLiquidationSourceRequest
  ): Promise<{ coverage: PerpMetricCoverage; facts: PerpLiquidationSourceFact[] }> {
    let coverage: PerpMetricCoverage = {
      kind: "open_interest",
      status: "unavailable",
      diagnostic: "Not collected"
    };
    const facts: PerpLiquidationSourceFact[] = [];

    try {
      const url = `${this.baseUrl}/futures/data/openInterestHist?symbol=${this.symbol}&period=5m&limit=48`;
      const res = await this.fetchWithRetry<unknown>(url);
      if (!Array.isArray(res)) {
        coverage = {
          kind: "open_interest",
          status: "malformed",
          diagnostic: "Expected array from openInterestHist endpoint"
        };
      } else {
        let malformed = false;
        const oiFacts: PerpLiquidationSourceFact[] = [];
        for (const item of res) {
          if (
            typeof item === "object" &&
            item !== null &&
            (item as Record<string, unknown>).symbol === this.symbol &&
            typeof (item as Record<string, unknown>).timestamp === "number" &&
            isPositiveDecimal((item as Record<string, unknown>).sumOpenInterest) &&
            isPositiveDecimal((item as Record<string, unknown>).sumOpenInterestValue)
          ) {
            const row = item as Record<string, unknown>;
            const payload: OpenInterestPayloadV1 = {
              schemaVersion: 1,
              evidenceFamily: "perp_liquidation",
              pair: request.pair,
              venue: "binance-fapi",
              instrument: this.symbol,
              sourceEventId: `binance-oi-${row.timestamp}`,
              observedAtUnixMs: row.timestamp as number,
              kind: "open_interest",
              openInterestBase: String(row.sumOpenInterest),
              openInterestUsdc: String(row.sumOpenInterestValue),
              sampleWindowSeconds: 300
            };
            oiFacts.push({ venue: "binance-fapi", kind: "open_interest", payload });
          } else {
            malformed = true;
          }
        }
        if (malformed) {
          coverage = {
            kind: "open_interest",
            status: "malformed",
            diagnostic: "Malformed open interest items"
          };
        } else {
          coverage = { kind: "open_interest", status: "available" };
          facts.push(...oiFacts);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("Expected array") ||
        msg.includes("SyntaxError") ||
        msg.includes("not json")
      ) {
        coverage = {
          kind: "open_interest",
          status: "malformed",
          diagnostic: sanitizeDiagnostic(msg)
        };
      } else {
        coverage = {
          kind: "open_interest",
          status: "unavailable",
          diagnostic: sanitizeDiagnostic(msg)
        };
      }
    }

    return { coverage, facts };
  }

  private async fetchPerpBasis(
    request: PerpLiquidationSourceRequest
  ): Promise<{ coverage: PerpMetricCoverage; facts: PerpLiquidationSourceFact[] }> {
    let coverage: PerpMetricCoverage = {
      kind: "perp_basis",
      status: "unavailable",
      diagnostic: "Not collected"
    };
    const facts: PerpLiquidationSourceFact[] = [];

    try {
      const url = `${this.baseUrl}/fapi/v1/premiumIndex?symbol=${this.symbol}`;
      const res = await this.fetchWithRetry<unknown>(url);
      if (
        typeof res === "object" &&
        res !== null &&
        (res as Record<string, unknown>).symbol === this.symbol &&
        typeof (res as Record<string, unknown>).time === "number" &&
        isPositiveDecimal((res as Record<string, unknown>).markPrice) &&
        isPositiveDecimal((res as Record<string, unknown>).indexPrice)
      ) {
        const row = res as Record<string, unknown>;
        const payload: PerpBasisPayloadV1 = {
          schemaVersion: 1,
          evidenceFamily: "perp_liquidation",
          pair: request.pair,
          venue: "binance-fapi",
          instrument: this.symbol,
          sourceEventId: `binance-basis-${row.time}`,
          observedAtUnixMs: row.time as number,
          kind: "perp_basis",
          perpPriceUsdc: String(row.markPrice),
          spotPriceUsdc: String(row.indexPrice)
        };
        coverage = { kind: "perp_basis", status: "available" };
        facts.push({ venue: "binance-fapi", kind: "perp_basis", payload });
      } else {
        coverage = {
          kind: "perp_basis",
          status: "malformed",
          diagnostic: "Malformed premiumIndex response"
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Expected") || msg.includes("SyntaxError") || msg.includes("not json")) {
        coverage = {
          kind: "perp_basis",
          status: "malformed",
          diagnostic: sanitizeDiagnostic(msg)
        };
      } else {
        coverage = {
          kind: "perp_basis",
          status: "unavailable",
          diagnostic: sanitizeDiagnostic(msg)
        };
      }
    }

    return { coverage, facts };
  }

  private async fetchLeverageProxy(
    request: PerpLiquidationSourceRequest
  ): Promise<{ coverage: PerpMetricCoverage; facts: PerpLiquidationSourceFact[] }> {
    let coverage: PerpMetricCoverage = {
      kind: "leverage_proxy",
      status: "unavailable",
      diagnostic: "Not collected"
    };
    const facts: PerpLiquidationSourceFact[] = [];

    try {
      const url = `${this.baseUrl}/futures/data/topLongShortPositionRatio?symbol=${this.symbol}&period=5m&limit=1`;
      const res = await this.fetchWithRetry<unknown>(url);
      if (!Array.isArray(res) || res.length === 0) {
        coverage = {
          kind: "leverage_proxy",
          status: "unavailable",
          diagnostic: "Empty leverage ratio response"
        };
      } else {
        const item = res[0];
        if (
          typeof item === "object" &&
          item !== null &&
          (item as Record<string, unknown>).symbol === this.symbol &&
          typeof (item as Record<string, unknown>).timestamp === "number" &&
          isPositiveDecimal((item as Record<string, unknown>).longShortRatio)
        ) {
          const row = item as Record<string, unknown>;
          const payload: LeverageProxyPayloadV1 = {
            schemaVersion: 1,
            evidenceFamily: "perp_liquidation",
            pair: request.pair,
            venue: "binance-fapi",
            instrument: this.symbol,
            sourceEventId: `binance-leverage-${row.timestamp}`,
            observedAtUnixMs: row.timestamp as number,
            kind: "leverage_proxy",
            longShortRatio: String(row.longShortRatio),
            methodology: "global_account_long_short_ratio"
          };
          coverage = { kind: "leverage_proxy", status: "available" };
          facts.push({ venue: "binance-fapi", kind: "leverage_proxy", payload });
        } else {
          coverage = {
            kind: "leverage_proxy",
            status: "malformed",
            diagnostic: "Malformed topLongShortPositionRatio item"
          };
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Expected") || msg.includes("SyntaxError") || msg.includes("not json")) {
        coverage = {
          kind: "leverage_proxy",
          status: "malformed",
          diagnostic: sanitizeDiagnostic(msg)
        };
      } else {
        coverage = {
          kind: "leverage_proxy",
          status: "unavailable",
          diagnostic: sanitizeDiagnostic(msg)
        };
      }
    }

    return { coverage, facts };
  }

  async collect(request: PerpLiquidationSourceRequest): Promise<PerpLiquidationSourceSnapshot> {
    const asOfUnixMs = Date.now();
    const providerRunId = `binance-fapi-${asOfUnixMs}`;

    const [fundingRes, oiRes, basisRes, leverageRes] = await Promise.all([
      this.fetchFundingRate(request),
      this.fetchOpenInterest(request),
      this.fetchPerpBasis(request),
      this.fetchLeverageProxy(request)
    ]);

    const coverage: Record<PerpObservationKind, PerpMetricCoverage> = {
      funding_rate: fundingRes.coverage,
      open_interest: oiRes.coverage,
      perp_basis: basisRes.coverage,
      liquidation_event: {
        kind: "liquidation_event",
        status: "unavailable",
        diagnostic: "User-data force-order endpoint excluded"
      },
      leverage_proxy: leverageRes.coverage
    };

    const facts: PerpLiquidationSourceFact[] = [
      ...fundingRes.facts,
      ...oiRes.facts,
      ...basisRes.facts,
      ...leverageRes.facts
    ];

    return {
      source: "binance-fapi",
      providerRunId,
      asOfUnixMs,
      coverage,
      facts
    };
  }
}
