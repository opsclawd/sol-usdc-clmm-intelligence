import { describe, it, expect } from "vitest";
import {
  parsePerpObservationPayloadV1,
  parsePerpCoverageRecordV1,
  type PerpObservationPayloadV1
} from "../../src/contracts/perp-liquidation.js";
import {
  sampleFundingRatePayload,
  sampleOpenInterestPayload,
  samplePerpBasisPayload,
  sampleLiquidationEventPayload,
  sampleLeverageProxyPayload,
  sampleAvailableCoverageRecord,
  sampleUnavailableCoverageRecord,
  sampleMalformedCoverageRecord
} from "../fixtures/perp-liquidation.js";

describe("perp-liquidation contract and validation", () => {
  it("parses valid funding_rate payload", () => {
    const parsed = parsePerpObservationPayloadV1(sampleFundingRatePayload);
    expect(parsed).toEqual(sampleFundingRatePayload);
  });

  it("parses valid open_interest payload", () => {
    const parsed = parsePerpObservationPayloadV1(sampleOpenInterestPayload);
    expect(parsed).toEqual(sampleOpenInterestPayload);
  });

  it("parses valid perp_basis payload", () => {
    const parsed = parsePerpObservationPayloadV1(samplePerpBasisPayload);
    expect(parsed).toEqual(samplePerpBasisPayload);
  });

  it("parses valid liquidation_event payload", () => {
    const parsed = parsePerpObservationPayloadV1(sampleLiquidationEventPayload);
    expect(parsed).toEqual(sampleLiquidationEventPayload);
  });

  it("parses valid leverage_proxy payload", () => {
    const parsed = parsePerpObservationPayloadV1(sampleLeverageProxyPayload);
    expect(parsed).toEqual(sampleLeverageProxyPayload);
  });

  it("supports signed decimal funding rate", () => {
    const negativeFunding: PerpObservationPayloadV1 = {
      kind: "funding_rate",
      schemaVersion: 1,
      evidenceFamily: "perp_liquidation",
      pair: "SOL/USDC",
      venue: "binance-fapi",
      instrument: "SOLUSDT",
      sourceEventId: "evt-funding-101",
      observedAtUnixMs: 1715342400000,
      fundingRate: "-0.0005",
      fundingIntervalHours: 8
    };
    const parsed = parsePerpObservationPayloadV1(negativeFunding);
    expect(parsed.kind === "funding_rate" && parsed.fundingRate).toBe("-0.0005");
  });

  it("requires positive decimal amounts and prices", () => {
    const invalidAmount = {
      kind: "liquidation_event",
      schemaVersion: 1,
      evidenceFamily: "perp_liquidation",
      pair: "SOL/USDC",
      venue: "binance-fapi",
      instrument: "SOLUSDT",
      sourceEventId: "evt-liq-104",
      observedAtUnixMs: 1715342400000,
      side: "long",
      amountBase: "-10.0",
      notionalUsdc: "15000.0"
    };
    expect(() => parsePerpObservationPayloadV1(invalidAmount)).toThrow();
  });

  it("distinguishes long/short liquidation side", () => {
    const shortLiq: PerpObservationPayloadV1 = {
      kind: "liquidation_event",
      schemaVersion: 1,
      evidenceFamily: "perp_liquidation",
      pair: "SOL/USDC",
      venue: "binance-fapi",
      instrument: "SOLUSDT",
      sourceEventId: "evt-liq-104",
      observedAtUnixMs: 1715342400000,
      side: "short",
      amountBase: "100.0",
      notionalUsdc: "15000.0"
    };
    const parsed = parsePerpObservationPayloadV1(shortLiq);
    expect(parsed.kind === "liquidation_event" && parsed.side).toBe("short");
  });

  it("restricts venues to canonical source names", () => {
    const invalidVenue = {
      ...sampleFundingRatePayload,
      venue: "invalid-venue"
    };
    expect(() => parsePerpObservationPayloadV1(invalidVenue)).toThrow();
  });

  it("validates metric coverage records", () => {
    expect(parsePerpCoverageRecordV1(sampleAvailableCoverageRecord)).toEqual(
      sampleAvailableCoverageRecord
    );
    expect(parsePerpCoverageRecordV1(sampleUnavailableCoverageRecord)).toEqual(
      sampleUnavailableCoverageRecord
    );
    expect(parsePerpCoverageRecordV1(sampleMalformedCoverageRecord)).toEqual(
      sampleMalformedCoverageRecord
    );

    expect(() =>
      parsePerpCoverageRecordV1({
        kind: "funding_rate",
        status: "unavailable"
        // missing diagnostic when unavailable
      })
    ).toThrow();
  });
});
