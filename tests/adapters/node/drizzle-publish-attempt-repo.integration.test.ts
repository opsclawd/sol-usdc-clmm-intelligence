/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { publishAttempts } from "../../../src/db/schema/publish-attempts.js";
import { DrizzlePublishAttemptRepo } from "../../../src/adapters/node/drizzle-publish-attempt-repo.js";
import { createDb } from "../../../src/db/db.js";
import type { Db } from "../../../src/db/db.js";
import type {
  PublishAttemptInsertOutcome,
  PublishAttemptStatus
} from "../../../src/ports/publish-attempt-repo.js";

function assertConflict(
  outcome: PublishAttemptInsertOutcome
): asserts outcome is Extract<PublishAttemptInsertOutcome, { outcome: "conflict" }> {
  if (outcome.outcome !== "conflict") {
    throw new Error(`expected outcome "conflict", got "${outcome.outcome}"`);
  }
}

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

function makeAttempt(
  overrides: Partial<{
    target: string;
    targetEndpoint: string;
    evidenceBundleId: number;
    researchBriefId: number | null;
    idempotencyKey: string;
    requestHash: string;
    payloadHash: string;
    status: PublishAttemptStatus;
    httpStatus: number | null;
    responseBody: unknown | null;
    errorCode: string | null;
    errorMessage: string | null;
    attemptNumber: number;
    firstAttemptedAtUnixMs: number;
    completedAtUnixMs: number | null;
    receivedAtUnixMs: number;
  }> = {}
) {
  return {
    target: "regime-engine",
    targetEndpoint: "/v1/evidence/sol-usdc",
    evidenceBundleId: 9001,
    researchBriefId: null,
    idempotencyKey: `attempt-integ-${Date.now()}-${Math.random()}`.slice(0, 64).padEnd(64, "a"),
    requestHash: "a".repeat(64),
    payloadHash: "a".repeat(64),
    status: "pending" as PublishAttemptStatus,
    httpStatus: null,
    responseBody: null,
    errorCode: null,
    errorMessage: null,
    attemptNumber: 1,
    firstAttemptedAtUnixMs: 1000,
    completedAtUnixMs: null,
    receivedAtUnixMs: 1001,
    ...overrides
  };
}

