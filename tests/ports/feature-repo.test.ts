import { describe, it, expect } from "vitest";
import { FakeFeatureRepo } from "../../tests/fakes/fake-feature-repo.js";
import { DEFAULT_CONFIDENCE, DEFAULT_PROVENANCE } from "../helpers/taxonomy-fixtures.js";

const FEATURE_INSERT = {
  featureKind: "range_location" as const,
  signalClass: "deterministic" as const,
  evidenceFamily: "clmm_state" as const,
  confidence: DEFAULT_CONFIDENCE,
  provenance: DEFAULT_PROVENANCE,
  derivationKey: "test-derivation-key",
  structuredPayload: {},
  status: "AVAILABLE" as const,
  unit: "PPM" as const
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

    const found = await repo.findByKind("range_location", 900);
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
      receivedAtUnixMs: 501,
      derivationKey: "key1"
    });
    await repo.insert({
      ...FEATURE_INSERT,
      value: 0.2,
      asOfUnixMs: 1000,
      payloadHash: "hash2",
      receivedAtUnixMs: 1001,
      derivationKey: "key2"
    });

    const found = await repo.findByKind("range_location", 800);
    expect(found).toHaveLength(1);
    expect(found[0]!.value).toBe(0.2);
  });

  it("insert is idempotent by featureKind + derivationKey", async () => {
    const repo = new FakeFeatureRepo();
    const first = await repo.insert({
      ...FEATURE_INSERT,
      value: 0.15,
      asOfUnixMs: 1000,
      payloadHash: "dup1",
      receivedAtUnixMs: 1001,
      derivationKey: "dup-key"
    });
    const second = await repo.insert({
      ...FEATURE_INSERT,
      value: 0.15,
      asOfUnixMs: 1000,
      payloadHash: "dup1",
      receivedAtUnixMs: 1001,
      derivationKey: "dup-key"
    });
    expect(second.id).toBe(first.id);
    const all = await repo.findByKind("range_location", 0);
    expect(all).toHaveLength(1);
  });

  it("findByDerivationKey returns existing row", async () => {
    const repo = new FakeFeatureRepo();
    const inserted = await repo.insert({
      ...FEATURE_INSERT,
      value: 0.15,
      asOfUnixMs: 1000,
      payloadHash: "findme",
      receivedAtUnixMs: 1001,
      derivationKey: "findme-key"
    });
    const found = await repo.findByDerivationKey("range_location", "findme-key");
    expect(found).toBeDefined();
    expect(found!.id).toBe(inserted.id);
    const notFound = await repo.findByDerivationKey("range_location", "nope");
    expect(notFound).toBeUndefined();
  });
});
