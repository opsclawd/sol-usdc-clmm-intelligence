import { describe, it, expect } from "vitest";
import { runCoreEvidencePipeline } from "../../src/application/run-core-evidence-pipeline.js";
import type {
  CoreEvidencePipelineServices,
  RunCoreEvidencePipelineDeps
} from "../../src/application/run-core-evidence-pipeline.js";
import type { CoreEvidencePipelineConfig } from "../../src/application/load-core-evidence-pipeline-config.js";
import type { Clock } from "../../src/ports/clock.js";
import type { DbConnection } from "../../src/ports/db.js";
import type { DerivedFeatureRow } from "../../src/ports/feature-repo.js";
import type { ResearchBriefRow } from "../../src/ports/brief-repo.js";
import type { PersistedResearchBrief } from "../../src/contracts/research-brief.js";
import { FakePipelineRunLock } from "../fakes/fake-pipeline-run-lock.js";
import { FakeRunIdFactory } from "../fakes/fake-run-id-factory.js";

class QueuedClock implements Clock {
  private queue: string[];
  constructor(times: string[]) {
    this.queue = [...times];
  }
  now(): string {
    const next = this.queue.shift();
    if (!next) {
      return "2026-07-30T12:00:00.000Z";
    }
    return next;
  }
}

class FakeDbConnection implements DbConnection {
  public closed = false;
  async close(): Promise<void> {
    this.closed = true;
  }
}

function createDummyPositionFeature(
  kind: "range_location" | "distance_to_lower" | "distance_to_upper",
  poolId: string,
  positionId: string,
  asOfUnixMs: number
): DerivedFeatureRow {
  return {
    id: Math.floor(Math.random() * 100000),
    featureKind: kind,
    signalClass: "deterministic",
    evidenceFamily: "clmm_state",
    value: 100,
    structuredPayload: {},
    asOfUnixMs,
    confidence: {
      components: {
        sourceReliability: 1,
        dataCompleteness: 1,
        derivationConfidence: 1,
        llmConfidence: null
      },
      compositeScore: 1,
      level: "high",
      weightingVersion: "v1",
      reasons: []
    },
    confidenceComposite: 1,
    confidenceLevel: "high",
    validUntilUnixMs: asOfUnixMs + 3600000,
    isStale: false,
    staleBehavior: null,
    provenance: {
      sourceRefs: [],
      rawObservationRefs: [],
      derivedFromRefs: [],
      processRef: {
        collector: "c",
        jobName: "j",
        pipelineRunId: null,
        codeVersion: null,
        modelVersion: null
      },
      codeVersion: "1.0.0",
      runId: null
    },
    payloadHash: "hash",
    receivedAtUnixMs: asOfUnixMs,
    status: "AVAILABLE",
    unit: "PPM",
    pair: "SOL/USDC",
    calculatorVersion: "1.0.0",
    selectionVersion: "mvp-evidence-bundle-selection/v1",
    inputObservationIds: [1],
    rejectedObservationIds: [],
    derivationKey: `key:${kind}:${positionId}`,
    poolId,
    positionId,
    warnings: [],
    reasons: []
  };
}

function createDefaultConfig(): CoreEvidencePipelineConfig {
  return {
    positionIds: ["pos-1"],
    poolId: "pool-1",
    walletId: "wallet-1",
    codeVersion: "1.0.0",
    gitCommit: "0123456789abcdef0123456789abcdef01234567",
    environment: "test"
  };
}

const dummyBriefRow = { id: 10 } as unknown as ResearchBriefRow;
const dummyBrief = { briefId: "b-1" } as unknown as PersistedResearchBrief;