describe("DrizzlePublishAttemptRepo integration", () => {
  if (!TEST_DB_URL) {
    it("skipping: TEST_DATABASE_URL not set", () => {
      expect(true).toBe(true);
    });
    return;
  }

  let db: Db;
  let repo: DrizzlePublishAttemptRepo;
  let client: ReturnType<typeof import("postgres")>;

  beforeAll(() => {
    const { db: database, client: pgClient } = createDb(TEST_DB_URL);
    db = database;
    client = pgClient;
    repo = new DrizzlePublishAttemptRepo(db);
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    await db.delete(publishAttempts);
  });

  describe("records a new immutable attempt as inserted", () => {
    it("inserts a previously unseen exact attempt identity as inserted", async () => {
      const insert = makeAttempt();

      const result = await repo.insert(insert);

      expect(result.outcome).toBe("inserted");
      expect(result.row.id).toBeGreaterThan(0);
      expect(result.row.target).toBe(insert.target);
      expect(result.row.idempotencyKey).toBe(insert.idempotencyKey);
      expect(result.row.attemptNumber).toBe(insert.attemptNumber);
    });
  });

  describe("records a higher retry number without mutating the previous attempt", () => {
    it("creates a new row for attempt 2 and leaves attempt 1 unchanged", async () => {
      const insert1 = makeAttempt({ attemptNumber: 1 });
      const insert2 = makeAttempt({ attemptNumber: 2 });

      const first = await repo.insert(insert1);
      const second = await repo.insert(insert2);

      expect(first.outcome).toBe("inserted");
      expect(second.outcome).toBe("inserted");
      expect(first.row.id).not.toBe(second.row.id);
      expect(first.row.attemptNumber).toBe(1);
      expect(second.row.attemptNumber).toBe(2);

      const all = await repo.findByTargetAndKey(insert1.target, insert1.idempotencyKey);
      expect(all).toHaveLength(2);
    });
  });

  describe("returns conflict and the stored winner for an exact attempt identity collision", () => {
    it("returns conflict when target, key, and attempt number are identical", async () => {
      const insert = makeAttempt();

      const first = await repo.insert(insert);
      const second = await repo.insert(insert);

      expect(second.outcome).toBe("conflict");
      assertConflict(second);
      expect(second.row.id).toBe(first.row.id);
      expect(second.row.attemptNumber).toBe(1);

      const stored = await db.select().from(publishAttempts);
      expect(stored).toHaveLength(1);
    });
  });

  describe("persists a missing bundle and missing brief as logical references", () => {
    it("succeeds even when evidenceBundleId does not exist in bundles table", async () => {
      const insert = makeAttempt({ evidenceBundleId: 999999 });

      const result = await repo.insert(insert);

      expect(result.outcome).toBe("inserted");
      expect(result.row.evidenceBundleId).toBe(999999);
    });
  });

  describe("round trips a nullable research brief and nullable response fields", () => {
    it("null brief, http status, response, error, and completion round-trip as null", async () => {
      const insert = makeAttempt({
        researchBriefId: null,
        httpStatus: null,
        responseBody: null,
        errorCode: null,
        errorMessage: null,
        completedAtUnixMs: null
      });

      const result = await repo.insert(insert);

      expect(result.outcome).toBe("inserted");
      expect(result.row.researchBriefId).toBeNull();
      expect(result.row.httpStatus).toBeNull();
      expect(result.row.responseBody).toBeNull();
      expect(result.row.errorCode).toBeNull();
      expect(result.row.errorMessage).toBeNull();
      expect(result.row.completedAtUnixMs).toBeNull();
    });
  });

  describe("finds target attempts in attempt-number order", () => {
    it("returns all retries sorted by attempt number ascending and id ascending", async () => {
      const target = "regime-engine";
      const key = `attempt-order-${Date.now()}`;

      await repo.insert(
        makeAttempt({ target, idempotencyKey: key, attemptNumber: 3, receivedAtUnixMs: 1003 })
      );
      await repo.insert(
        makeAttempt({ target, idempotencyKey: key, attemptNumber: 1, receivedAtUnixMs: 1001 })
      );
      await repo.insert(
        makeAttempt({ target, idempotencyKey: key, attemptNumber: 2, receivedAtUnixMs: 1002 })
      );

      const found = await repo.findByTargetAndKey(target, key);

      expect(found).toHaveLength(3);
      expect(found[0]!.attemptNumber).toBe(1);
      expect(found[1]!.attemptNumber).toBe(2);
      expect(found[2]!.attemptNumber).toBe(3);
    });
  });

  describe("finds bundle attempts in deterministic recency order", () => {
    it("returns bundle attempts sorted by received time descending and id descending", async () => {
      const bundleId = 9001;

      await repo.insert(
        makeAttempt({ evidenceBundleId: bundleId, receivedAtUnixMs: 1001, attemptNumber: 1 })
      );
      await repo.insert(
        makeAttempt({ evidenceBundleId: bundleId, receivedAtUnixMs: 1003, attemptNumber: 2 })
      );
      await repo.insert(
        makeAttempt({ evidenceBundleId: bundleId, receivedAtUnixMs: 1002, attemptNumber: 3 })
      );

      const found = await repo.findByBundle(bundleId);

      expect(found).toHaveLength(3);
      expect(found[0]!.receivedAtUnixMs).toBe(1003);
      expect(found[1]!.receivedAtUnixMs).toBe(1002);
      expect(found[2]!.receivedAtUnixMs).toBe(1001);
    });
  });

  describe("bounds status lookups by status since time and limit", () => {
    it("filters by status and received time, orders by recency, and applies limit", async () => {
      const target = "regime-engine";
      const key = `status-bounds-${Date.now()}`;

      await repo.insert(
        makeAttempt({
          target,
          idempotencyKey: key,
          status: "pending",
          receivedAtUnixMs: 1001,
          attemptNumber: 1
        })
      );
      await repo.insert(
        makeAttempt({
          target,
          idempotencyKey: key,
          status: "sent",
          receivedAtUnixMs: 1002,
          attemptNumber: 2
        })
      );
      await repo.insert(
        makeAttempt({
          target,
          idempotencyKey: key,
          status: "sent",
          receivedAtUnixMs: 1003,
          attemptNumber: 3
        })
      );
      await repo.insert(
        makeAttempt({
          target,
          idempotencyKey: key,
          status: "sent",
          receivedAtUnixMs: 1004,
          attemptNumber: 4
        })
      );
      await repo.insert(
        makeAttempt({
          target,
          idempotencyKey: key,
          status: "sent",
          receivedAtUnixMs: 1005,
          attemptNumber: 5
        })
      );

      const result = await repo.findRecentByStatus("sent", 1002, 3);

      expect(result).toHaveLength(3);
      expect(result[0]!.receivedAtUnixMs).toBe(1005);
      expect(result[1]!.receivedAtUnixMs).toBe(1004);
      expect(result[2]!.receivedAtUnixMs).toBe(1003);
    });

    it("includes the since time boundary", async () => {
      const target = "regime-engine";
      const key = `status-since-${Date.now()}`;

      await repo.insert(
        makeAttempt({
          target,
          idempotencyKey: key,
          status: "pending",
          receivedAtUnixMs: 999,
          attemptNumber: 1
        })
      );
      await repo.insert(
        makeAttempt({
          target,
          idempotencyKey: key,
          status: "pending",
          receivedAtUnixMs: 1000,
          attemptNumber: 2
        })
      );
      await repo.insert(
        makeAttempt({
          target,
          idempotencyKey: key,
          status: "pending",
          receivedAtUnixMs: 1001,
          attemptNumber: 3
        })
      );

      const result = await repo.findRecentByStatus("pending", 1000, 10);

      expect(result).toHaveLength(2);
      expect(result[0]!.receivedAtUnixMs).toBe(1001);
      expect(result[1]!.receivedAtUnixMs).toBe(1000);
    });
  });

  describe("rejects a non-positive or non-integer status-query limit", () => {
    it("rejects limit 0", async () => {
      await expect(repo.findRecentByStatus("pending", 0, 0)).rejects.toThrow(
        /limit.*positive.*integer/i
      );
    });

    it("rejects negative limit", async () => {
      await expect(repo.findRecentByStatus("pending", 0, -1)).rejects.toThrow(
        /limit.*positive.*integer/i
      );
    });

    it("rejects non-integer limit 1.5", async () => {
      await expect(repo.findRecentByStatus("pending", 0, 1.5)).rejects.toThrow(
        /limit.*positive.*integer/i
      );
    });
  });

  describe("rejects invalid status HTTP attempt and timestamp values consistently", () => {
    it("rejects unsupported status value", async () => {
      const invalid = makeAttempt({ status: "invalid_status" as PublishAttemptStatus });

      await expect(repo.insert(invalid)).rejects.toThrow(/status/i);
    });

    it("rejects HTTP status 99", async () => {
      const invalid = makeAttempt({ httpStatus: 99 });

      await expect(repo.insert(invalid)).rejects.toThrow(/http.*status/i);
    });

    it("rejects HTTP status 600", async () => {
      const invalid = makeAttempt({ httpStatus: 600 });

      await expect(repo.insert(invalid)).rejects.toThrow(/http.*status/i);
    });

    it("rejects attempt number 0", async () => {
      const invalid = makeAttempt({ attemptNumber: 0 });

      await expect(repo.insert(invalid)).rejects.toThrow(/attempt.*number/i);
    });

    it("rejects negative firstAttemptedAtUnixMs", async () => {
      const invalid = makeAttempt({ firstAttemptedAtUnixMs: -1 });

      await expect(repo.insert(invalid)).rejects.toThrow(/timestamp/i);
    });

    it("rejects negative receivedAtUnixMs", async () => {
      const invalid = makeAttempt({ receivedAtUnixMs: -1 });

      await expect(repo.insert(invalid)).rejects.toThrow(/timestamp/i);
    });

    it("rejects completion before first attempt", async () => {
      const invalid = makeAttempt({
        firstAttemptedAtUnixMs: 1000,
        completedAtUnixMs: 999
      });

      await expect(repo.insert(invalid)).rejects.toThrow(/completed.*first/i);
    });
  });

  describe("database constraints reject invalid persisted values when the adapter is bypassed", () => {
    it("rejects invalid status via direct insert", async () => {
      await expect(
        db.insert(publishAttempts).values({
          target: "regime-engine",
          targetEndpoint: "/v1/evidence/sol-usdc",
          evidenceBundleId: 9001,
          researchBriefId: null,
          idempotencyKey: `db-constraint-status-${Date.now()}`,
          requestHash: "a".repeat(64),
          payloadHash: "a".repeat(64),
          status: "invalid_status",
          httpStatus: null,
          responseBody: null,
          errorCode: null,
          errorMessage: null,
          attemptNumber: 1,
          firstAttemptedAtUnixMs: 1000,
          completedAtUnixMs: null,
          receivedAtUnixMs: 1001
        } as any)
      ).rejects.toThrow();
    });

    it("rejects invalid HTTP status via direct insert", async () => {
      await expect(
        db.insert(publishAttempts).values({
          target: "regime-engine",
          targetEndpoint: "/v1/evidence/sol-usdc",
          evidenceBundleId: 9001,
          researchBriefId: null,
          idempotencyKey: `db-constraint-http-${Date.now()}`,
          requestHash: "a".repeat(64),
          payloadHash: "a".repeat(64),
          status: "pending",
          httpStatus: 99,
          responseBody: null,
          errorCode: null,
          errorMessage: null,
          attemptNumber: 1,
          firstAttemptedAtUnixMs: 1000,
          completedAtUnixMs: null,
          receivedAtUnixMs: 1001
        } as any)
      ).rejects.toThrow();
    });

    it("rejects non-positive attempt number via direct insert", async () => {
      await expect(
        db.insert(publishAttempts).values({
          target: "regime-engine",
          targetEndpoint: "/v1/evidence/sol-usdc",
          evidenceBundleId: 9001,
          researchBriefId: null,
          idempotencyKey: `db-constraint-attempt-${Date.now()}`,
          requestHash: "a".repeat(64),
          payloadHash: "a".repeat(64),
          status: "pending",
          httpStatus: null,
          responseBody: null,
          errorCode: null,
          errorMessage: null,
          attemptNumber: 0,
          firstAttemptedAtUnixMs: 1000,
          completedAtUnixMs: null,
          receivedAtUnixMs: 1001
        } as any)
      ).rejects.toThrow();
    });

    it("rejects negative timestamp via direct insert", async () => {
      await expect(
        db.insert(publishAttempts).values({
          target: "regime-engine",
          targetEndpoint: "/v1/evidence/sol-usdc",
          evidenceBundleId: 9001,
          researchBriefId: null,
          idempotencyKey: `db-constraint-ts-${Date.now()}`,
          requestHash: "a".repeat(64),
          payloadHash: "a".repeat(64),
          status: "pending",
          httpStatus: null,
          responseBody: null,
          errorCode: null,
          errorMessage: null,
          attemptNumber: 1,
          firstAttemptedAtUnixMs: -1,
          completedAtUnixMs: null,
          receivedAtUnixMs: 1001
        } as any)
      ).rejects.toThrow();
    });
  });
});
