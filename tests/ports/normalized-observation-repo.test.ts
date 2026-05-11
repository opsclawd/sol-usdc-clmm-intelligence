import { describe, it, expect } from "vitest";
import { FakeNormalizedObservationRepo } from "../../tests/fakes/fake-normalized-observation-repo.js";

const DEFAULT_CONFIDENCE = {
  components: {
    sourceReliability: 1,
    dataCompleteness: 1,
    derivationConfidence: 1,
    llmConfidence: null
  },
  compositeScore: 1,
  level: "high" as const,
  weightingVersion: "v1",
  reasons: []
};

const DEFAULT_PROVENANCE = {
  sourceRefs: [],
  rawObservationRefs: [],
  derivedFromRefs: [],
  processRef: {
    collector: "test",
    jobName: "test",
    pipelineRunId: null,
    codeVersion: null,
    modelVersion: null
  },
  codeVersion: "test",
  runId: null
};

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
