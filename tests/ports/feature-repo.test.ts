import { describe, it, expect } from "vitest";
import { FakeFeatureRepo } from "../../tests/fakes/fake-feature-repo.js";
import { DEFAULT_CONFIDENCE, DEFAULT_PROVENANCE } from "../helpers/taxonomy-fixtures.js";

const FEATURE_INSERT: {
  featureKind: "range_location";
  signalClass: "deterministic";
  evidenceFamily: "clmm_state";
  confidence: typeof DEFAULT_CONFIDENCE;
  provenance: typeof DEFAULT_PROVENANCE;
  derivationKey: string;
  structuredPayload: unknown;
  status: "AVAILABLE";
  unit: "PPM";
  value?: number | null;
} = {
  featureKind: "range_location",
  signalClass: "deterministic",
  evidenceFamily: "clmm_state",
  confidence: DEFAULT_CONFIDENCE,
  provenance: DEFAULT_PROVENANCE,
  derivationKey: "test-derivation-key",
  structuredPayload: {},
  status: "AVAILABLE",
  unit: "PPM"
};

function makeInsert(
  overrides: Partial<typeof FEATURE_INSERT> & {
    derivationKey: string;
    asOfUnixMs: number;
    payloadHash: string;
    receivedAtUnixMs: number;
  }
) {
  return {
    ...FEATURE_INSERT,
    ...overrides
  };
}

describe("DerivedFeatureRepo contract", () => {
  it("inserts and finds by kind", async () => {
    const repo = new FakeFeatureRepo();
    await repo.insert(
      makeInsert({
        derivationKey: "key1",
        value: 0.15,
        asOfUnixMs: 1000,
        payloadHash: "abc123",
        receivedAtUnixMs: 1001
      })
    );

    const found = await repo.findByKind("range_location", 900);
    expect(found).toHaveLength(1);
    expect(found[0]!.value).toBe(0.15);
  });

  it("findByKind filters by sinceUnixMs", async () => {
    const repo = new FakeFeatureRepo();
    await repo.insert(
      makeInsert({
        derivationKey: "key1",
        value: 0.15,
        asOfUnixMs: 500,
        payloadHash: "hash1",
        receivedAtUnixMs: 501
      })
    );
    await repo.insert(
      makeInsert({
        derivationKey: "key2",
        value: 0.2,
        asOfUnixMs: 1000,
        payloadHash: "hash2",
        receivedAtUnixMs: 1001
      })
    );

    const found = await repo.findByKind("range_location", 800);
    expect(found).toHaveLength(1);
    expect(found[0]!.value).toBe(0.2);
  });

  it("insert is idempotent by featureKind + derivationKey", async () => {
    const repo = new FakeFeatureRepo();
    const first = await repo.insert(
      makeInsert({
        derivationKey: "dup-key",
        value: 0.15,
        asOfUnixMs: 1000,
        payloadHash: "dup1",
        receivedAtUnixMs: 1001
      })
    );
    const second = await repo.insert(
      makeInsert({
        derivationKey: "dup-key",
        value: 0.15,
        asOfUnixMs: 1000,
        payloadHash: "dup1",
        receivedAtUnixMs: 1001
      })
    );
    expect(second.id).toBe(first.id);
    const all = await repo.findByKind("range_location", 0);
    expect(all).toHaveLength(1);
  });

  it("findByDerivationKey returns existing row", async () => {
    const repo = new FakeFeatureRepo();
    const inserted = await repo.insert(
      makeInsert({
        derivationKey: "findme-key",
        value: 0.15,
        asOfUnixMs: 1000,
        payloadHash: "findme",
        receivedAtUnixMs: 1001
      })
    );
    const found = await repo.findByDerivationKey("range_location", "findme-key");
    expect(found).toBeDefined();
    expect(found!.id).toBe(inserted.id);
    const notFound = await repo.findByDerivationKey("range_location", "nope");
    expect(notFound).toBeUndefined();
  });
});

