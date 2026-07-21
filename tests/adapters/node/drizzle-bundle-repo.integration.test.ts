import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { evidenceBundles } from "../../../src/db/schema/evidence-bundles.js";
import { DrizzleBundleRepo } from "../../../src/adapters/node/drizzle-bundle-repo.js";
import { createDb } from "../../../src/db/db.js";
import type { Db } from "../../../src/db/db.js";
import type { EvidenceBundleInsertOutcome } from "../../../src/ports/bundle-repo.js";
import { DEFAULT_CONFIDENCE, DEFAULT_PROVENANCE } from "../../helpers/taxonomy-fixtures.js";

function assertConflict(
  outcome: EvidenceBundleInsertOutcome
): asserts outcome is Extract<EvidenceBundleInsertOutcome, { outcome: "conflict" }> {
  if (outcome.outcome !== "conflict") {
    throw new Error(`expected outcome "conflict", got "${outcome.outcome}"`);
  }
}

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

function makeBundle(
  overrides: Partial<{
    schemaVersion: string;
    pair: string;
    asOfUnixMs: number;
    expiresAtUnixMs: number;
    payload: unknown;
    payloadHash: string;
    payloadCanonical: string;
    idempotencyKey: string;
    receivedAtUnixMs: number;
  }> = {}
) {
  const idemKey = `bundle-integ-${Date.now()}-${Math.random()}`;
  return {
    schemaVersion: "1.0",
    pair: "SOL/USDC",
    asOfUnixMs: 1000,
    expiresAtUnixMs: 2000,
    payload: { pair: "SOL/USDC" },
    payloadHash: "hash-1",
    payloadCanonical: '{"pair":"SOL/USDC"}',
    idempotencyKey: idemKey,
    confidence: DEFAULT_CONFIDENCE,
    provenance: DEFAULT_PROVENANCE,
    receivedAtUnixMs: 1001,
    ...overrides
  };
}

