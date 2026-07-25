import type {
  PerpObservationPayloadV1,
  PerpCoverageRecordV1
} from "../../src/contracts/perp-liquidation.js";

export const sampleFundingRatePayload: PerpObservationPayloadV1 = {
  kind: "funding_rate",
  schemaVersion: 1,
  evidenceFamily: "perp_liquidation",
  pair: "SOL/USDC",
  venue: "binance-fapi",
  instrument: "SOLUSDT",
  sourceEventId: "evt-funding-101",
  observedAtUnixMs: 1715342400000,
  fundingRate: "0.0001",
  fundingIntervalHours: 8
};

export const sampleOpenInterestPayload: PerpObservationPayloadV1 = {
  kind: "open_interest",
  schemaVersion: 1,
  evidenceFamily: "perp_liquidation",
  pair: "SOL/USDC",
  venue: "drift-api",
  instrument: "SOL-PERP",
  sourceEventId: "evt-oi-102",
  observedAtUnixMs: 1715342400000,
  openInterestBase: "150000.5",
  openInterestUsdc: "22500075.0",
  sampleWindowSeconds: 60
};

export const samplePerpBasisPayload: PerpObservationPayloadV1 = {
  kind: "perp_basis",
  schemaVersion: 1,
  evidenceFamily: "perp_liquidation",
  pair: "SOL/USDC",
  venue: "binance-fapi",
  instrument: "SOLUSDT",
  sourceEventId: "evt-basis-103",
  observedAtUnixMs: 1715342400000,
  perpPriceUsdc: "150.25",
  spotPriceUsdc: "150.00"
};

export const sampleLiquidationEventPayload: PerpObservationPayloadV1 = {
  kind: "liquidation_event",
  schemaVersion: 1,
  evidenceFamily: "perp_liquidation",
  pair: "SOL/USDC",
  venue: "binance-fapi",
  instrument: "SOLUSDT",
  sourceEventId: "evt-liq-104",
  observedAtUnixMs: 1715342400000,
  side: "long",
  amountBase: "100.0",
  notionalUsdc: "15000.0"
};

export const sampleLeverageProxyPayload: PerpObservationPayloadV1 = {
  kind: "leverage_proxy",
  schemaVersion: 1,
  evidenceFamily: "perp_liquidation",
  pair: "SOL/USDC",
  venue: "drift-api",
  instrument: "SOL-PERP",
  sourceEventId: "evt-lev-105",
  observedAtUnixMs: 1715342400000,
  longShortRatio: "1.25",
  methodology: "global_account_long_short_ratio"
};

export const sampleAvailableCoverageRecord: PerpCoverageRecordV1 = {
  kind: "funding_rate",
  status: "available"
};

export const sampleUnavailableCoverageRecord: PerpCoverageRecordV1 = {
  kind: "open_interest",
  status: "unavailable",
  diagnostic: "Provider API timed out"
};

export const sampleMalformedCoverageRecord: PerpCoverageRecordV1 = {
  kind: "perp_basis",
  status: "malformed",
  diagnostic: "Decimal conversion failed for perpPriceUsdc"
};
