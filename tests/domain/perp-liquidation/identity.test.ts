import { describe, it, expect } from "vitest";
import { derivePerpObservationKey } from "../../../src/domain/perp-liquidation/identity.js";
import type { PerpObservationPayloadV1 } from "../../../src/contracts/perp-liquidation.js";

describe("perp-liquidation identity", () => {
  const payload: PerpObservationPayloadV1 = {
    schemaVersion: 1,
    evidenceFamily: "perp_liquidation",
    pair: "SOL/USDC",
    venue: "binance-fapi",
    instrument: "SOLUSDC_PERP",
    sourceEventId: "event-abc-123",
    observedAtUnixMs: 1700000000000,
    kind: "funding_rate",
    fundingRate: "0.0001",
    fundingIntervalHours: 8
  };

  it("uses venue kind instrument observed time and provider event id as identity", async () => {
    const key = await derivePerpObservationKey(payload);
    expect(typeof key).toBe("string");
    expect(key).toHaveLength(64); // SHA-256 hex string length

    // Changing unrelated payload value (like funding rate value) should not change identity key
    // if key is based on (source/venue, kind, instrument, observedAtUnixMs, sourceEventId)
    const payloadWithDifferentFundingRate: PerpObservationPayloadV1 = {
      ...payload,
      fundingRate: "0.00099"
    };
    const key2 = await derivePerpObservationKey(payloadWithDifferentFundingRate);
    expect(key2).toBe(key);

    // Changing venue, kind, instrument, observedAtUnixMs, or sourceEventId WILL change identity key
    const payloadWithDifferentEventId: PerpObservationPayloadV1 = {
      ...payload,
      sourceEventId: "event-xyz-999"
    };
    const key3 = await derivePerpObservationKey(payloadWithDifferentEventId);
    expect(key3).not.toBe(key);
  });

  it("derives the same identity for reordered object keys", async () => {
    const key1 = await derivePerpObservationKey(payload);

    // Construct object with different property order
    const reorderedPayload = {
      fundingIntervalHours: 8,
      fundingRate: "0.0001",
      observedAtUnixMs: 1700000000000,
      kind: "funding_rate" as const,
      sourceEventId: "event-abc-123",
      instrument: "SOLUSDC_PERP",
      venue: "binance-fapi" as const,
      pair: "SOL/USDC" as const,
      evidenceFamily: "perp_liquidation" as const,
      schemaVersion: 1 as const
    };

    const key2 = await derivePerpObservationKey(reorderedPayload);
    expect(key2).toBe(key1);
  });

  it("never includes pipeline run ID in identity hash", async () => {
    const keyWithoutRunId = await derivePerpObservationKey(payload, "run-111");
    const keyWithDifferentRunId = await derivePerpObservationKey(payload, "run-222");
    expect(keyWithoutRunId).toBe(keyWithDifferentRunId);
  });
});
