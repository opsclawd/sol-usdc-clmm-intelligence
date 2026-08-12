import { describe, it, expect, vi } from "vitest";
import { runCoreEvidencePipeline } from "../../src/application/run-core-evidence-pipeline.js";
import type {
  CoreEvidencePipelineServices,
  RunCoreEvidencePipelineDeps,
  CoreEvidencePipelineResult
} from "../../src/application/run-core-evidence-pipeline.js";
import type {
  CollectionRunContext,
  CoreCollectionResult,
  CoreCollectionStatus,
  CoreSourceKey,
  SourceCollectionOutcome
} from "../../src/contracts/collection-run.js";
import type { CoreEvidencePipelineConfig } from "../../src/application/load-core-evidence-pipeline-config.js";
import type { Clock } from "../../src/ports/clock.js";
import type { DbConnection } from "../../src/ports/db.js";
import { FakePipelineRunLock } from "../fakes/fake-pipeline-run-lock.js";
import { FakeRunIdFactory } from "../fakes/fake-run-id-factory.js";

const SOURCE_BY_KEY: Record<CoreSourceKey, SourceCollectionOutcome["source"]> = {
  "clmm-v2": "clmm-v2-bundle",
  pyth: "pyth-hermes",
  jupiter: "jupiter-quote",
  orca: "orca-public-api",
  solana: "solana-rpc"
};

function sourceOutcome(
  sourceKey: CoreSourceKey,
  status: SourceCollectionOutcome["status"],
  hasUsableEvidence: boolean,
  diagnostic: string | null
): SourceCollectionOutcome {
  return {
    sourceKey,
    source: SOURCE_BY_KEY[sourceKey],
    status,
    hasUsableEvidence,
    rawObservationId: hasUsableEvidence ? 1 : null,
    normalizedCount: hasUsableEvidence ? 1 : 0,
    warnings: [],
    freshness: null,
    confidenceLevel: null,
    diagnostic
  };
}

function collectionResult(
  context: CollectionRunContext,
  status: CoreCollectionStatus
): CoreCollectionResult {
  const complete = status === "COMPLETE";
  return {
    context,
    clmmV2: sourceOutcome("clmm-v2", "accepted", true, null),
    pyth: sourceOutcome(
      "pyth",
      complete ? "accepted" : "failed",
      complete,
      complete ? null : "api_key=super-secret"
    ),
    jupiter: sourceOutcome("jupiter", complete ? "accepted" : "stale", true, "cached quote"),
    orca: sourceOutcome(
      "orca",
      complete ? "accepted" : "unavailable",
      complete,
      complete ? null : "HTTP 503"
    ),
    solana: sourceOutcome(
      "solana",
      complete ? "accepted" : "timeout",
      complete,
      complete ? null : "RPC timeout"
    ),
    warnings: [],
    counts: complete
      ? { complete: 5, partial: 0, stale: 0, absentOrFailed: 0 }
      : { complete: 1, partial: 1, stale: 0, absentOrFailed: 3 },
    status,
    shouldFailCommand: status === "FAILED" || status === "UNAVAILABLE"
  };
}

class QueuedClock implements Clock {
  private queue: string[];
  constructor(times: string[]) {
    this.queue = [...times];
  }
  now(): string {
    return this.queue.shift() ?? "2026-08-12T12:00:00.000Z";
  }
}

const fakeDbConnection: DbConnection = {
  close: async () => {}
};

const testConfig: CoreEvidencePipelineConfig = {
  positionIds: [],
  poolId: "whirlpool-1",
  walletId: "wallet-1",
  codeVersion: "1.0.0",
  gitCommit: "0000000000000000000000000000000000000000000000000000000000000000",
  environment: "test",
  configuredFamilies: new Set()
};

function createServices(
  collectFn: (context: CollectionRunContext) => Promise<CoreCollectionResult>,
  deriveFn?: CoreEvidencePipelineServices["derive"]
): CoreEvidencePipelineServices {
  const throwingSpy = vi.fn().mockImplementation(async () => {
    throw new Error("Downstream service should not be called on pre-target abort");
  });

  return {
    collect: collectFn,
    derive: deriveFn ?? throwingSpy,
    prepare: throwingSpy,
    finalize: throwingSpy,
    preparePair: throwingSpy,
    finalizePair: throwingSpy,
    generateBrief: throwingSpy,
    persistBrief: throwingSpy,
    publish: throwingSpy
  };
}

