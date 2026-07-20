import { describe, expect, it } from "vitest";
import { createCollectionRunContext } from "../../src/application/create-collection-run-context.js";
import { FakeEnv, FakeClock, FakeRunIdFactory } from "../../tests/fakes/index.js";

describe("createCollectionRunContext", () => {
  it("uses the operator run id or generates one once at the job boundary", () => {
    // 1. Covering a non-empty INTELLIGENCE_PIPELINE_RUN_ID
    const deps1 = {
      env: new FakeEnv({ INTELLIGENCE_PIPELINE_RUN_ID: "operator-123" }),
      clock: new FakeClock("2026-05-10T12:00:00.000Z"),
      runIdFactory: new FakeRunIdFactory(["gen-456"])
    };
    const ctx1 = createCollectionRunContext(deps1);
    expect(ctx1.runId).toBe("operator-123");
    expect(ctx1.startedAtUnixMs).toBe(Date.parse("2026-05-10T12:00:00.000Z"));

    // 2. Blank-as-unset behavior
    const deps2 = {
      env: new FakeEnv({ INTELLIGENCE_PIPELINE_RUN_ID: "   " }),
      clock: new FakeClock("2026-05-10T12:00:00.000Z"),
      runIdFactory: new FakeRunIdFactory(["gen-456"])
    };
    const ctx2 = createCollectionRunContext(deps2);
    expect(ctx2.runId).toBe("gen-456");

    // 3. Exactly one factory call (asserted because we queued only one ID and it matches, and we can't shift more without throwing)
    // 4. A finite parsed clock value
    expect(Number.isFinite(ctx2.startedAtUnixMs)).toBe(true);

    // 5. Rejection of an invalid clock
    const deps3 = {
      env: new FakeEnv({}),
      clock: new FakeClock("not-a-date"),
      runIdFactory: new FakeRunIdFactory(["gen-456"])
    };
    expect(() => createCollectionRunContext(deps3)).toThrow("Clock returned invalid time");
  });
});
