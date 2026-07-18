import { describe, it, expect, beforeEach } from "vitest";
import { FakeObservationRepo } from "../../tests/fakes/fake-observation-repo.js";
import { canonicalHash } from "../../src/domain/content-hash.js";

describe("RawObservationRepo contract", () => {
  let repo: FakeObservationRepo;

  beforeEach(() => {
    repo = new FakeObservationRepo();
  });

  describe("insertOrClassify returns inserted for a new source identity", () => {
    it("creates one immutable pending row", async () => {
      const hash = await canonicalHash({ test: "data" });
      const result = await repo.insertOrClassify({
        source: "clmm-v2-bundle",
        sourceObservationKey: "obs-key-new",
        observedAtUnixMs: 1000,
        fetchedAtUnixMs: 1001,
        payloadHash: hash,
        payloadCanonical: '{"test":"data"}',
        receivedAtUnixMs: 1002
      });

      expect(result.outcome).toBe("inserted");
      expect(result.row.id).toBe(1);
      expect(result.row.parseStatus).toBe("pending");
      expect(result.row.source).toBe("clmm-v2-bundle");
      expect(result.row.sourceObservationKey).toBe("obs-key-new");
      expect(result.row.payloadHash).toBe(hash);
    });
  });

  describe("insertOrClassify returns identical_replay for equal identity and content", () => {
    it("returns the existing row without mutation", async () => {
      const hash = await canonicalHash({ test: "data" });
      const first = await repo.insertOrClassify({
        source: "clmm-v2-bundle",
        sourceObservationKey: "obs-key-same",
        observedAtUnixMs: 1000,
        fetchedAtUnixMs: 1001,
        payloadHash: hash,
        payloadCanonical: '{"test":"data"}',
        receivedAtUnixMs: 1002
      });

      const second = await repo.insertOrClassify({
        source: "clmm-v2-bundle",
        sourceObservationKey: "obs-key-same",
        observedAtUnixMs: 2000,
        fetchedAtUnixMs: 2001,
        payloadHash: hash,
        payloadCanonical: '{"test":"data"}',
        receivedAtUnixMs: 2002
      });

      expect(second.outcome).toBe("identical_replay");
      expect(second.row.id).toBe(first.row.id);
      expect(second.row.observedAtUnixMs).toBe(first.row.observedAtUnixMs);
    });
  });

  describe("insertOrClassify returns conflict for equal identity and unequal content", () => {
    it("exposes existing/incoming hashes and preserves stored evidence", async () => {
      const hash1 = await canonicalHash({ test: "data1" });
      const hash2 = await canonicalHash({ test: "data2" });

      await repo.insertOrClassify({
        source: "clmm-v2-bundle",
        sourceObservationKey: "obs-key-conflict",
        observedAtUnixMs: 1000,
        fetchedAtUnixMs: 1001,
        payloadHash: hash1,
        payloadCanonical: '{"test":"data1"}',
        receivedAtUnixMs: 1002
      });

      const conflict = await repo.insertOrClassify({
        source: "clmm-v2-bundle",
        sourceObservationKey: "obs-key-conflict",
        observedAtUnixMs: 2000,
        fetchedAtUnixMs: 2001,
        payloadHash: hash2,
        payloadCanonical: '{"test":"data2"}',
        receivedAtUnixMs: 2002
      });

      expect(conflict.outcome).toBe("conflict");
      expect(conflict.row.payloadHash).toBe(hash1);
      expect(
        (conflict as { outcome: "conflict"; incomingPayloadHash: string }).incomingPayloadHash
      ).toBe(hash2);

      const stillStored = await repo.findByIdentity("clmm-v2-bundle", "obs-key-conflict");
      expect(stillStored!.payloadHash).toBe(hash1);
    });
  });

  describe("equal content under distinct source identities creates distinct raw rows", () => {
    it("prevents cross-wallet collapse", async () => {
      const hash = await canonicalHash({ identical: "payload" });

      const row1 = await repo.insertOrClassify({
        source: "clmm-v2-bundle",
        sourceObservationKey: "wallet-1/position-1",
        observedAtUnixMs: 1000,
        fetchedAtUnixMs: 1001,
        payloadHash: hash,
        payloadCanonical: '{"identical":"payload"}',
        receivedAtUnixMs: 1002
      });

      const row2 = await repo.insertOrClassify({
        source: "clmm-v2-bundle",
        sourceObservationKey: "wallet-2/position-1",
        observedAtUnixMs: 1000,
        fetchedAtUnixMs: 1001,
        payloadHash: hash,
        payloadCanonical: '{"identical":"payload"}',
        receivedAtUnixMs: 1002
      });

      expect(row1.outcome).toBe("inserted");
      expect(row2.outcome).toBe("inserted");
      expect(row2.row.id).not.toBe(row1.row.id);
    });
  });

  describe("updateParseStatus changes only parseStatus and findById reloads the persisted row", () => {
    it("keeps raw evidence immutable", async () => {
      const hash = await canonicalHash({ test: "immutable" });
      const inserted = await repo.insertOrClassify({
        source: "clmm-v2-bundle",
        sourceObservationKey: "obs-key-immutable",
        observedAtUnixMs: 1000,
        fetchedAtUnixMs: 1001,
        payloadHash: hash,
        payloadCanonical: '{"test":"immutable"}',
        receivedAtUnixMs: 1002
      });

      expect(inserted.row.parseStatus).toBe("pending");

      const updated = await repo.updateParseStatus(inserted.row.id, "parsed");
      expect(updated.parseStatus).toBe("parsed");

      const reloaded = await repo.findById(inserted.row.id);
      expect(reloaded!.parseStatus).toBe("parsed");

      expect(reloaded!.source).toBe(inserted.row.source);
      expect(reloaded!.sourceObservationKey).toBe(inserted.row.sourceObservationKey);
      expect(reloaded!.payloadHash).toBe(inserted.row.payloadHash);
      expect(reloaded!.payloadCanonical).toBe(inserted.row.payloadCanonical);
      expect(reloaded!.observedAtUnixMs).toBe(inserted.row.observedAtUnixMs);
      expect(reloaded!.receivedAtUnixMs).toBe(inserted.row.receivedAtUnixMs);
    });
  });

  describe("findByIdentity", () => {
    it("returns existing row by source and sourceObservationKey", async () => {
      const hash = await canonicalHash({ find: "test" });
      await repo.insertOrClassify({
        source: "clmm-v2-bundle",
        sourceObservationKey: "find-key-test",
        observedAtUnixMs: 1000,
        fetchedAtUnixMs: 1001,
        payloadHash: hash,
        payloadCanonical: '{"find":"test"}',
        receivedAtUnixMs: 1002
      });

      const found = await repo.findByIdentity("clmm-v2-bundle", "find-key-test");
      expect(found).toBeDefined();
      expect(found!.sourceObservationKey).toBe("find-key-test");
    });
  });

  describe("findByHash", () => {
    it("finds by source and payload hash", async () => {
      const hash = await canonicalHash({ hash: "test" });
      await repo.insertOrClassify({
        source: "clmm-v2-bundle",
        sourceObservationKey: "hash-key-test",
        observedAtUnixMs: 1000,
        fetchedAtUnixMs: 1001,
        payloadHash: hash,
        payloadCanonical: '{"hash":"test"}',
        receivedAtUnixMs: 1002
      });

      const found = await repo.findByHash("clmm-v2-bundle", hash);
      expect(found).toBeDefined();
      expect(found!.payloadHash).toBe(hash);
    });
  });

  describe("findBySource", () => {
    it("filters by source and since unix ms", async () => {
      await repo.insertOrClassify({
        source: "jupiter-price",
        sourceObservationKey: "obs-key-jup",
        observedAtUnixMs: 500,
        fetchedAtUnixMs: 501,
        payloadHash: "hash-1",
        payloadCanonical: "{}",
        receivedAtUnixMs: 502
      });

      await repo.insertOrClassify({
        source: "clmm-v2-bundle",
        sourceObservationKey: "obs-key-clmm",
        observedAtUnixMs: 1000,
        fetchedAtUnixMs: 1001,
        payloadHash: "hash-2",
        payloadCanonical: "{}",
        receivedAtUnixMs: 1002
      });

      const results = await repo.findBySource("jupiter-price", 400);
      expect(results).toHaveLength(1);
      expect(results[0]!.source).toBe("jupiter-price");

      const empty = await repo.findBySource("jupiter-price", 600);
      expect(empty).toHaveLength(0);
    });
  });

  describe("concurrent equivalent inserts classify as one inserted and one identical replay", () => {
    it("requires unique-constraint recovery rather than check-then-insert alone", async () => {
      const hash = await canonicalHash({ concurrent: "test" });

      const [first, second] = await Promise.all([
        repo.insertOrClassify({
          source: "clmm-v2-bundle",
          sourceObservationKey: "concurrent-key",
          observedAtUnixMs: 1000,
          fetchedAtUnixMs: 1001,
          payloadHash: hash,
          payloadCanonical: '{"concurrent":"test"}',
          receivedAtUnixMs: 1002
        }),
        repo.insertOrClassify({
          source: "clmm-v2-bundle",
          sourceObservationKey: "concurrent-key",
          observedAtUnixMs: 1000,
          fetchedAtUnixMs: 1001,
          payloadHash: hash,
          payloadCanonical: '{"concurrent":"test"}',
          receivedAtUnixMs: 1002
        })
      ]);

      const outcomes = [first.outcome, second.outcome];
      expect(outcomes).toContain("inserted");
      expect(outcomes).toContain("identical_replay");
      expect(first.row.id).toBe(second.row.id);
    });
  });
});
