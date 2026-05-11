import { describe, it, expect } from "vitest";
import { FakeNormalizedObservationRepo } from "../../tests/fakes/fake-normalized-observation-repo.js";
import { DEFAULT_CONFIDENCE, DEFAULT_PROVENANCE } from "../helpers/taxonomy-fixtures.js";

describe("NormalizedObservationRepo contract", () => {
  it("inserts and finds by source and kind", async () => {
    const repo = new FakeNormalizedObservationRepo();
    const row = await repo.insert({
      rawObservationId: 1,
      source: "clmm-v2-bundle",
      observationKind: "pool_state",
      signalClass: "deterministic",
      evidenceFamily: "clmm_state",
      payload: { price: 150.0 },
      payloadHash: "hash-norm-1",
      confidence: DEFAULT_CONFIDENCE,
      provenance: DEFAULT_PROVENANCE,
      receivedAtUnixMs: 1000
    });
    expect(row.id).toBe(1);

    const found = await repo.findBySource("clmm-v2-bundle", "pool_state", 900);
    expect(found).toHaveLength(1);
    expect(found[0]!.observationKind).toBe("pool_state");
  });

  it("findFreshByKind returns only non-stale observations", async () => {
    const repo = new FakeNormalizedObservationRepo();
    await repo.insert({
      rawObservationId: 1,
      source: "clmm-v2-bundle",
      observationKind: "pool_state",
      signalClass: "deterministic",
      evidenceFamily: "clmm_state",
      payload: { price: 150.0 },
      payloadHash: "hash-1",
      confidence: DEFAULT_CONFIDENCE,
      isStale: false,
      provenance: DEFAULT_PROVENANCE,
      receivedAtUnixMs: 1000
    });
    await repo.insert({
      rawObservationId: 2,
      source: "clmm-v2-bundle",
      observationKind: "pool_state",
      signalClass: "deterministic",
      evidenceFamily: "clmm_state",
      payload: { price: 148.0 },
      payloadHash: "hash-2",
      confidence: DEFAULT_CONFIDENCE,
      isStale: true,
      provenance: DEFAULT_PROVENANCE,
      receivedAtUnixMs: 1100
    });

    const fresh = await repo.findFreshByKind("clmm-v2-bundle", "pool_state");
    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.isStale).toBe(false);
  });
});
