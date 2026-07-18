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
});