describe("DerivedFeatureRepo insertMany", () => {
  it("insertMany persists all rows or exposes none", async () => {
    const repo = new FakeFeatureRepo();
    const rows = [
      makeInsert({
        derivationKey: "batch-key-1",
        asOfUnixMs: 1000,
        payloadHash: "hash1",
        receivedAtUnixMs: 1001
      }),
      makeInsert({
        derivationKey: "batch-key-2",
        asOfUnixMs: 1001,
        payloadHash: "hash2",
        receivedAtUnixMs: 1002
      }),
      makeInsert({
        derivationKey: "batch-key-3",
        asOfUnixMs: 1002,
        payloadHash: "hash3",
        receivedAtUnixMs: 1003
      })
    ];

    const results = await repo.insertMany(rows);

    expect(results).toHaveLength(3);
    expect(results[0]!.derivationKey).toBe("batch-key-1");
    expect(results[1]!.derivationKey).toBe("batch-key-2");
    expect(results[2]!.derivationKey).toBe("batch-key-3");

    const all = await repo.findByKind("range_location", 0);
    expect(all).toHaveLength(3);
  });

  it("insertMany replay returns existing rows in caller order (all-conflict)", async () => {
    const repo = new FakeFeatureRepo();

    const originalRows = [
      makeInsert({
        derivationKey: "replay-key-1",
        asOfUnixMs: 1000,
        payloadHash: "hash1",
        receivedAtUnixMs: 1001
      }),
      makeInsert({
        derivationKey: "replay-key-2",
        asOfUnixMs: 1001,
        payloadHash: "hash2",
        receivedAtUnixMs: 1002
      }),
      makeInsert({
        derivationKey: "replay-key-3",
        asOfUnixMs: 1002,
        payloadHash: "hash3",
        receivedAtUnixMs: 1003
      })
    ];

    const originalResults = await repo.insertMany(originalRows);
    expect(originalResults).toHaveLength(3);

    const replayResults = await repo.insertMany(originalRows);

    expect(replayResults).toHaveLength(3);
    expect(replayResults[0]!.id).toBe(originalResults[0]!.id);
    expect(replayResults[1]!.id).toBe(originalResults[1]!.id);
    expect(replayResults[2]!.id).toBe(originalResults[2]!.id);
  });

  it("insertMany replay returns existing rows in caller order (mixed conflict)", async () => {
    const repo = new FakeFeatureRepo();

    const firstTwo = [
      makeInsert({
        derivationKey: "mixed-key-1",
        asOfUnixMs: 1000,
        payloadHash: "hash1",
        receivedAtUnixMs: 1001
      }),
      makeInsert({
        derivationKey: "mixed-key-2",
        asOfUnixMs: 1001,
        payloadHash: "hash2",
        receivedAtUnixMs: 1002
      })
    ];
    const firstResults = await repo.insertMany(firstTwo);
    expect(firstResults).toHaveLength(2);

    const mixedBatch = [
      makeInsert({
        derivationKey: "mixed-key-1",
        asOfUnixMs: 1000,
        payloadHash: "hash1",
        receivedAtUnixMs: 1001
      }),
      makeInsert({
        derivationKey: "mixed-key-2",
        asOfUnixMs: 1001,
        payloadHash: "hash2",
        receivedAtUnixMs: 1002
      }),
      makeInsert({
        derivationKey: "mixed-key-3",
        asOfUnixMs: 1002,
        payloadHash: "hash3",
        receivedAtUnixMs: 1003
      })
    ];
    const mixedResults = await repo.insertMany(mixedBatch);

    expect(mixedResults).toHaveLength(3);
    expect(mixedResults[0]!.id).toBe(firstResults[0]!.id);
    expect(mixedResults[1]!.id).toBe(firstResults[1]!.id);
    expect(mixedResults[2]!.derivationKey).toBe("mixed-key-3");
  });

  it("same derivation identity deduplicates sequential and concurrent replay", async () => {
    const repo = new FakeFeatureRepo();

    const batch = [
      makeInsert({
        derivationKey: "dedup-key",
        asOfUnixMs: 1000,
        payloadHash: "hash1",
        receivedAtUnixMs: 1001
      }),
      makeInsert({
        derivationKey: "dedup-key",
        asOfUnixMs: 1000,
        payloadHash: "hash1",
        receivedAtUnixMs: 1001
      })
    ];

    const results = await repo.insertMany(batch);

    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe(results[1]!.id);

    const all = await repo.findByKind("range_location", 0);
    expect(all).toHaveLength(1);
  });

  it("changed scope inputs versions or reasons produce distinct rows", async () => {
    const repo = new FakeFeatureRepo();

    const row1 = makeInsert({
      derivationKey: "v1",
      asOfUnixMs: 1000,
      payloadHash: "hash1",
      receivedAtUnixMs: 1001
    });
    const row2 = makeInsert({
      derivationKey: "v2",
      asOfUnixMs: 1000,
      payloadHash: "hash1",
      receivedAtUnixMs: 1001
    });
    const row3 = makeInsert({
      derivationKey: "v3",
      asOfUnixMs: 1000,
      payloadHash: "hash1",
      receivedAtUnixMs: 1001
    });

    const results = await repo.insertMany([row1, row2, row3]);

    expect(results).toHaveLength(3);
    expect(results[0]!.derivationKey).toBe("v1");
    expect(results[1]!.derivationKey).toBe("v2");
    expect(results[2]!.derivationKey).toBe("v3");

    const all = await repo.findByKind("range_location", 0);
    expect(all).toHaveLength(3);
  });

  it("insert returns row via insertMany wrapper", async () => {
    const repo = new FakeFeatureRepo();
    const single = await repo.insert(
      makeInsert({
        derivationKey: "single-key",
        value: 0.5,
        asOfUnixMs: 1000,
        payloadHash: "single-hash",
        receivedAtUnixMs: 1001
      })
    );

    expect(single.value).toBe(0.5);
    expect(single.derivationKey).toBe("single-key");
  });
});