describe("issue-190 core evidence pipeline diagnostics", () => {
  it.each(["FAILED", "UNAVAILABLE"] as CoreCollectionStatus[])(
    "reports all source outcomes when collection returns %s without warnings",
    async (expectedStatus) => {
      const runIdFactory = new FakeRunIdFactory(["run-1"]);
      const lock = new FakePipelineRunLock();
      const clock = new QueuedClock(["2026-08-12T12:00:00.000Z", "2026-08-12T12:00:01.000Z"]);

      const deps: RunCoreEvidencePipelineDeps = {
        clock,
        runIdFactory,
        lock,
        openResources: async () => ({
          connection: fakeDbConnection,
          services: createServices(async (ctx) => collectionResult(ctx, expectedStatus))
        })
      };

      const result = await runCoreEvidencePipeline(deps, testConfig);

      expect(result.status).toBe("failed");
      expect(result.collectionStatus).toBe(expectedStatus);
      expect(result.warnings).toEqual([]);
      expect(result.pair).toBeNull();
      expect(result.positions).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toMatchObject({
        stage: "collection",
        code: `COLLECTION_REPORTED_${expectedStatus}`
      });

      const message = result.diagnostics[0]?.message ?? "";
      for (const source of ["clmm-v2", "pyth", "jupiter", "orca", "solana"]) {
        expect(message).toContain(`"sourceKey":"${source}"`);
      }
      expect(message).toContain('"status":"failed"');
      expect(message).toContain('"hasUsableEvidence":false');
      expect(message).toContain('"diagnostic":"[REDACTED]"');
      expect(message).not.toContain("super-secret");
    }
  );

  it("emits a top-level diagnostic for every failed pre-target abort path", async () => {
    const scenarios: Array<[string, () => Promise<CoreEvidencePipelineResult>]> = [
      [
        "lock acquisition throwing",
        async () => {
          const lock = new FakePipelineRunLock();
          lock.acquireError = new Error("Lock acquisition failed");
          return runCoreEvidencePipeline(
            {
              clock: new QueuedClock(["2026-08-12T12:00:00.000Z"]),
              runIdFactory: new FakeRunIdFactory(["run-lock-err"]),
              lock,
              openResources: async () => {
                throw new Error("Should not reach openResources");
              }
            },
            testConfig
          );
        }
      ],
      [
        "openResources throwing",
        async () => {
          const lock = new FakePipelineRunLock();
          return runCoreEvidencePipeline(
            {
              clock: new QueuedClock(["2026-08-12T12:00:00.000Z"]),
              runIdFactory: new FakeRunIdFactory(["run-open-err"]),
              lock,
              openResources: async () => {
                throw new Error("Failed to open resources");
              }
            },
            testConfig
          );
        }
      ],
      [
        "collect throwing",
        async () => {
          const lock = new FakePipelineRunLock();
          return runCoreEvidencePipeline(
            {
              clock: new QueuedClock(["2026-08-12T12:00:00.000Z"]),
              runIdFactory: new FakeRunIdFactory(["run-collect-err"]),
              lock,
              openResources: async () => ({
                connection: fakeDbConnection,
                services: createServices(async () => {
                  throw new Error("Collection network error");
                })
              })
            },
            testConfig
          );
        }
      ],
      [
        "collection returning FAILED",
        async () => {
          const lock = new FakePipelineRunLock();
          return runCoreEvidencePipeline(
            {
              clock: new QueuedClock(["2026-08-12T12:00:00.000Z", "2026-08-12T12:00:01.000Z"]),
              runIdFactory: new FakeRunIdFactory(["run-collect-failed"]),
              lock,
              openResources: async () => ({
                connection: fakeDbConnection,
                services: createServices(async (ctx) => collectionResult(ctx, "FAILED"))
              })
            },
            testConfig
          );
        }
      ],
      [
        "collection returning UNAVAILABLE",
        async () => {
          const lock = new FakePipelineRunLock();
          return runCoreEvidencePipeline(
            {
              clock: new QueuedClock(["2026-08-12T12:00:00.000Z", "2026-08-12T12:00:01.000Z"]),
              runIdFactory: new FakeRunIdFactory(["run-collect-unavail"]),
              lock,
              openResources: async () => ({
                connection: fakeDbConnection,
                services: createServices(async (ctx) => collectionResult(ctx, "UNAVAILABLE"))
              })
            },
            testConfig
          );
        }
      ],
      [
        "derive throwing after a COMPLETE collection",
        async () => {
          const lock = new FakePipelineRunLock();
          return runCoreEvidencePipeline(
            {
              clock: new QueuedClock(["2026-08-12T12:00:00.000Z", "2026-08-12T12:00:01.000Z"]),
              runIdFactory: new FakeRunIdFactory(["run-derive-err"]),
              lock,
              openResources: async () => ({
                connection: fakeDbConnection,
                services: createServices(
                  async (ctx) => collectionResult(ctx, "COMPLETE"),
                  async () => {
                    throw new Error("Derivation failed");
                  }
                )
              })
            },
            testConfig
          );
        }
      ]
    ];

    for (const [name, runScenario] of scenarios) {
      const result = await runScenario();
      expect(result.status, name).toBe("failed");
      expect(result.diagnostics.length, name).toBeGreaterThan(0);
    }
  });
});
