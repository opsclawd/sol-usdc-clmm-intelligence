import { describe, it, expect } from "vitest";
import { PgPipelineRunLock } from "../../../src/adapters/node/pg-pipeline-run-lock.js";
import { FakeEnv } from "../../fakes/fake-env.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

function makeLockKey(suffix = "key"): string {
  return `test-lock-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}-${suffix}`;
}

function createLock(): PgPipelineRunLock {
  if (!TEST_DB_URL) {
    throw new Error("TEST_DATABASE_URL is not set");
  }
  return new PgPipelineRunLock(new FakeEnv({ DATABASE_URL: TEST_DB_URL }));
}

describe("PgPipelineRunLock integration", () => {
  if (!TEST_DB_URL) {
    it("skipping: TEST_DATABASE_URL not set", () => {
      expect(true).toBe(true);
    });
    return;
  }

  it("allows one holder and reports contention for the same key", async () => {
    const lock1 = createLock();
    const lock2 = createLock();
    const key = makeLockKey("contention");

    const res1 = await lock1.acquire(key);
    expect(res1).toBe("acquired");

    const res2 = await lock2.acquire(key);
    expect(res2).toBe("already_running");

    await lock1.release();
  });

  it("allows independent keys concurrently", async () => {
    const lock1 = createLock();
    const lock2 = createLock();
    const key1 = makeLockKey("indep-1");
    const key2 = makeLockKey("indep-2");

    const res1 = await lock1.acquire(key1);
    expect(res1).toBe("acquired");

    const res2 = await lock2.acquire(key2);
    expect(res2).toBe("acquired");

    await lock1.release();
    await lock2.release();
  });

  it("allows the contended key after the holder releases it", async () => {
    const lock1 = createLock();
    const lock2 = createLock();
    const lock3 = createLock();
    const key = makeLockKey("release-reacquire");

    const res1 = await lock1.acquire(key);
    expect(res1).toBe("acquired");

    const res2 = await lock2.acquire(key);
    expect(res2).toBe("already_running");

    await lock1.release();

    const res3 = await lock3.acquire(key);
    expect(res3).toBe("acquired");

    await lock3.release();
  });

  it("rejects invalid lifecycle calls without leaking the reserved session", async () => {
    const key = makeLockKey("invalid-lifecycle");
    const idleLock = createLock();

    // Releasing idle lock rejects
    await expect(idleLock.release()).rejects.toThrow("Cannot release lock");

    // Empty key acquire rejects
    const emptyKeyLock = createLock();
    await expect(emptyKeyLock.acquire("")).rejects.toThrow("non-empty string");

    // Double acquire rejects
    const acquiredLock = createLock();
    const res1 = await acquiredLock.acquire(key);
    expect(res1).toBe("acquired");

    await expect(acquiredLock.acquire(key)).rejects.toThrow("Cannot acquire lock");

    // Releasing twice rejects
    await acquiredLock.release();
    await expect(acquiredLock.release()).rejects.toThrow("Cannot release lock");

    // Releasing a contended lock rejects
    const lockA = createLock();
    const lockB = createLock();
    const key2 = makeLockKey("contended-release");
    await lockA.acquire(key2);
    const contendedRes = await lockB.acquire(key2);
    expect(contendedRes).toBe("already_running");

    await expect(lockB.release()).rejects.toThrow("Cannot release lock");
    await lockA.release();
  });
});
