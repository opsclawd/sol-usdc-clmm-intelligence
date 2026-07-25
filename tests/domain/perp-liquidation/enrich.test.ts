import { describe, it, expect } from "vitest";
import { enrichPerpObservation } from "../../../src/domain/perp-liquidation/enrich.js";
import type { PerpObservationPayloadV1 } from "../../../src/contracts/perp-liquidation.js";

describe("perp-liquidation enrich", () => {
  const freshPayload: PerpObservationPayloadV1 = {
    schemaVersion: 1,
    evidenceFamily: "perp_liquidation",
    pair: "SOL/USDC",
    venue: "binance-fapi",
    instrument: "SOLUSDC_PERP",
    sourceEventId: "evt-999",
    observedAtUnixMs: 1000000,
    kind: "funding_rate",
    fundingRate: "0.0001",
    fundingIntervalHours: 8
  };

  it("enriches a fresh observation with high confidence and valid provenance", async () => {
    const enriched = await enrichPerpObservation({
      rawObservationId: 42,
      source: "binance-fapi",
      payload: freshPayload,
      observedAtUnixMs: 1000000,
      fetchedAtUnixMs: 1000100,
      receivedAtUnixMs: 1000200,
      nowMs: 1005000, // 5 seconds later (fresh, policy maxObservedAgeMs is 900_000)
      codeVersion: "1.0.0",
      runId: "run-abc",
      collector: "binance-collector",
      jobName: "perp-intelligence"
    });

    expect(enriched.rawObservationId).toBe(42);
    expect(enriched.source).toBe("binance-fapi");
    expect(enriched.observationKind).toBe("funding_rate");
    expect(enriched.evidenceFamily).toBe("perp_liquidation");
    expect(enriched.isStale).toBe(false);
    expect(enriched.confidence.level).toBe("high");
    expect(enriched.provenance.sourceRefs).toHaveLength(1);
    expect(enriched.provenance.rawObservationRefs).toHaveLength(1);
    expect(enriched.provenance.sourceRefs[0]?.id).toBe(42);
    expect(enriched.provenance.sourceRefs[0]?.source).toBe("binance-fapi");
  });

  it("transitions a persisted fresh fact to degraded evidence when freshness policy marks the input stale", async () => {
    const nowMs = 1000000 + 1_000_000; // 1,000s age > 900s maxObservedAgeMs for funding_rate

    const enriched = await enrichPerpObservation({
      rawObservationId: 42,
      source: "binance-fapi",
      payload: freshPayload,
      observedAtUnixMs: 1000000,
      fetchedAtUnixMs: 1000100,
      receivedAtUnixMs: 1000200,
      nowMs,
      codeVersion: "1.0.0",
      runId: "run-abc",
      collector: "binance-collector",
      jobName: "perp-intelligence"
    });

    expect(enriched.isStale).toBe(true);
    expect(enriched.staleBehavior).toBe("degrade_confidence");
    expect(enriched.confidence.reasons).toContain("stale_input_degraded");
    expect(enriched.confidence.level).not.toBe("high"); // Level is capped below high
    expect(enriched.observedAtUnixMs).toBe(1000000); // Does NOT rewrite observed timestamp
  });

  it("fails when provenance requirements are violated", async () => {
    await expect(
      enrichPerpObservation({
        rawObservationId: 42,
        source: "binance-fapi",
        payload: freshPayload,
        observedAtUnixMs: 1000000,
        fetchedAtUnixMs: 1000100,
        receivedAtUnixMs: 1000200,
        nowMs: 1005000,
        codeVersion: "", // Invalid empty code version violates provenance
        runId: "run-abc"
      })
    ).rejects.toThrow();
  });
});
