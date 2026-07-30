import { describe, it, expect, vi } from "vitest";
import { createNodeRuntime } from "../../../src/adapters/node/composition-root.js";
import { PgPipelineRunLock } from "../../../src/adapters/node/pg-pipeline-run-lock.js";
import { FakeEnv } from "../../fakes/fake-env.js";

vi.mock("postgres", () => {
  return {
    default: vi.fn(() => {
      const mockSql = vi.fn().mockResolvedValue([{ acquired: true }]);
      return {
        reserve: vi.fn().mockResolvedValue(mockSql),
        end: vi.fn().mockResolvedValue(undefined)
      };
    })
  };
});

describe("NodeRuntime composition root", () => {
  it("returns a new PgPipelineRunLock instance on each call to getPipelineRunLock", async () => {
    const runtime = createNodeRuntime();
    if (!runtime.getPipelineRunLock) {
      throw new Error("getPipelineRunLock is not defined");
    }

    const lock1 = await runtime.getPipelineRunLock();
    const lock2 = await runtime.getPipelineRunLock();

    expect(lock1).toBeDefined();
    expect(lock2).toBeDefined();
    expect(lock1).not.toBe(lock2);
  });
});

describe("PgPipelineRunLock environment reader usage", () => {
  it("reads PG_MAX_CONNECTIONS and PG_SSL via EnvReader port instead of process.env", async () => {
    const fakeEnv = new FakeEnv({
      DATABASE_URL: "postgres://localhost:5432/test",
      PG_MAX_CONNECTIONS: "5",
      PG_SSL: "false"
    });

    const getOptionalSpy = vi.spyOn(fakeEnv, "getOptional");
    const lock = new PgPipelineRunLock(fakeEnv);

    await lock.acquire("test-key");

    expect(getOptionalSpy).toHaveBeenCalledWith("PG_MAX_CONNECTIONS");
    expect(getOptionalSpy).toHaveBeenCalledWith("PG_SSL");
  });
});
