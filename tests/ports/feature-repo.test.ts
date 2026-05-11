import { describe, it, expect } from "vitest";
import { FakeFeatureRepo } from "../../tests/fakes/fake-feature-repo.js";

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

const FEATURE_INSERT = {
  featureKind: "fee_apr" as const,
  signalClass: "deterministic" as const,
  evidenceFamily: "clmm_economics" as const,
  confidence: DEFAULT_CONFIDENCE,
  provenance: DEFAULT_PROVENANCE
};

describe("DerivedFeatureRepo contract", () => {
  it("inserts and finds by kind", async () => {
    const repo = new FakeFeatureRepo();
    await repo.insert({
      ...FEATURE_INSERT,
      value: 0.15,
      asOfUnixMs: 1000,
      payloadHash: "abc123",
      receivedAtUnixMs: 1001
    });

    const found = await repo.findByKind("fee_apr", 900);
    expect(found).toHaveLength(1);
    expect(found[0]!.value).toBe(0.15);
  });

  it("findByKind filters by sinceUnixMs", async () => {
    const repo = new FakeFeatureRepo();
    await repo.insert({
      ...FEATURE_INSERT,
      value: 0.15,
      asOfUnixMs: 500,
      payloadHash: "hash1",
      receivedAtUnixMs: 501
    });
    await repo.insert({
      ...FEATURE_INSERT,
      value: 0.2,
      asOfUnixMs: 1000,
      payloadHash: "hash2",
      receivedAtUnixMs: 1001
    });

    const found = await repo.findByKind("fee_apr", 800);
    expect(found).toHaveLength(1);
    expect(found[0]!.value).toBe(0.2);
  });

  it("insert is idempotent by featureKind + payloadHash", async () => {
    const repo = new FakeFeatureRepo();
    const first = await repo.insert({
      ...FEATURE_INSERT,
      value: 0.15,
      asOfUnixMs: 1000,
      payloadHash: "dup1",
      receivedAtUnixMs: 1001
    });
    const second = await repo.insert({
      ...FEATURE_INSERT,
      value: 0.15,
      asOfUnixMs: 1000,
      payloadHash: "dup1",
      receivedAtUnixMs: 1001
    });
    expect(second.id).toBe(first.id);
    const all = await repo.findByKind("fee_apr", 0);
    expect(all).toHaveLength(1);
  });

  it("findByHash returns existing row", async () => {
    const repo = new FakeFeatureRepo();
    const inserted = await repo.insert({
      ...FEATURE_INSERT,
      value: 0.15,
      asOfUnixMs: 1000,
      payloadHash: "findme",
      receivedAtUnixMs: 1001
    });
    const found = await repo.findByHash("fee_apr", "findme");
    expect(found).toBeDefined();
    expect(found!.id).toBe(inserted.id);
    const notFound = await repo.findByHash("fee_apr", "nope");
    expect(notFound).toBeUndefined();
  });
});
