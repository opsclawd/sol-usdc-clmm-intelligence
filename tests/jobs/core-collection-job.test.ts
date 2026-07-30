import { describe, it, expect, vi } from "vitest";
import { runCoreCollectionJob, coreCollectionJob } from "../../src/jobs/core-collection-job.js";
import type { CollectionRunContext } from "../../src/contracts/collection-run.js";
import {
  FakeHttp,
  FakeRetry,
  FakeJsonStore,
  FakeEnv,
  FakeClock,
  FakeObservationRepo,
  FakeNormalizedObservationRepo,
  FakeRunIdFactory
} from "../fakes/index.js";

function createTestDeps() {
  const http = new FakeHttp();
  const retryControl = new FakeRetry();
  const jsonStore = new FakeJsonStore();
  const env = new FakeEnv({
    INTELLIGENCE_CODE_VERSION: "1.0.0"
  });
  const clock = new FakeClock("2026-05-10T12:00:00.000Z");
  const rawObservationRepo = new FakeObservationRepo();
  const normalizedObservationRepo = new FakeNormalizedObservationRepo();
  const runIdFactory = new FakeRunIdFactory(["generated-run-id-1"]);

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

describe("runCoreCollectionJob context injection", () => {
  it("uses the supplied collection context without generating another run ID or timestamp", async () => {
    const deps = createTestDeps();
    const clockSpy = vi.spyOn(deps.clock, "now");
    const runIdSpy = vi.spyOn(deps.runIdFactory, "nextRunId");

    const suppliedContext: CollectionRunContext = {
      runId: "orchestrator-run-42",
      startedAtUnixMs: 1700000000000
    };

    const result = await runCoreCollectionJob(deps, suppliedContext);

    expect(runIdSpy).not.toHaveBeenCalled();
    expect(clockSpy).not.toHaveBeenCalled();
    expect(result.context).toEqual(suppliedContext);

    // Verify all source outcomes reference the supplied context or runId
    expect(result.context.runId).toBe("orchestrator-run-42");
    expect(result.context.startedAtUnixMs).toBe(1700000000000);
  });

  it("creates a context for the standalone call when no context is supplied", async () => {
    const deps = createTestDeps();
    const clockSpy = vi.spyOn(deps.clock, "now");
    const runIdSpy = vi.spyOn(deps.runIdFactory, "nextRunId");

    const result = await runCoreCollectionJob(deps);

    expect(runIdSpy).toHaveBeenCalledTimes(1);
    expect(clockSpy).toHaveBeenCalled();
    expect(result.context.runId).toBe("generated-run-id-1");
    expect(result.context.startedAtUnixMs).toBe(new Date("2026-05-10T12:00:00.000Z").getTime());
  });

  it("coreCollectionJob factory function supports passing an explicit context", async () => {
    const deps = createTestDeps();
    const suppliedContext: CollectionRunContext = {
      runId: "factory-supplied-run-id",
      startedAtUnixMs: 1710000000000
    };

    const job = coreCollectionJob(deps);
    const result = await job(suppliedContext);

    expect(result.context).toEqual(suppliedContext);
  });
});
