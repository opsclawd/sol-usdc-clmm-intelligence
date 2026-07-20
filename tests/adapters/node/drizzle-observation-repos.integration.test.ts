import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, and, gte } from "drizzle-orm";
import { rawObservations } from "../../../src/db/schema/raw-observations.js";
import { normalizedObservations } from "../../../src/db/schema/normalized-observations.js";
import { DrizzleObservationRepo } from "../../../src/adapters/node/drizzle-observation-repo.js";
import { DrizzleNormalizedObservationRepo } from "../../../src/adapters/node/drizzle-normalized-observation-repo.js";
import { createDb } from "../../../src/db/db.js";
import { canonicalHash } from "../../../src/domain/content-hash.js";
import type { Db } from "../../../src/db/db.js";
import type { Source } from "../../../src/contracts/taxonomy.js";
import { DEFAULT_CONFIDENCE, DEFAULT_PROVENANCE } from "../../helpers/taxonomy-fixtures.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const EXTRA_SOURCES: Source[] = ["pyth-hermes", "jupiter-quote"];

describe("DrizzleObservationRepo integration", () => {
  if (!TEST_DB_URL) {
    it("skipping: TEST_DATABASE_URL not set", () => {
      expect(true).toBe(true);
    });
    return;
  }

  let db: Db;
  let repo: DrizzleObservationRepo;
  let normalizedRepo: DrizzleNormalizedObservationRepo;
  let client: ReturnType<typeof import("postgres")>;

  beforeAll(() => {
    const { db: database, client: pgClient } = createDb(TEST_DB_URL);
    db = database;
    client = pgClient;
    repo = new DrizzleObservationRepo(db);
    normalizedRepo = new DrizzleNormalizedObservationRepo(db);
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    await db.delete(normalizedObservations);
    await db
      .delete(rawObservations)
      .where(
        and(eq(rawObservations.source, "clmm-v2-bundle"), gte(rawObservations.observedAtUnixMs, 0))
      );
  });

  describe("insertOrClassify returns inserted for a new source identity", () => {
    it("creates one immutable pending row", async () => {
      const hash = await canonicalHash({ test: "data" });
      const result = await repo.insertOrClassify({
        source: "clmm-v2-bundle",
        sourceObservationKey: `obs-key-new-${Date.now()}`,
        observedAtUnixMs: 1000,
        fetchedAtUnixMs: 1001,
        payloadHash: hash,
        payloadCanonical: '{"test":"data"}',
        receivedAtUnixMs: 1002
      });

      expect(result.outcome).toBe("inserted");
      expect(result.row.parseStatus).toBe("pending");
    });
  });

  describe("insertOrClassify returns identical_replay for equal identity and content", () => {
    it("returns the existing row without mutation", async () => {
      const key = `identical-key-${Date.now()}`;
      const hash = await canonicalHash({ test: "identical" });

      const first = await repo.insertOrClassify({
        source: "clmm-v2-bundle",
        sourceObservationKey: key,
        observedAtUnixMs: 1000,
        fetchedAtUnixMs: 1001,
        payloadHash: hash,
        payloadCanonical: '{"test":"identical"}',
        receivedAtUnixMs: 1002
      });

      const second = await repo.insertOrClassify({
        source: "clmm-v2-bundle",
        sourceObservationKey: key,
        observedAtUnixMs: 2000,
        fetchedAtUnixMs: 2001,
        payloadHash: hash,
        payloadCanonical: '{"test":"identical"}',
        receivedAtUnixMs: 2002
      });

      expect(second.outcome).toBe("identical_replay");
      expect(second.row.id).toBe(first.row.id);
    });
  });

  describe("insertOrClassify returns conflict for equal identity and unequal content", () => {
    it("exposes existing/incoming hashes and preserves stored evidence", async () => {
      const key = `conflict-key-${Date.now()}`;
      const hash1 = await canonicalHash({ test: "data1" });
      const hash2 = await canonicalHash({ test: "data2" });

      await repo.insertOrClassify({
        source: "clmm-v2-bundle",
        sourceObservationKey: key,
        observedAtUnixMs: 1000,
        fetchedAtUnixMs: 1001,
        payloadHash: hash1,
        payloadCanonical: '{"test":"data1"}',
        receivedAtUnixMs: 1002
      });

      const conflict = await repo.insertOrClassify({
        source: "clmm-v2-bundle",
        sourceObservationKey: key,
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

      const stillStored = await repo.findByIdentity("clmm-v2-bundle", key);
      expect(stillStored!.payloadHash).toBe(hash1);
    });
  });

  describe("equal content under distinct source identities creates distinct raw rows", () => {
    it("prevents cross-wallet collapse", async () => {
      const hash = await canonicalHash({ identical: "payload" });
      const key1 = `wallet-1-pos-${Date.now()}`;
      const key2 = `wallet-2-pos-${Date.now()}`;

      const row1 = await repo.insertOrClassify({
        source: "clmm-v2-bundle",
        sourceObservationKey: key1,
        observedAtUnixMs: 1000,
        fetchedAtUnixMs: 1001,
        payloadHash: hash,
        payloadCanonical: '{"identical":"payload"}',
        receivedAtUnixMs: 1002
      });

      const row2 = await repo.insertOrClassify({
        source: "clmm-v2-bundle",
        sourceObservationKey: key2,
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
      const key = `immutable-key-${Date.now()}`;

      const inserted = await repo.insertOrClassify({
        source: "clmm-v2-bundle",
        sourceObservationKey: key,
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
      expect(reloaded!.payloadHash).toBe(inserted.row.payloadHash);
      expect(reloaded!.sourceObservationKey).toBe(inserted.row.sourceObservationKey);
    });
  });

  describe("concurrent equivalent inserts classify as one inserted and one identical replay", () => {
    it("requires unique-constraint recovery rather than check-then-insert alone", async () => {
      const key = `concurrent-key-${Date.now()}`;
      const hash = await canonicalHash({ concurrent: "test" });

      const [first, second] = await Promise.all([
        repo.insertOrClassify({
          source: "clmm-v2-bundle",
          sourceObservationKey: key,
          observedAtUnixMs: 1000,
          fetchedAtUnixMs: 1001,
          payloadHash: hash,
          payloadCanonical: '{"concurrent":"test"}',
          receivedAtUnixMs: 1002
        }),
        repo.insertOrClassify({
          source: "clmm-v2-bundle",
          sourceObservationKey: key,
          observedAtUnixMs: 1000,
          fetchedAtUnixMs: 1001,
          payloadHash: hash,
          payloadCanonical: '{"concurrent":"test"}',
          receivedAtUnixMs: 2002
        })
      ]);

      const outcomes = [first.outcome, second.outcome];
      expect(outcomes).toContain("inserted");
      expect(outcomes).toContain("identical_replay");
      expect(first.row.id).toBe(second.row.id);
    });
  });

  describe.each(EXTRA_SOURCES)("source-specific behavior for %s", (source) => {
    beforeEach(async () => {
      await db.delete(rawObservations).where(eq(rawObservations.source, source));
    });

    it("concurrent identical inserts classify as identical_replay", async () => {
      const key = `${source}-concurrent-identical-${Date.now()}`;
      const hash = await canonicalHash({ source, data: "identical" });

      const [first, second] = await Promise.all([
        repo.insertOrClassify({
          source,
          sourceObservationKey: key,
          observedAtUnixMs: 1000,
          fetchedAtUnixMs: 1001,
          payloadHash: hash,
          payloadCanonical: JSON.stringify({ source, data: "identical" }),
          receivedAtUnixMs: 1002
        }),
        repo.insertOrClassify({
          source,
          sourceObservationKey: key,
          observedAtUnixMs: 1000,
          fetchedAtUnixMs: 1001,
          payloadHash: hash,
          payloadCanonical: JSON.stringify({ source, data: "identical" }),
          receivedAtUnixMs: 2002
        })
      ]);

      const outcomes = [first.outcome, second.outcome];
      expect(outcomes).toContain("inserted");
      expect(outcomes).toContain("identical_replay");
      expect(first.row.id).toBe(second.row.id);
    });

    it("changed content at same identity classifies as conflict", async () => {
      const key = `${source}-conflict-${Date.now()}`;
      const hash1 = await canonicalHash({ source, data: "v1" });
      const hash2 = await canonicalHash({ source, data: "v2" });

      await repo.insertOrClassify({
        source,
        sourceObservationKey: key,
        observedAtUnixMs: 1000,
        fetchedAtUnixMs: 1001,
        payloadHash: hash1,
        payloadCanonical: JSON.stringify({ source, data: "v1" }),
        receivedAtUnixMs: 1002
      });

      const conflict = await repo.insertOrClassify({
        source,
        sourceObservationKey: key,
        observedAtUnixMs: 2000,
        fetchedAtUnixMs: 2001,
        payloadHash: hash2,
        payloadCanonical: JSON.stringify({ source, data: "v2" }),
        receivedAtUnixMs: 2002
      });

      expect(conflict.outcome).toBe("conflict");
      expect(conflict.row.payloadHash).toBe(hash1);
      expect(
        (conflict as { outcome: "conflict"; incomingPayloadHash: string }).incomingPayloadHash
      ).toBe(hash2);

      const stillStored = await repo.findByIdentity(source, key);
      expect(stillStored!.payloadHash).toBe(hash1);
    });
  });

  describe("DrizzleNormalizedObservationRepo finds/reconstructs normalized replay row", () => {
    it("finds the normalized replay row by raw observation and kind", async () => {
      const hash = await canonicalHash({ test: "data" });
      const rawRes = await repo.insertOrClassify({
        source: "clmm-v2-bundle",
        sourceObservationKey: `key-${Date.now()}`,
        observedAtUnixMs: 1000,
        fetchedAtUnixMs: 1001,
        payloadHash: hash,
        payloadCanonical: '{"test":"data"}',
        receivedAtUnixMs: 1002
      });
      expect(rawRes.outcome).toBe("inserted");
      const rawId = rawRes.row.id;

      const normRow = await normalizedRepo.insert({
        rawObservationId: rawId,
        source: "clmm-v2-bundle",
        observationKind: "pool_statistics",
        signalClass: "deterministic",
        evidenceFamily: "clmm_state",
        payload: { volume24h: 123 },
        payloadHash: "hash-norm-1",
        confidence: DEFAULT_CONFIDENCE,
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: 1003
      });

      const found = await normalizedRepo.findByRawObservation(rawId, "pool_statistics");
      expect(found).not.toBeNull();
      expect(found!.id).toBe(normRow.id);
      expect(found!.observationKind).toBe("pool_statistics");
    });

    it("returns null instead of a row from another raw identity", async () => {
      const hash = await canonicalHash({ test: "data" });
      const rawRes = await repo.insertOrClassify({
        source: "clmm-v2-bundle",
        sourceObservationKey: `key-${Date.now()}`,
        observedAtUnixMs: 1000,
        fetchedAtUnixMs: 1001,
        payloadHash: hash,
        payloadCanonical: '{"test":"data"}',
        receivedAtUnixMs: 1002
      });
      expect(rawRes.outcome).toBe("inserted");
      const rawId = rawRes.row.id;

      await normalizedRepo.insert({
        rawObservationId: rawId,
        source: "clmm-v2-bundle",
        observationKind: "pool_statistics",
        signalClass: "deterministic",
        evidenceFamily: "clmm_state",
        payload: { volume24h: 123 },
        payloadHash: "hash-norm-1",
        confidence: DEFAULT_CONFIDENCE,
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: 1003
      });

      const found = await normalizedRepo.findByRawObservation(99999, "pool_statistics");
      expect(found).toBeNull();
    });
  });
});