describe("DrizzleBundleRepo integration", () => {
  if (!TEST_DB_URL) {
    it("skipping: TEST_DATABASE_URL not set", () => {
      expect(true).toBe(true);
    });
    return;
  }

  let db: Db;
  let repo: DrizzleBundleRepo;
  let client: ReturnType<typeof import("postgres")>;

  beforeAll(() => {
    const { db: database, client: pgClient } = createDb(TEST_DB_URL);
    db = database;
    client = pgClient;
    repo = new DrizzleBundleRepo(db);
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    await db.delete(evidenceBundles);
  });

  describe("insertOrClassify returns inserted for a new logical identity", () => {
    it("creates one immutable row with exact canonical payload and hash", async () => {
      const insert = makeBundle();

      const result = await repo.insertOrClassify(insert);

      expect(result.outcome).toBe("inserted");
      expect(result.row.id).toBeGreaterThan(0);
      expect(result.row.payloadCanonical).toBe(insert.payloadCanonical);
      expect(result.row.payloadHash).toBe(insert.payloadHash);
    });
  });

  describe("insertOrClassify returns identical_replay for equal identity hash and canonical text", () => {
    it("returns the existing row without mutation", async () => {
      const insert = makeBundle();

      const first = await repo.insertOrClassify(insert);
      const second = await repo.insertOrClassify(insert);

      expect(second.outcome).toBe("identical_replay");
      expect(second.row.id).toBe(first.row.id);
    });

    it("does not update any field on replay", async () => {
      const insert = makeBundle({ receivedAtUnixMs: 1001 });

      const first = await repo.insertOrClassify(insert);
      const second = await repo.insertOrClassify({ ...insert, receivedAtUnixMs: 9999 });

      expect(second.outcome).toBe("identical_replay");
      expect(second.row.receivedAtUnixMs).toBe(first.row.receivedAtUnixMs);
    });
  });

  describe("insertOrClassify returns conflict for equal identity with different hash", () => {
    it("preserves the stored winner and exposes both hashes", async () => {
      const key = `conflict-hash-${Date.now()}`;
      const insert1 = makeBundle({
        idempotencyKey: key,
        payloadHash: "hash-winner",
        payloadCanonical: '{"pair":"SOL/USDC","winner":true}'
      });
      const insert2 = makeBundle({
        idempotencyKey: key,
        payloadHash: "hash-loser",
        payloadCanonical: '{"pair":"SOL/USDC","winner":false}'
      });

      const first = await repo.insertOrClassify(insert1);
      const second = await repo.insertOrClassify(insert2);

      expect(second.outcome).toBe("conflict");
      assertConflict(second);
      expect(second.row.id).toBe(first.row.id);
      expect(second.row.payloadHash).toBe("hash-winner");
      expect(second.incomingPayloadHash).toBe("hash-loser");
    });
  });

  describe("insertOrClassify returns conflict for equal identity and hash with different canonical text", () => {
    it("a collision cannot be mistaken for replay", async () => {
      const key = `conflict-canonical-${Date.now()}`;
      const insert1 = makeBundle({
        idempotencyKey: key,
        payloadCanonical: '{"pair":"SOL/USDC","v":1}'
      });
      const insert2 = makeBundle({
        idempotencyKey: key,
        payloadCanonical: '{"pair":"SOL/USDC","v":2}'
      });

      await repo.insertOrClassify(insert1);
      const second = await repo.insertOrClassify(insert2);

      expect(second.outcome).toBe("conflict");
      expect(second.row.id).toBeDefined();
    });
  });

  describe("insertOrClassify rejects jsonb not structurally equal to parsed canonical text", () => {
    it("storage consistency is checked before the insert attempt", async () => {
      const mismatchedInsert = {
        ...makeBundle(),
        payload: { pair: "SOL/USDC", extraField: true },
        payloadCanonical: '{"pair":"SOL/USDC"}'
      };

      await expect(repo.insertOrClassify(mismatchedInsert)).rejects.toThrow(
        /canonical.*payload|jsonb.*canonical|canonical.*jsonb/i
      );
    });
  });

  describe("concurrent identical inserts converge on one immutable row", () => {
    it("one call inserts and the other classifies as replay", async () => {
      const insert = makeBundle();

      const [first, second] = await Promise.all([
        repo.insertOrClassify(insert),
        repo.insertOrClassify(insert)
      ]);

      const outcomes = [first.outcome, second.outcome].sort();
      expect(outcomes).toEqual(["identical_replay", "inserted"]);
      const inserted = first.outcome === "inserted" ? first : second;
      const replayed = first.outcome === "identical_replay" ? first : second;
      expect(replayed.row.id).toBe(inserted.row.id);
    });
  });

  describe("concurrent conflicting inserts preserve one winner and report one conflict", () => {
    it("neither call overwrites the winner", async () => {
      const key = `concurrent-conflict-${Date.now()}`;
      const insert1 = makeBundle({
        idempotencyKey: key,
        payloadHash: "hash-a",
        payloadCanonical: '{"a":1}'
      });
      const insert2 = makeBundle({
        idempotencyKey: key,
        payloadHash: "hash-b",
        payloadCanonical: '{"b":2}'
      });

      const [result1, result2] = await Promise.all([
        repo.insertOrClassify(insert1),
        repo.insertOrClassify(insert2)
      ]);

      const hasConflict = [result1.outcome, result2.outcome].includes("conflict");
      expect(hasConflict).toBe(true);

      const winnerOutcome = result1.outcome === "inserted" ? result1 : result2;
      const conflictOutcome = result1.outcome === "conflict" ? result1 : result2;

      expect(conflictOutcome.outcome).toBe("conflict");
      assertConflict(conflictOutcome);
      expect(conflictOutcome.incomingPayloadHash).toBeDefined();
      expect(winnerOutcome.row.payloadHash).toBeDefined();
    });
  });

  describe("fails explicitly when the conflict winner disappears before reload", () => {
    it("concurrent deletion is an integrity error, not a replay", async () => {
      const insert = makeBundle();

      const first = await repo.insertOrClassify(insert);
      expect(first.outcome).toBe("inserted");

      await db.delete(evidenceBundles).where(eq(evidenceBundles.id, first.row.id));

      await expect(repo.insertOrClassify(insert)).rejects.toThrow(/not found|deleted|integrity/i);
    });
  });

  describe("findByPair and findLatestByPair retain existing behavior", () => {
    it("finds bundles by pair and time", async () => {
      await repo.insertOrClassify(makeBundle({ asOfUnixMs: 1000, idempotencyKey: "k1" }));
      await repo.insertOrClassify(makeBundle({ asOfUnixMs: 2000, idempotencyKey: "k2" }));

      const found = await repo.findByPair("SOL/USDC", 1500);
      expect(found).toHaveLength(1);
      expect(found[0]?.asOfUnixMs).toBe(2000);
    });

    it("findLatestByPair returns the most recent", async () => {
      await repo.insertOrClassify(
        makeBundle({ asOfUnixMs: 1000, idempotencyKey: "k1", receivedAtUnixMs: 1001 })
      );
      await repo.insertOrClassify(
        makeBundle({ asOfUnixMs: 2000, idempotencyKey: "k2", receivedAtUnixMs: 2001 })
      );

      const latest = await repo.findLatestByPair("SOL/USDC");
      expect(latest).toBeDefined();
      expect(latest!.asOfUnixMs).toBe(2000);
    });
  });
});