describe("runCoreEvidencePipeline - Shared Stages", () => {
  it("returns skipped_already_running without opening resources or invoking stages", async () => {
    const lock = new FakePipelineRunLock();
    lock.shouldContend = true;
    let openResourcesCalled = false;

    const deps: RunCoreEvidencePipelineDeps = {
      clock: new QueuedClock(["2026-07-30T12:00:00.000Z"]),
      runIdFactory: new FakeRunIdFactory(["run-1"]),
      lock,
      openResources: async () => {
        openResourcesCalled = true;
        throw new Error("Should not open resources");
      }
    };

    const result = await runCoreEvidencePipeline(deps, createDefaultConfig());

    expect(result.status).toBe("skipped_already_running");
    expect(openResourcesCalled).toBe(false);
    expect(result.pipelineRunId).toBe("run-1");
    expect(result.evaluationTimeUnixMs).toBeNull();
    expect(result.collectionStatus).toBeNull();
    expect(result.positions).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.cleanupErrors).toEqual([]);
  });

  it("shares one run ID from collection through derivation assembly brief and result", async () => {
    const lock = new FakePipelineRunLock();
    const connection = new FakeDbConnection();

    let collectedRunId: string | null = null;
    let derivedRunId: string | null = null;
    let assembledRunId: string | null = null;
    let briefRunId: string | null = null;

    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();

    const services: CoreEvidencePipelineServices = {
      collect: async (ctx) => {
        collectedRunId = ctx.runId;
        return {
          context: ctx,
          clmmV2: {
            sourceKey: "clmm-v2",
            source: "clmm-v2-bundle",
            status: "accepted",
            hasUsableEvidence: true,
            rawObservationId: 1,
            normalizedCount: 1,
            warnings: [],
            freshness: null,
            confidenceLevel: null,
            diagnostic: null
          },
          pyth: {
            sourceKey: "pyth",
            source: "pyth-hermes",
            status: "accepted",
            hasUsableEvidence: true,
            rawObservationId: 2,
            normalizedCount: 1,
            warnings: [],
            freshness: null,
            confidenceLevel: null,
            diagnostic: null
          },
          jupiter: {
            sourceKey: "jupiter",
            source: "jupiter-quote",
            status: "accepted",
            hasUsableEvidence: true,
            rawObservationId: 3,
            normalizedCount: 1,
            warnings: [],
            freshness: null,
            confidenceLevel: null,
            diagnostic: null
          },
          orca: {
            sourceKey: "orca",
            source: "orca-public-api",
            status: "accepted",
            hasUsableEvidence: true,
            rawObservationId: 4,
            normalizedCount: 1,
            warnings: [],
            freshness: null,
            confidenceLevel: null,
            diagnostic: null
          },
          solana: {
            sourceKey: "solana",
            source: "solana-rpc",
            status: "accepted",
            hasUsableEvidence: true,
            rawObservationId: 5,
            normalizedCount: 1,
            warnings: [],
            freshness: null,
            confidenceLevel: null,
            diagnostic: null
          },
          warnings: [],
          counts: { complete: 5, partial: 0, stale: 0, absentOrFailed: 0 },
          status: "COMPLETE",
          shouldFailCommand: false
        };
      },
      derive: async (req) => {
        derivedRunId = req.pipelineRunId;
        return {
          rows: [
            createDummyPositionFeature("range_location", "pool-1", "pos-1", evalTime),
            createDummyPositionFeature("distance_to_lower", "pool-1", "pos-1", evalTime),
            createDummyPositionFeature("distance_to_upper", "pool-1", "pos-1", evalTime)
          ],
          counts: { AVAILABLE: 3, PARTIAL: 0, UNAVAILABLE: 0, REJECTED: 0 },
          warnings: []
        };
      },
      assemble: async (req) => {
        assembledRunId = req.pipelineRunId;
        return {
          outcome: "persisted",
          rowId: 42,
          payloadHash: "hash42",
          slotCount: 3,
          warnings: []
        };
      },
      assemblePair: async () => ({
        outcome: "persisted",
        rowId: 50,
        payloadHash: "hash50",
        slotCount: 16,
        warnings: []
      }),
      generateBrief: async (req) => {
        briefRunId = req.runId ?? null;
        return {
          outcome: "generated_complete",
          row: dummyBriefRow,
          brief: dummyBrief
        };
      },
      publish: async () => {
        return { outcome: "created", bundleId: 42, attemptCount: 1 };
      }
    };

    const deps: RunCoreEvidencePipelineDeps = {
      clock: new QueuedClock([
        "2026-07-30T12:00:00.000Z",
        "2026-07-30T12:00:05.000Z",
        "2026-07-30T12:00:06.000Z"
      ]),
      runIdFactory: new FakeRunIdFactory(["shared-run-999"]),
      lock,
      openResources: async () => ({ connection, services })
    };

    const result = await runCoreEvidencePipeline(deps, createDefaultConfig());

    expect(result.pipelineRunId).toBe("shared-run-999");
    expect(collectedRunId).toBe("shared-run-999");
    expect(derivedRunId).toBe("shared-run-999");
    expect(assembledRunId).toBe("shared-run-999");
    expect(briefRunId).toBe("shared-run-999");
    expect(result.positions[0]?.correlationId).toBe("run:shared-run-999:position:pos-1");
  });

  it("captures evaluation time after collection exactly once and reuses it downstream", async () => {
    const lock = new FakePipelineRunLock();
    const connection = new FakeDbConnection();

    const t1 = "2026-07-30T12:00:00.000Z";
    const t2 = "2026-07-30T12:00:05.000Z";
    const t3 = "2026-07-30T12:00:10.000Z";
    const t2Ms = new Date(t2).getTime();

    let derivedEvalTime: number | null = null;
    let assembleEvalTime: number | null = null;
    let briefEvalTime: number | null = null;

    const services: CoreEvidencePipelineServices = {
      collect: async (ctx) => {
        return {
          context: ctx,
          clmmV2: {
            sourceKey: "clmm-v2",
            source: "clmm-v2-bundle",
            status: "accepted",
            hasUsableEvidence: true,
            rawObservationId: 1,
            normalizedCount: 1,
            warnings: [],
            freshness: null,
            confidenceLevel: null,
            diagnostic: null
          },
          pyth: {
            sourceKey: "pyth",
            source: "pyth-hermes",
            status: "accepted",
            hasUsableEvidence: true,
            rawObservationId: 2,
            normalizedCount: 1,
            warnings: [],
            freshness: null,
            confidenceLevel: null,
            diagnostic: null
          },
          jupiter: {
            sourceKey: "jupiter",
            source: "jupiter-quote",
            status: "accepted",
            hasUsableEvidence: true,
            rawObservationId: 3,
            normalizedCount: 1,
            warnings: [],
            freshness: null,
            confidenceLevel: null,
            diagnostic: null
          },
          orca: {
            sourceKey: "orca",
            source: "orca-public-api",
            status: "accepted",
            hasUsableEvidence: true,
            rawObservationId: 4,
            normalizedCount: 1,
            warnings: [],
            freshness: null,
            confidenceLevel: null,
            diagnostic: null
          },
          solana: {
            sourceKey: "solana",
            source: "solana-rpc",
            status: "accepted",
            hasUsableEvidence: true,
            rawObservationId: 5,
            normalizedCount: 1,
            warnings: [],
            freshness: null,
            confidenceLevel: null,
            diagnostic: null
          },
          warnings: [],
          counts: { complete: 5, partial: 0, stale: 0, absentOrFailed: 0 },
          status: "COMPLETE",
          shouldFailCommand: false
        };
      },
      derive: async (req) => {
        derivedEvalTime = req.evaluationTimeUnixMs;
        return {
          rows: [
            createDummyPositionFeature(
              "range_location",
              "pool-1",
              "pos-1",
              req.evaluationTimeUnixMs
            ),
            createDummyPositionFeature(
              "distance_to_lower",
              "pool-1",
              "pos-1",
              req.evaluationTimeUnixMs
            ),
            createDummyPositionFeature(
              "distance_to_upper",
              "pool-1",
              "pos-1",
              req.evaluationTimeUnixMs
            )
          ],
          counts: { AVAILABLE: 3, PARTIAL: 0, UNAVAILABLE: 0, REJECTED: 0 },
          warnings: []
        };
      },
      assemble: async (req) => {
        assembleEvalTime = req.evaluationTimeUnixMs;
        return { outcome: "persisted", rowId: 100, payloadHash: "h", slotCount: 3, warnings: [] };
      },
      assemblePair: async () => ({
        outcome: "persisted",
        rowId: 50,
        payloadHash: "hash50",
        slotCount: 16,
        warnings: []
      }),
      generateBrief: async (req) => {
        briefEvalTime = req.evaluationTimeUnixMs;
        return { outcome: "generated_complete", row: dummyBriefRow, brief: dummyBrief };
      },
      publish: async () => ({ outcome: "created", bundleId: 100, attemptCount: 1 })
    };

    const deps: RunCoreEvidencePipelineDeps = {
      clock: new QueuedClock([t1, t2, t3]),
      runIdFactory: new FakeRunIdFactory(["run-eval"]),
      lock,
      openResources: async () => ({ connection, services })
    };

    const result = await runCoreEvidencePipeline(deps, createDefaultConfig());

    expect(result.collectionStartedAtUnixMs).toBe(new Date(t1).getTime());
    expect(result.evaluationTimeUnixMs).toBe(t2Ms);
    expect(derivedEvalTime).toBe(t2Ms);
    expect(assembleEvalTime).toBe(t2Ms);
    expect(briefEvalTime).toBe(t2Ms);
  });

  it("continues after PARTIAL collection with sorted warnings and degradation", async () => {
    const lock = new FakePipelineRunLock();
    const connection = new FakeDbConnection();
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();

    const services: CoreEvidencePipelineServices = {
      collect: async (ctx) => ({
        context: ctx,
        clmmV2: {
          sourceKey: "clmm-v2",
          source: "clmm-v2-bundle",
          status: "accepted",
          hasUsableEvidence: true,
          rawObservationId: 1,
          normalizedCount: 1,
          warnings: [],
          freshness: null,
          confidenceLevel: null,
          diagnostic: null
        },
        pyth: {
          sourceKey: "pyth",
          source: "pyth-hermes",
          status: "degraded",
          hasUsableEvidence: true,
          rawObservationId: 2,
          normalizedCount: 1,
          warnings: [{ source: "pyth", code: "stale", message: "Stale price" }],
          freshness: null,
          confidenceLevel: null,
          diagnostic: null
        },
        jupiter: {
          sourceKey: "jupiter",
          source: "jupiter-quote",
          status: "accepted",
          hasUsableEvidence: true,
          rawObservationId: 3,
          normalizedCount: 1,
          warnings: [],
          freshness: null,
          confidenceLevel: null,
          diagnostic: null
        },
        orca: {
          sourceKey: "orca",
          source: "orca-public-api",
          status: "accepted",
          hasUsableEvidence: true,
          rawObservationId: 4,
          normalizedCount: 1,
          warnings: [],
          freshness: null,
          confidenceLevel: null,
          diagnostic: null
        },
        solana: {
          sourceKey: "solana",
          source: "solana-rpc",
          status: "accepted",
          hasUsableEvidence: true,
          rawObservationId: 5,
          normalizedCount: 1,
          warnings: [],
          freshness: null,
          confidenceLevel: null,
          diagnostic: null
        },
        warnings: [{ source: "pyth", code: "stale", message: "Stale price" }],
        counts: { complete: 4, partial: 1, stale: 0, absentOrFailed: 0 },
        status: "PARTIAL",
        shouldFailCommand: false
      }),
      derive: async () => ({
        rows: [
          createDummyPositionFeature("range_location", "pool-1", "pos-1", evalTime),
          createDummyPositionFeature("distance_to_lower", "pool-1", "pos-1", evalTime),
          createDummyPositionFeature("distance_to_upper", "pool-1", "pos-1", evalTime)
        ],
        counts: { AVAILABLE: 3, PARTIAL: 0, UNAVAILABLE: 0, REJECTED: 0 },
        warnings: []
      }),
      assemble: async () => ({
        outcome: "persisted",
        rowId: 55,
        payloadHash: "h",
        slotCount: 3,
        warnings: []
      }),
      assemblePair: async () => ({
        outcome: "persisted",
        rowId: 50,
        payloadHash: "hash50",
        slotCount: 16,
        warnings: []
      }),
      generateBrief: async () => ({
        outcome: "generated_complete",
        row: dummyBriefRow,
        brief: dummyBrief
      }),
      publish: async () => ({ outcome: "created", bundleId: 55, attemptCount: 1 })
    };

    const deps: RunCoreEvidencePipelineDeps = {
      clock: new QueuedClock([
        "2026-07-30T12:00:00.000Z",
        "2026-07-30T12:00:05.000Z",
        "2026-07-30T12:00:06.000Z"
      ]),
      runIdFactory: new FakeRunIdFactory(["run-partial"]),
      lock,
      openResources: async () => ({ connection, services })
    };

    const result = await runCoreEvidencePipeline(deps, createDefaultConfig());

    expect(result.collectionStatus).toBe("PARTIAL");
    expect(result.status).toBe("degraded");
    expect(result.positions[0]?.status).toBe("degraded");
    expect(result.warnings.some((w) => w.includes("pyth:stale"))).toBe(true);
  });

  it("stops before derivation for UNAVAILABLE or FAILED collection", async () => {
    for (const status of ["UNAVAILABLE", "FAILED"] as const) {
      const lock = new FakePipelineRunLock();
      const connection = new FakeDbConnection();
      let deriveCalled = false;

      const services: CoreEvidencePipelineServices = {
        collect: async (ctx) => ({
          context: ctx,
          clmmV2: {
            sourceKey: "clmm-v2",
            source: "clmm-v2-bundle",
            status: "failed",
            hasUsableEvidence: false,
            rawObservationId: null,
            normalizedCount: 0,
            warnings: [],
            freshness: null,
            confidenceLevel: null,
            diagnostic: "fail"
          },
          pyth: {
            sourceKey: "pyth",
            source: "pyth-hermes",
            status: "failed",
            hasUsableEvidence: false,
            rawObservationId: null,
            normalizedCount: 0,
            warnings: [],
            freshness: null,
            confidenceLevel: null,
            diagnostic: "fail"
          },
          jupiter: {
            sourceKey: "jupiter",
            source: "jupiter-quote",
            status: "failed",
            hasUsableEvidence: false,
            rawObservationId: null,
            normalizedCount: 0,
            warnings: [],
            freshness: null,
            confidenceLevel: null,
            diagnostic: "fail"
          },
          orca: {
            sourceKey: "orca",
            source: "orca-public-api",
            status: "failed",
            hasUsableEvidence: false,
            rawObservationId: null,
            normalizedCount: 0,
            warnings: [],
            freshness: null,
            confidenceLevel: null,
            diagnostic: "fail"
          },
          solana: {
            sourceKey: "solana",
            source: "solana-rpc",
            status: "failed",
            hasUsableEvidence: false,
            rawObservationId: null,
            normalizedCount: 0,
            warnings: [],
            freshness: null,
            confidenceLevel: null,
            diagnostic: "fail"
          },
          warnings: [],
          counts: { complete: 0, partial: 0, stale: 0, absentOrFailed: 5 },
          status,
          shouldFailCommand: true
        }),
        derive: async () => {
          deriveCalled = true;
          return {
            rows: [],
            counts: { AVAILABLE: 0, PARTIAL: 0, UNAVAILABLE: 0, REJECTED: 0 },
            warnings: []
          };
        },
        assemble: async () => ({ outcome: "no_bundle" }),
        assemblePair: async () => ({ outcome: "no_bundle" }),
        generateBrief: async () => ({ outcome: "no_brief", reason: "no_bundle" }),
        publish: async () => ({ outcome: "bundle_not_found" })
      };

      const deps: RunCoreEvidencePipelineDeps = {
        clock: new QueuedClock(["2026-07-30T12:00:00.000Z", "2026-07-30T12:00:05.000Z"]),
        runIdFactory: new FakeRunIdFactory([`run-stop-${status}`]),
        lock,
        openResources: async () => ({ connection, services })
      };

      const result = await runCoreEvidencePipeline(deps, createDefaultConfig());

      expect(deriveCalled).toBe(false);
      expect(result.collectionStatus).toBe(status);
      expect(result.status).toBe("failed");
      expect(result.positions).toEqual([]);
    }
  });

  it("runs derivation once for normalized configured positions", async () => {
    const lock = new FakePipelineRunLock();
    const connection = new FakeDbConnection();

    let deriveCount = 0;
    let derivePositions: readonly string[] = [];

    const config: CoreEvidencePipelineConfig = {
      ...createDefaultConfig(),
      positionIds: ["pos-1", "pos-2"]
    };

    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();

    const services: CoreEvidencePipelineServices = {
      collect: async (ctx) => ({
        context: ctx,
        clmmV2: {
          sourceKey: "clmm-v2",
          source: "clmm-v2-bundle",
          status: "accepted",
          hasUsableEvidence: true,
          rawObservationId: 1,
          normalizedCount: 1,
          warnings: [],
          freshness: null,
          confidenceLevel: null,
          diagnostic: null
        },
        pyth: {
          sourceKey: "pyth",
          source: "pyth-hermes",
          status: "accepted",
          hasUsableEvidence: true,
          rawObservationId: 2,
          normalizedCount: 1,
          warnings: [],
          freshness: null,
          confidenceLevel: null,
          diagnostic: null
        },
        jupiter: {
          sourceKey: "jupiter",
          source: "jupiter-quote",
          status: "accepted",
          hasUsableEvidence: true,
          rawObservationId: 3,
          normalizedCount: 1,
          warnings: [],
          freshness: null,
          confidenceLevel: null,
          diagnostic: null
        },
        orca: {
          sourceKey: "orca",
          source: "orca-public-api",
          status: "accepted",
          hasUsableEvidence: true,
          rawObservationId: 4,
          normalizedCount: 1,
          warnings: [],
          freshness: null,
          confidenceLevel: null,
          diagnostic: null
        },
        solana: {
          sourceKey: "solana",
          source: "solana-rpc",
          status: "accepted",
          hasUsableEvidence: true,
          rawObservationId: 5,
          normalizedCount: 1,
          warnings: [],
          freshness: null,
          confidenceLevel: null,
          diagnostic: null
        },
        warnings: [],
        counts: { complete: 5, partial: 0, stale: 0, absentOrFailed: 0 },
        status: "COMPLETE",
        shouldFailCommand: false
      }),
      derive: async (req) => {
        deriveCount++;
        derivePositions = req.positionIds;
        return {
          rows: [
            createDummyPositionFeature("range_location", "pool-1", "pos-1", evalTime),
            createDummyPositionFeature("distance_to_lower", "pool-1", "pos-1", evalTime),
            createDummyPositionFeature("distance_to_upper", "pool-1", "pos-1", evalTime),
            createDummyPositionFeature("range_location", "pool-1", "pos-2", evalTime),
            createDummyPositionFeature("distance_to_lower", "pool-1", "pos-2", evalTime),
            createDummyPositionFeature("distance_to_upper", "pool-1", "pos-2", evalTime)
          ],
          counts: { AVAILABLE: 6, PARTIAL: 0, UNAVAILABLE: 0, REJECTED: 0 },
          warnings: []
        };
      },
      assemble: async (req) => {
        const id = req.positionId === "pos-1" ? 101 : 102;
        return { outcome: "persisted", rowId: id, payloadHash: "h", slotCount: 3, warnings: [] };
      },
      assemblePair: async () => ({
        outcome: "persisted",
        rowId: 50,
        payloadHash: "hash50",
        slotCount: 16,
        warnings: []
      }),
      generateBrief: async () => ({
        outcome: "generated_complete",
        row: dummyBriefRow,
        brief: dummyBrief
      }),
      publish: async (req) => ({
        outcome: "created",
        bundleId: req.evidenceBundleId,
        attemptCount: 1
      })
    };

    const deps: RunCoreEvidencePipelineDeps = {
      clock: new QueuedClock([
        "2026-07-30T12:00:00.000Z",
        "2026-07-30T12:00:05.000Z",
        "2026-07-30T12:00:06.000Z",
        "2026-07-30T12:00:07.000Z"
      ]),
      runIdFactory: new FakeRunIdFactory(["run-derive"]),
      lock,
      openResources: async () => ({ connection, services })
    };

    await runCoreEvidencePipeline(deps, config);

    expect(deriveCount).toBe(1);
    expect(derivePositions).toEqual(["pos-1", "pos-2"]);
  });
});
