/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import type {
  PublishAttemptInsert,
  PublishAttemptRepo,
  PublishAttemptInsertOutcome,
  PublishAttemptStatus
} from "../../src/ports/publish-attempt-repo.js";

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
): PublishAttemptInsert {
  return {
    target: "regime-engine",
    targetEndpoint: "/v1/evidence/sol-usdc",
    evidenceBundleId: 9001,
    researchBriefId: null,
    idempotencyKey: "a".repeat(64),
    requestHash: "a".repeat(64),
    payloadHash: "a".repeat(64),
    status: "pending",
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

function assertConflict(
  outcome: PublishAttemptInsertOutcome
): asserts outcome is Extract<PublishAttemptInsertOutcome, { outcome: "conflict" }> {
  if (outcome.outcome !== "conflict") {
    throw new Error(`expected outcome "conflict", got "${outcome.outcome}"`);
  }
}

describe("PublishAttemptRepo contract", () => {
  describe("records a new immutable attempt as inserted", () => {
    it("inserts a previously unseen exact attempt identity as inserted", async () => {
      const { FakePublishAttemptRepo } =
        await import("../../tests/fakes/fake-publish-attempt-repo.js");
      const repo: PublishAttemptRepo = new FakePublishAttemptRepo();
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
      const { FakePublishAttemptRepo } =
        await import("../../tests/fakes/fake-publish-attempt-repo.js");
      const repo: PublishAttemptRepo = new FakePublishAttemptRepo();
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
      const { FakePublishAttemptRepo } =
        await import("../../tests/fakes/fake-publish-attempt-repo.js");
      const repo: PublishAttemptRepo = new FakePublishAttemptRepo();
      const insert = makeAttempt();

      const first = await repo.insert(insert);
      const second = await repo.insert(insert);

      expect(second.outcome).toBe("conflict");
      assertConflict(second);
      expect(second.row.id).toBe(first.row.id);
      expect(second.row.attemptNumber).toBe(1);
    });
  });

  describe("persists a missing bundle and missing brief as logical references", () => {
    it("succeeds even when evidenceBundleId does not exist in bundles table", async () => {
      const { FakePublishAttemptRepo } =
        await import("../../tests/fakes/fake-publish-attempt-repo.js");
      const repo: PublishAttemptRepo = new FakePublishAttemptRepo();
      const insert = makeAttempt({ evidenceBundleId: 999999 });

      const result = await repo.insert(insert);

      expect(result.outcome).toBe("inserted");
      expect(result.row.evidenceBundleId).toBe(999999);
    });
  });

  describe("round trips a nullable research brief and nullable response fields", () => {
    it("null brief, http status, response, error, and completion round-trip as null", async () => {
      const { FakePublishAttemptRepo } =
        await import("../../tests/fakes/fake-publish-attempt-repo.js");
      const repo: PublishAttemptRepo = new FakePublishAttemptRepo();
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
      const { FakePublishAttemptRepo } =
        await import("../../tests/fakes/fake-publish-attempt-repo.js");
      const repo: PublishAttemptRepo = new FakePublishAttemptRepo();
      const target = "regime-engine";
      const key = "find-order-test";

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
      const { FakePublishAttemptRepo } =
        await import("../../tests/fakes/fake-publish-attempt-repo.js");
      const repo: PublishAttemptRepo = new FakePublishAttemptRepo();
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
      const { FakePublishAttemptRepo } =
        await import("../../tests/fakes/fake-publish-attempt-repo.js");
      const repo: PublishAttemptRepo = new FakePublishAttemptRepo();
      const target = "regime-engine";
      const key = "status-bounds-test";

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
      const { FakePublishAttemptRepo } =
        await import("../../tests/fakes/fake-publish-attempt-repo.js");
      const repo: PublishAttemptRepo = new FakePublishAttemptRepo();
      const target = "regime-engine";
      const key = "status-since-boundary";

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
      const { FakePublishAttemptRepo } =
        await import("../../tests/fakes/fake-publish-attempt-repo.js");
      const repo: PublishAttemptRepo = new FakePublishAttemptRepo();

      await expect(repo.findRecentByStatus("pending", 0, 0)).rejects.toThrow(
        /limit.*positive.*integer/i
      );
    });

    it("rejects negative limit", async () => {
      const { FakePublishAttemptRepo } =
        await import("../../tests/fakes/fake-publish-attempt-repo.js");
      const repo: PublishAttemptRepo = new FakePublishAttemptRepo();

      await expect(repo.findRecentByStatus("pending", 0, -1)).rejects.toThrow(
        /limit.*positive.*integer/i
      );
    });

    it("rejects non-integer limit 1.5", async () => {
      const { FakePublishAttemptRepo } =
        await import("../../tests/fakes/fake-publish-attempt-repo.js");
      const repo: PublishAttemptRepo = new FakePublishAttemptRepo();

      await expect(repo.findRecentByStatus("pending", 0, 1.5)).rejects.toThrow(
        /limit.*positive.*integer/i
      );
    });
  });

  describe("rejects invalid status HTTP attempt and timestamp values consistently", () => {
    it("rejects unsupported status value", async () => {
      const { FakePublishAttemptRepo } =
        await import("../../tests/fakes/fake-publish-attempt-repo.js");
      const repo: PublishAttemptRepo = new FakePublishAttemptRepo();
      const invalid = makeAttempt({ status: "invalid_status" as any });

      await expect(repo.insert(invalid)).rejects.toThrow(/status/i);
    });

    it("rejects HTTP status 99", async () => {
      const { FakePublishAttemptRepo } =
        await import("../../tests/fakes/fake-publish-attempt-repo.js");
      const repo: PublishAttemptRepo = new FakePublishAttemptRepo();
      const invalid = makeAttempt({ httpStatus: 99 as any });

      await expect(repo.insert(invalid)).rejects.toThrow(/http.*status/i);
    });

    it("rejects HTTP status 600", async () => {
      const { FakePublishAttemptRepo } =
        await import("../../tests/fakes/fake-publish-attempt-repo.js");
      const repo: PublishAttemptRepo = new FakePublishAttemptRepo();
      const invalid = makeAttempt({ httpStatus: 600 as any });

      await expect(repo.insert(invalid)).rejects.toThrow(/http.*status/i);
    });

    it("rejects attempt number 0", async () => {
      const { FakePublishAttemptRepo } =
        await import("../../tests/fakes/fake-publish-attempt-repo.js");
      const repo: PublishAttemptRepo = new FakePublishAttemptRepo();
      const invalid = makeAttempt({ attemptNumber: 0 as any });

      await expect(repo.insert(invalid)).rejects.toThrow(/attempt.*number/i);
    });

    it("rejects negative firstAttemptedAtUnixMs", async () => {
      const { FakePublishAttemptRepo } =
        await import("../../tests/fakes/fake-publish-attempt-repo.js");
      const repo: PublishAttemptRepo = new FakePublishAttemptRepo();
      const invalid = makeAttempt({ firstAttemptedAtUnixMs: -1 as any });

      await expect(repo.insert(invalid)).rejects.toThrow(/timestamp/i);
    });

    it("rejects negative receivedAtUnixMs", async () => {
      const { FakePublishAttemptRepo } =
        await import("../../tests/fakes/fake-publish-attempt-repo.js");
      const repo: PublishAttemptRepo = new FakePublishAttemptRepo();
      const invalid = makeAttempt({ receivedAtUnixMs: -1 as any });

      await expect(repo.insert(invalid)).rejects.toThrow(/timestamp/i);
    });

    it("rejects completion before first attempt", async () => {
      const { FakePublishAttemptRepo } =
        await import("../../tests/fakes/fake-publish-attempt-repo.js");
      const repo: PublishAttemptRepo = new FakePublishAttemptRepo();
      const invalid = makeAttempt({
        firstAttemptedAtUnixMs: 1000,
        completedAtUnixMs: 999
      });

      await expect(repo.insert(invalid)).rejects.toThrow(/completed.*first/i);
    });
  });
});
