import { describe, it, expect, vi } from "vitest";
import type { HttpClient } from "../../src/ports/http.js";
import type { RetryControl } from "../../src/ports/retry.js";
import type { JsonStore } from "../../src/ports/json-store.js";
import type { EnvReader } from "../../src/ports/env.js";
import type { Clock } from "../../src/ports/clock.js";
import type { RawObservationRepo } from "../../src/ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../../src/ports/normalized-observation-repo.js";
import type { RunIdFactory } from "../../src/ports/run-id.js";
import type { CollectionRunContext } from "../../src/contracts/collection-run.js";
import { runCoreCollectionJob } from "../../src/jobs/core-collection-job.js";

function createMockDeps() {
  const clock: Clock = { now: vi.fn(() => "2024-01-01T00:00:00.000Z") };
  const runIdFactory: RunIdFactory = { nextRunId: vi.fn(() => "generated-run-id") };
  const env: EnvReader = {
    get: vi.fn((name: string) => {
      if (name === "INTELLIGENCE_ENVIRONMENT") return "test";
      return "dummy";
    }),
    getOptional: vi.fn(() => undefined)
  };
  const http: HttpClient = { getJson: vi.fn().mockRejectedValue(new Error("http error")) };
  const retryControl: RetryControl = { sleep: vi.fn(), jitterUnit: vi.fn(() => 0) };
  const jsonStore: JsonStore = {
    readJson: vi.fn().mockRejectedValue(new Error("json error")),
    writeJson: vi.fn()
  };
  const rawObservationRepo: RawObservationRepo = {
    insert: vi.fn(),
    insertMany: vi.fn(),
    findById: vi.fn(),
    findBySource: vi.fn()
  };
  const normalizedObservationRepo: NormalizedObservationRepo = {
    insert: vi.fn(),
    insertMany: vi.fn(),
    findBySource: vi.fn(),
    findFreshByKind: vi.fn(),
    findLatestByKind: vi.fn(),
    findByRawObservation: vi.fn(),
    listCandidates: vi.fn(),
    findByIds: vi.fn()
  };

  return {
    http,
    retryControl,
    jsonStore,
    env,
    clock,
    rawObservationRepo,
    normalizedObservationRepo,
    runIdFactory
  };
}

describe("runCoreCollectionJob", () => {
  it("uses the supplied collection context without generating another run ID or timestamp", async () => {
    const deps = createMockDeps();
    const suppliedContext: CollectionRunContext = {
      runId: "orchestrator-run-999",
      startedAtUnixMs: 1700000000000
    };

    const result = await runCoreCollectionJob(deps, suppliedContext);

    expect(result.context).toEqual(suppliedContext);
    expect(deps.runIdFactory.nextRunId).not.toHaveBeenCalled();
    expect(deps.clock.now).not.toHaveBeenCalled();
    expect(result.clmmV2).toBeDefined();
    expect(result.pyth).toBeDefined();
    expect(result.jupiter).toBeDefined();
    expect(result.orca).toBeDefined();
    expect(result.solana).toBeDefined();
  });

  it("creates a context for the standalone call when no context is supplied", async () => {
    const deps = createMockDeps();

    const result = await runCoreCollectionJob(deps);

    expect(deps.runIdFactory.nextRunId).toHaveBeenCalledTimes(1);
    expect(deps.clock.now).toHaveBeenCalledTimes(1);
    expect(result.context.runId).toBe("generated-run-id");
    expect(result.context.startedAtUnixMs).toBe(new Date("2024-01-01T00:00:00.000Z").getTime());
  });
});
