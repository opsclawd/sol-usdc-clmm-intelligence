import { describe, it, expect } from "vitest";
import {
  validatePerpObservation,
  PerpObservationValidationError
} from "../../../src/domain/perp-liquidation/validate.js";
import type { PerpObservationPayloadV1 } from "../../../src/contracts/perp-liquidation.js";

describe("perp-liquidation validate", () => {
  const baseFundingRatePayload: PerpObservationPayloadV1 = {
    schemaVersion: 1,
    evidenceFamily: "perp_liquidation",
    pair: "SOL/USDC",
    venue: "binance-fapi",
    instrument: "SOLUSDC_PERP",
    sourceEventId: "evt-123",
    observedAtUnixMs: 1700000000000,
    kind: "funding_rate",
    fundingRate: "0.0001",
    fundingIntervalHours: 8
  };

  it("validates positive and negative funding rates", () => {
    const pos = validatePerpObservation(baseFundingRatePayload);
    expect(pos).toEqual(baseFundingRatePayload);

    const negPayload = { ...baseFundingRatePayload, fundingRate: "-0.00025" };
    const neg = validatePerpObservation(negPayload);
    expect(neg).toEqual(negPayload);
  });

  it("validates open interest with positive amounts", () => {
    const oiPayload: PerpObservationPayloadV1 = {
      schemaVersion: 1,
      evidenceFamily: "perp_liquidation",
      pair: "SOL/USDC",
      venue: "drift-api",
      instrument: "SOL-PERP",
      sourceEventId: "oi-456",
      observedAtUnixMs: 1700000000000,
      kind: "open_interest",
      openInterestBase: "12345.67",
      openInterestUsdc: "1851850.50",
      sampleWindowSeconds: 300
    };
    expect(validatePerpObservation(oiPayload)).toEqual(oiPayload);
  });

  it("validates perp basis with positive prices", () => {
    const basisPayload: PerpObservationPayloadV1 = {
      schemaVersion: 1,
      evidenceFamily: "perp_liquidation",
      pair: "SOL/USDC",
      venue: "binance-fapi",
      instrument: "SOLUSDC_PERP",
      sourceEventId: "basis-789",
      observedAtUnixMs: 1700000000000,
      kind: "perp_basis",
      perpPriceUsdc: "150.50",
      spotPriceUsdc: "150.00"
    };
    expect(validatePerpObservation(basisPayload)).toEqual(basisPayload);
  });

  it("validates liquidation events for both long and short sides", () => {
    const liqLong: PerpObservationPayloadV1 = {
      schemaVersion: 1,
      evidenceFamily: "perp_liquidation",
      pair: "SOL/USDC",
      venue: "drift-api",
      instrument: "SOL-PERP",
      sourceEventId: "liq-1",
      observedAtUnixMs: 1700000000000,
      kind: "liquidation_event",
      side: "long",
      amountBase: "10.5",
      notionalUsdc: "1575.00"
    };
    expect(validatePerpObservation(liqLong)).toEqual(liqLong);

    const liqShort: PerpObservationPayloadV1 = {
      ...liqLong,
      sourceEventId: "liq-2",
      side: "short"
    };
    expect(validatePerpObservation(liqShort)).toEqual(liqShort);
  });

  it("validates leverage proxy payload", () => {
    const levPayload: PerpObservationPayloadV1 = {
      schemaVersion: 1,
      evidenceFamily: "perp_liquidation",
      pair: "SOL/USDC",
      venue: "binance-fapi",
      instrument: "SOLUSDC_PERP",
      sourceEventId: "lev-100",
      observedAtUnixMs: 1700000000000,
      kind: "leverage_proxy",
      longShortRatio: "1.25",
      methodology: "global_account_long_short_ratio"
    };
    expect(validatePerpObservation(levPayload)).toEqual(levPayload);
  });

  it("rejects venue-only or unknown extra fields", () => {
    const extraFieldPayload = {
      ...baseFundingRatePayload,
      venueInternalId: "binance-secret-123",
      providerSpreadBps: 15
    };
    expect(() => validatePerpObservation(extraFieldPayload)).toThrow(
      PerpObservationValidationError
    );
  });

  it("rejects non-integer or negative timestamps", () => {
    const invalidTs = { ...baseFundingRatePayload, observedAtUnixMs: 1700000000000.5 };
    expect(() => validatePerpObservation(invalidTs)).toThrow(PerpObservationValidationError);

    const negTs = { ...baseFundingRatePayload, observedAtUnixMs: -100 };
    expect(() => validatePerpObservation(negTs)).toThrow(PerpObservationValidationError);
  });

  it("rejects non-SOL/USDC pair", () => {
    const wrongPair = { ...baseFundingRatePayload, pair: "BTC/USDC" };
    expect(() => validatePerpObservation(wrongPair)).toThrow(PerpObservationValidationError);
  });

  it("rejects invalid decimal strings or non-positive values where required", () => {
    const invalidOi = {
      ...baseFundingRatePayload,
      kind: "open_interest",
      openInterestBase: "-10",
      openInterestUsdc: "100",
      sampleWindowSeconds: 60
    };
    expect(() => validatePerpObservation(invalidOi)).toThrow(PerpObservationValidationError);
  });
});
