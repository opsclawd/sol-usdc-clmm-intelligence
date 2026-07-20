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

  describe("insertMany behavioral invariants", () => {
    it("insertMany inserts every row or exposes none when one row fails", async () => {
      const repo = new FakeNormalizedObservationRepo();
      repo.failAtIndex = 1;

      const rows = [
        {
          rawObservationId: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          signalClass: "deterministic",
          evidenceFamily: "clmm_state",
          payload: { price: 150.0 },
          payloadHash: "hash-batch-1",
          confidence: DEFAULT_CONFIDENCE,
          provenance: DEFAULT_PROVENANCE,
          receivedAtUnixMs: 1000
        },
        {
          rawObservationId: 2,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          signalClass: "deterministic",
          evidenceFamily: "clmm_state",
          payload: { price: 151.0 },
          payloadHash: "hash-batch-2",
          confidence: DEFAULT_CONFIDENCE,
          provenance: DEFAULT_PROVENANCE,
          receivedAtUnixMs: 1001
        },
        {
          rawObservationId: 3,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          signalClass: "deterministic",
          evidenceFamily: "clmm_state",
          payload: { price: 152.0 },
          payloadHash: "hash-batch-3",
          confidence: DEFAULT_CONFIDENCE,
          provenance: DEFAULT_PROVENANCE,
          receivedAtUnixMs: 1002
        }
      ] as const;

      await expect(repo.insertMany(rows)).rejects.toThrow(
        "FakeNormalizedObservationRepo: fail at index 1"
      );

      const all = await repo.findBySource("clmm-v2-bundle", "pool_state", 0);
      expect(all).toHaveLength(0);
    });

    it("insertMany replay for the same raw kind and payload hash returns existing rows without duplicates", async () => {
      const repo = new FakeNormalizedObservationRepo();
      const row1 = await repo.insert({
        rawObservationId: 1,
        source: "clmm-v2-bundle",
        observationKind: "pool_state",
        signalClass: "deterministic",
        evidenceFamily: "clmm_state",
        payload: { price: 150.0 },
        payloadHash: "hash-replay-1",
        confidence: DEFAULT_CONFIDENCE,
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: 1000
      });

      const batchResult = await repo.insertMany([
        {
          rawObservationId: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          signalClass: "deterministic",
          evidenceFamily: "clmm_state",
          payload: { price: 150.0 },
          payloadHash: "hash-replay-1",
          confidence: DEFAULT_CONFIDENCE,
          provenance: DEFAULT_PROVENANCE,
          receivedAtUnixMs: 1000
        }
      ]);

      expect(batchResult).toHaveLength(1);
      expect(batchResult[0]!.id).toBe(row1.id);

      const all = await repo.findBySource("clmm-v2-bundle", "pool_state", 0);
      expect(all).toHaveLength(1);
    });

    it("equal normalized content from distinct raw observations creates distinct rows", async () => {
      const repo = new FakeNormalizedObservationRepo();
      const row1 = await repo.insert({
        rawObservationId: 1,
        source: "clmm-v2-bundle",
        observationKind: "pool_state",
        signalClass: "deterministic",
        evidenceFamily: "clmm_state",
        payload: { price: 150.0 },
        payloadHash: "hash-lineage-1",
        confidence: DEFAULT_CONFIDENCE,
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: 1000
      });

      const row2 = await repo.insert({
        rawObservationId: 2,
        source: "clmm-v2-bundle",
        observationKind: "pool_state",
        signalClass: "deterministic",
        evidenceFamily: "clmm_state",
        payload: { price: 150.0 },
        payloadHash: "hash-lineage-1",
        confidence: DEFAULT_CONFIDENCE,
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: 1001
      });

      expect(row1.id).not.toBe(row2.id);
      expect(row1.rawObservationId).not.toBe(row2.rawObservationId);
    });

    it("insertMany returns rows in input order across inserted and replayed members", async () => {
      const repo = new FakeNormalizedObservationRepo();
      const existing = await repo.insert({
        rawObservationId: 1,
        source: "clmm-v2-bundle",
        observationKind: "pool_state",
        signalClass: "deterministic",
        evidenceFamily: "clmm_state",
        payload: { price: 150.0 },
        payloadHash: "hash-order-1",
        confidence: DEFAULT_CONFIDENCE,
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: 1000
      });

      const batchResult = await repo.insertMany([
        {
          rawObservationId: 1,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          signalClass: "deterministic",
          evidenceFamily: "clmm_state",
          payload: { price: 150.0 },
          payloadHash: "hash-order-1",
          confidence: DEFAULT_CONFIDENCE,
          provenance: DEFAULT_PROVENANCE,
          receivedAtUnixMs: 1000
        },
        {
          rawObservationId: 2,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          signalClass: "deterministic",
          evidenceFamily: "clmm_state",
          payload: { price: 151.0 },
          payloadHash: "hash-order-2",
          confidence: DEFAULT_CONFIDENCE,
          provenance: DEFAULT_PROVENANCE,
          receivedAtUnixMs: 1001
        },
        {
          rawObservationId: 3,
          source: "clmm-v2-bundle",
          observationKind: "pool_state",
          signalClass: "deterministic",
          evidenceFamily: "clmm_state",
          payload: { price: 152.0 },
          payloadHash: "hash-order-3",
          confidence: DEFAULT_CONFIDENCE,
          provenance: DEFAULT_PROVENANCE,
          receivedAtUnixMs: 1002
        }
      ]);

      expect(batchResult).toHaveLength(3);
      expect(batchResult[0]!.id).toBe(existing.id);
      expect(batchResult[1]!.payloadHash).toBe("hash-order-2");
      expect(batchResult[2]!.payloadHash).toBe("hash-order-3");
    });
  });

  describe("findLatestByKind and findBySource ordering invariants", () => {
    it("findBySource sorts rows by receivedAtUnixMs ascending", async () => {
      const repo = new FakeNormalizedObservationRepo();
      await repo.insert({
        rawObservationId: 1,
        source: "clmm-v2-bundle",
        observationKind: "pool_state",
        signalClass: "deterministic",
        evidenceFamily: "clmm_state",
        payload: { price: 150.0 },
        payloadHash: "hash-sort-1",
        confidence: DEFAULT_CONFIDENCE,
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: 3000
      });
      await repo.insert({
        rawObservationId: 2,
        source: "clmm-v2-bundle",
        observationKind: "pool_state",
        signalClass: "deterministic",
        evidenceFamily: "clmm_state",
        payload: { price: 151.0 },
        payloadHash: "hash-sort-2",
        confidence: DEFAULT_CONFIDENCE,
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: 1000
      });
      await repo.insert({
        rawObservationId: 3,
        source: "clmm-v2-bundle",
        observationKind: "pool_state",
        signalClass: "deterministic",
        evidenceFamily: "clmm_state",
        payload: { price: 152.0 },
        payloadHash: "hash-sort-3",
        confidence: DEFAULT_CONFIDENCE,
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: 2000
      });

      const results = await repo.findBySource("clmm-v2-bundle", "pool_state", 0);
      expect(results).toHaveLength(3);
      expect(results[0]!.receivedAtUnixMs).toBe(1000);
      expect(results[1]!.receivedAtUnixMs).toBe(2000);
      expect(results[2]!.receivedAtUnixMs).toBe(3000);
    });

    it("findLatestByKind returns the single newest row by receivedAtUnixMs", async () => {
      const repo = new FakeNormalizedObservationRepo();
      const first = await repo.findLatestByKind("clmm-v2-bundle", "pool_state");
      expect(first).toBeNull();

      await repo.insert({
        rawObservationId: 1,
        source: "clmm-v2-bundle",
        observationKind: "pool_state",
        signalClass: "deterministic",
        evidenceFamily: "clmm_state",
        payload: { price: 150.0 },
        payloadHash: "hash-latest-1",
        confidence: DEFAULT_CONFIDENCE,
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: 1000
      });
      await repo.insert({
        rawObservationId: 2,
        source: "clmm-v2-bundle",
        observationKind: "pool_state",
        signalClass: "deterministic",
        evidenceFamily: "clmm_state",
        payload: { price: 151.0 },
        payloadHash: "hash-latest-2",
        confidence: DEFAULT_CONFIDENCE,
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: 3000
      });
      await repo.insert({
        rawObservationId: 3,
        source: "clmm-v2-bundle",
        observationKind: "pool_state",
        signalClass: "deterministic",
        evidenceFamily: "clmm_state",
        payload: { price: 152.0 },
        payloadHash: "hash-latest-3",
        confidence: DEFAULT_CONFIDENCE,
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: 2000
      });

      const latest = await repo.findLatestByKind("clmm-v2-bundle", "pool_state");
      expect(latest).not.toBeNull();
      expect(latest!.receivedAtUnixMs).toBe(3000);
      expect(latest!.payloadHash).toBe("hash-latest-2");
    });
  });

  describe("findByRawObservation", () => {
    it("finds the normalized replay row by raw observation and kind", async () => {
      const repo = new FakeNormalizedObservationRepo();
      const row = await repo.insert({
        rawObservationId: 100,
        source: "clmm-v2-bundle",
        observationKind: "pool_state",
        signalClass: "deterministic",
        evidenceFamily: "clmm_state",
        payload: { price: 150.0 },
        payloadHash: "hash-norm-100",
        confidence: DEFAULT_CONFIDENCE,
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: 1000
      });
      // insert another kind with same raw ID
      await repo.insert({
        rawObservationId: 100,
        source: "clmm-v2-bundle",
        observationKind: "position_state",
        signalClass: "deterministic",
        evidenceFamily: "clmm_state",
        payload: { positions: [] },
        payloadHash: "hash-norm-101",
        confidence: DEFAULT_CONFIDENCE,
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: 1000
      });

      const found = await repo.findByRawObservation(100, "pool_state");
      expect(found).not.toBeNull();
      expect(found!.id).toBe(row.id);
      expect(found!.observationKind).toBe("pool_state");
    });

    it("returns null instead of a row from another raw identity", async () => {
      const repo = new FakeNormalizedObservationRepo();
      await repo.insert({
        rawObservationId: 100,
        source: "clmm-v2-bundle",
        observationKind: "pool_state",
        signalClass: "deterministic",
        evidenceFamily: "clmm_state",
        payload: { price: 150.0 },
        payloadHash: "hash-norm-100",
        confidence: DEFAULT_CONFIDENCE,
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: 1000
      });

      const found = await repo.findByRawObservation(999, "pool_state");
      expect(found).toBeNull();
    });
  });
});
