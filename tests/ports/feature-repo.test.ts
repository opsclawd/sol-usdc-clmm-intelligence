import { describe, it, expect } from "vitest";
import { FakeFeatureRepo } from "../../tests/fakes/fake-feature-repo.js";
import { DEFAULT_CONFIDENCE, DEFAULT_PROVENANCE } from "../helpers/taxonomy-fixtures.js";
import type { FeatureKind, StaleBehavior } from "../../src/contracts/taxonomy.js";

const FEATURE_INSERT: {
  featureKind: FeatureKind;
  signalClass: "deterministic";
  evidenceFamily: "clmm_state";
  confidence: typeof DEFAULT_CONFIDENCE;
  provenance: typeof DEFAULT_PROVENANCE;
  derivationKey: string;
  structuredPayload: unknown;
  status: "AVAILABLE";
  unit: "PPM";
  value?: number | null;
  pair?: string;
  poolId?: string | null;
  positionId?: string | null;
  calculatorVersion?: string;
  selectionVersion?: string;
  inputObservationIds?: number[];
  rejectedObservationIds?: number[];
  warnings?: readonly string[];
  reasons?: readonly string[];
  confidenceComposite?: number | null;
  confidenceLevel?: string | null;
  validUntilUnixMs?: number | null;
  isStale?: boolean;
  staleBehavior?: StaleBehavior | null;
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

describe("DerivedFeatureRepo listBundleCandidates", () => {
  it("returns only bounded SOL/USDC candidates for the seven requested kinds", async () => {
    const repo = new FakeFeatureRepo();

    await repo.insert(
      makeInsert({
        derivationKey: "pool=abc,position=1",
        featureKind: "range_location",
        value: 0.5,
        asOfUnixMs: 1000,
        payloadHash: "hash1",
        receivedAtUnixMs: 1001,
        pair: "SOL/USDC",
        poolId: "abc",
        positionId: "1"
      })
    );

    await repo.insert(
      makeInsert({
        derivationKey: "pool=abc,position=1",
        featureKind: "distance_to_lower",
        value: 0.1,
        asOfUnixMs: 1000,
        payloadHash: "hash2",
        receivedAtUnixMs: 1002,
        pair: "SOL/USDC",
        poolId: "abc",
        positionId: "1"
      })
    );

    await repo.insert(
      makeInsert({
        derivationKey: "pool=abc,position=1",
        featureKind: "distance_to_upper",
        value: 0.2,
        asOfUnixMs: 1000,
        payloadHash: "hash3",
        receivedAtUnixMs: 1003,
        pair: "SOL/USDC",
        poolId: "abc",
        positionId: "1"
      })
    );

    await repo.insert(
      makeInsert({
        derivationKey: "pool=abc,position=1",
        featureKind: "oracle_dex_divergence",
        value: 10,
        asOfUnixMs: 1000,
        payloadHash: "hash4",
        receivedAtUnixMs: 1004,
        pair: "SOL/USDC",
        poolId: null,
        positionId: null
      })
    );

    await repo.insert(
      makeInsert({
        derivationKey: "pool=abc,position=1",
        featureKind: "oracle_confidence_width",
        value: 5,
        asOfUnixMs: 1000,
        payloadHash: "hash5",
        receivedAtUnixMs: 1005,
        pair: "SOL/USDC",
        poolId: null,
        positionId: null
      })
    );

    await repo.insert(
      makeInsert({
        derivationKey: "pool=abc,position=1",
        featureKind: "realized_volatility_1h",
        value: 3,
        asOfUnixMs: 1000,
        payloadHash: "hash6",
        receivedAtUnixMs: 1006,
        pair: "SOL/USDC",
        poolId: null,
        positionId: null
      })
    );

    await repo.insert(
      makeInsert({
        derivationKey: "pool=abc",
        featureKind: "volume_liquidity_ratio_24h",
        value: 0.8,
        asOfUnixMs: 1000,
        payloadHash: "hash7",
        receivedAtUnixMs: 1007,
        pair: "SOL/USDC",
        poolId: "abc",
        positionId: null
      })
    );

    const candidates = await repo.listBundleCandidates({
      featureKinds: [
        "range_location",
        "distance_to_lower",
        "distance_to_upper",
        "oracle_dex_divergence",
        "oracle_confidence_width",
        "realized_volatility_1h",
        "volume_liquidity_ratio_24h"
      ],
      pair: "SOL/USDC",
      asOfAtOrAfterUnixMs: 900,
      asOfAtOrBeforeUnixMs: 1100,
      receivedAtOrBeforeUnixMs: 2000
    });

    expect(candidates).toHaveLength(7);
    const ids = candidates.map((c) => c.id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("filters by asOfUnixMs bounds", async () => {
    const repo = new FakeFeatureRepo();

    await repo.insert(
      makeInsert({
        derivationKey: "key1",
        featureKind: "range_location",
        value: 0.5,
        asOfUnixMs: 500,
        payloadHash: "hash1",
        receivedAtUnixMs: 600,
        poolId: "abc",
        positionId: "1"
      })
    );

    await repo.insert(
      makeInsert({
        derivationKey: "key2",
        featureKind: "range_location",
        value: 0.6,
        asOfUnixMs: 1500,
        payloadHash: "hash2",
        receivedAtUnixMs: 1600,
        poolId: "abc",
        positionId: "1"
      })
    );

    const candidates = await repo.listBundleCandidates({
      featureKinds: ["range_location"],
      pair: "SOL/USDC",
      asOfAtOrAfterUnixMs: 1000,
      asOfAtOrBeforeUnixMs: 2000,
      receivedAtOrBeforeUnixMs: 3000
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.asOfUnixMs).toBe(1500);
  });

  it("filters by receivedAtUnixMs bound", async () => {
    const repo = new FakeFeatureRepo();

    await repo.insert(
      makeInsert({
        derivationKey: "key1",
        featureKind: "range_location",
        value: 0.5,
        asOfUnixMs: 1000,
        payloadHash: "hash1",
        receivedAtUnixMs: 5000,
        poolId: "abc",
        positionId: "1"
      })
    );

    await repo.insert(
      makeInsert({
        derivationKey: "key2",
        featureKind: "range_location",
        value: 0.6,
        asOfUnixMs: 1000,
        payloadHash: "hash2",
        receivedAtUnixMs: 1500,
        poolId: "abc",
        positionId: "1"
      })
    );

    const candidates = await repo.listBundleCandidates({
      featureKinds: ["range_location"],
      pair: "SOL/USDC",
      asOfAtOrAfterUnixMs: 0,
      asOfAtOrBeforeUnixMs: 2000,
      receivedAtOrBeforeUnixMs: 2000
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.receivedAtUnixMs).toBe(1500);
  });

  it("returns results sorted by asOfUnixMs, receivedAtUnixMs, id ascending", async () => {
    const repo = new FakeFeatureRepo();

    await repo.insert(
      makeInsert({
        derivationKey: "key1",
        featureKind: "range_location",
        value: 0.5,
        asOfUnixMs: 1000,
        payloadHash: "hash1",
        receivedAtUnixMs: 1000,
        poolId: "abc",
        positionId: "1"
      })
    );

    await repo.insert(
      makeInsert({
        derivationKey: "key2",
        featureKind: "range_location",
        value: 0.6,
        asOfUnixMs: 2000,
        payloadHash: "hash2",
        receivedAtUnixMs: 2000,
        poolId: "abc",
        positionId: "1"
      })
    );

    await repo.insert(
      makeInsert({
        derivationKey: "key3",
        featureKind: "range_location",
        value: 0.7,
        asOfUnixMs: 1000,
        payloadHash: "hash3",
        receivedAtUnixMs: 3000,
        poolId: "abc",
        positionId: "1"
      })
    );

    const candidates = await repo.listBundleCandidates({
      featureKinds: ["range_location"],
      pair: "SOL/USDC",
      asOfAtOrAfterUnixMs: 0,
      asOfAtOrBeforeUnixMs: 3000,
      receivedAtOrBeforeUnixMs: 5000
    });

    expect(candidates).toHaveLength(3);
    expect(candidates[0]!.id).toBe(1);
    expect(candidates[1]!.id).toBe(3);
    expect(candidates[2]!.id).toBe(2);
  });

  it("filters out non-SOL/USDC pairs", async () => {
    const repo = new FakeFeatureRepo();

    await repo.insert(
      makeInsert({
        derivationKey: "key1",
        featureKind: "range_location",
        value: 0.5,
        asOfUnixMs: 1000,
        payloadHash: "hash1",
        receivedAtUnixMs: 1001,
        pair: "SOL/USDC",
        poolId: "abc",
        positionId: "1"
      })
    );

    await repo.insert(
      makeInsert({
        derivationKey: "key2",
        featureKind: "range_location",
        value: 0.6,
        asOfUnixMs: 1000,
        payloadHash: "hash2",
        receivedAtUnixMs: 1002,
        pair: "ETH/USDC",
        poolId: "abc",
        positionId: "1"
      })
    );

    const candidates = await repo.listBundleCandidates({
      featureKinds: ["range_location"],
      pair: "SOL/USDC",
      asOfAtOrAfterUnixMs: 0,
      asOfAtOrBeforeUnixMs: 2000,
      receivedAtOrBeforeUnixMs: 2000
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.pair).toBe("SOL/USDC");
  });
});
