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
import type { AssembleEvidenceBundleResult } from "../../src/application/assemble-evidence-bundle.js";
import type { GenerateAndPersistResearchBriefOutcome as GenerateResearchBriefOutcome } from "../../src/application/generate-research-brief.js";
import type { PublishEvidenceBundleResult } from "../../src/application/publish-evidence-bundle.js";
import { FakePipelineRunLock } from "../fakes/fake-pipeline-run-lock.js";
import { FakeRunIdFactory } from "../fakes/fake-run-id-factory.js";

class QueuedClock implements Clock {
  private queue: string[];
  constructor(times: string[]) {
    this.queue = [...times];
  }
  now(): string {
    const next = this.queue.shift();
    if (!next) return "2026-07-30T12:00:00.000Z";
    return next;
  }
}

class FakeDbConnection implements DbConnection {
  async close(): Promise<void> {}
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

function createDefaultConfig(
  positionIds: string[] = ["pos-1", "pos-2"]
): CoreEvidencePipelineConfig {
  return {
    positionIds,
    poolId: "pool-1",
    walletId: "wallet-1",
    codeVersion: "1.0.0",
    gitCommit: "0123456789abcdef0123456789abcdef01234567",
    environment: "test"
  };
}

const dummyBriefRow = { id: 1 } as unknown as ResearchBriefRow;
const dummyBrief = {} as unknown as PersistedResearchBrief;

function createBaseServices(evalTime: number): CoreEvidencePipelineServices {
  return {
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
    derive: async () => ({
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
    }),
    assemble: async (req) => {
      const rowId = req.positionId === "pos-1" ? 101 : 102;
      return {
        outcome: "persisted",
        rowId,
        payloadHash: `hash-${rowId}`,
        slotCount: 3,
        warnings: []
      };
    },
    assemblePair: async () => ({
      outcome: "persisted",
      rowId: 500,
      payloadHash: "hash-500",
      slotCount: 16,
      warnings: []
    }),
    generateBrief: async (req) => ({
      outcome: "generated_complete",
      row: { id: req.evidenceBundleId } as unknown as ResearchBriefRow,
      brief: dummyBrief
    }),
    publish: async (req) => ({
      outcome: "created",
      bundleId: req.evidenceBundleId,
      attemptCount: 1
    })
  };
}

describe("runCoreEvidencePipeline - Per-Position Targeting", () => {
  it("publishes two positions with their independently returned bundle IDs", async () => {
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    const publishedBundleIds: number[] = [];

    const base = createBaseServices(evalTime);
    const services: CoreEvidencePipelineServices = {
      ...base,
      publish: async (req) => {
        publishedBundleIds.push(req.evidenceBundleId);
        return { outcome: "created", bundleId: req.evidenceBundleId, attemptCount: 1 };
      }
    };

    const deps: RunCoreEvidencePipelineDeps = {
      clock: new QueuedClock([
        "2026-07-30T12:00:00.000Z",
        "2026-07-30T12:00:05.000Z",
        "2026-07-30T12:00:06.000Z",
        "2026-07-30T12:00:07.000Z"
      ]),
      runIdFactory: new FakeRunIdFactory(["run-two-pos"]),
      lock: new FakePipelineRunLock(),
      openResources: async () => ({ connection: new FakeDbConnection(), services })
    };

    const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1", "pos-2"]));

    expect(result.positions).toHaveLength(2);
    expect(result.positions[0]?.positionId).toBe("pos-1");
    expect(result.positions[0]?.bundleId).toBe(101);
    expect(result.positions[1]?.positionId).toBe("pos-2");
    expect(result.positions[1]?.bundleId).toBe(102);
    expect(publishedBundleIds).toEqual([500, 101, 102]);
    expect(result.status).toBe("complete");
  });

  it("fails a missing-position gate without blocking the next position", async () => {
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    const base = createBaseServices(evalTime);

    const services: CoreEvidencePipelineServices = {
      ...base,
      derive: async () => ({
        rows: [
          createDummyPositionFeature("distance_to_lower", "pool-1", "pos-1", evalTime),
          createDummyPositionFeature("distance_to_upper", "pool-1", "pos-1", evalTime),
          createDummyPositionFeature("range_location", "pool-1", "pos-2", evalTime),
          createDummyPositionFeature("distance_to_lower", "pool-1", "pos-2", evalTime),
          createDummyPositionFeature("distance_to_upper", "pool-1", "pos-2", evalTime)
        ],
        counts: { AVAILABLE: 5, PARTIAL: 0, UNAVAILABLE: 0, REJECTED: 0 },
        warnings: []
      })
    };

    const deps: RunCoreEvidencePipelineDeps = {
      clock: new QueuedClock([
        "2026-07-30T12:00:00.000Z",
        "2026-07-30T12:00:05.000Z",
        "2026-07-30T12:00:06.000Z"
      ]),
      runIdFactory: new FakeRunIdFactory(["run-gate-fail"]),
      lock: new FakePipelineRunLock(),
      openResources: async () => ({ connection: new FakeDbConnection(), services })
    };

    const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1", "pos-2"]));

    expect(result.positions).toHaveLength(2);
    expect(result.positions[0]?.positionId).toBe("pos-1");
    expect(result.positions[0]?.status).toBe("failed");
    expect(result.positions[0]?.bundleId).toBeNull();
    expect(result.positions[0]?.diagnostic?.stage).toBe("position_gate");

    expect(result.positions[1]?.positionId).toBe("pos-2");
    expect(result.positions[1]?.status).toBe("complete");
    expect(result.positions[1]?.bundleId).toBe(102);

    expect(result.status).toBe("partial_failure");
  });

  it("continues after persisted or identical_replay and rejects every other assembly outcome", async () => {
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    const base = createBaseServices(evalTime);

    const outcomes: AssembleEvidenceBundleResult[] = [
      { outcome: "persisted", rowId: 201, payloadHash: "h", slotCount: 3, warnings: [] },
      { outcome: "identical_replay", rowId: 202, payloadHash: "h", slotCount: 3, warnings: [] },
      { outcome: "conflict", rowId: 203, incomingPayloadHash: "h2" },
      { outcome: "no_bundle" },
      { code: "VALIDATION_ERROR", errors: ["bad"] },
      { code: "LINEAGE_ERROR", message: "lineage failed" },
      { code: "PERSISTENCE_ERROR", message: "db failed" }
    ];

    for (const assemblyOutcome of outcomes) {
      const services: CoreEvidencePipelineServices = {
        ...base,
        assemble: async () => assemblyOutcome
      };

      const deps: RunCoreEvidencePipelineDeps = {
        clock: new QueuedClock([
          "2026-07-30T12:00:00.000Z",
          "2026-07-30T12:00:05.000Z",
          "2026-07-30T12:00:06.000Z"
        ]),
        runIdFactory: new FakeRunIdFactory(["run-assembly-test"]),
        lock: new FakePipelineRunLock(),
        openResources: async () => ({ connection: new FakeDbConnection(), services })
      };

      const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1"]));

      const isSuccess =
        "outcome" in assemblyOutcome &&
        (assemblyOutcome.outcome === "persisted" || assemblyOutcome.outcome === "identical_replay");
      if (isSuccess) {
        expect(result.positions[0]?.status).toBe("complete");
        expect(result.positions[0]?.bundleId).toBe(
          "rowId" in assemblyOutcome ? assemblyOutcome.rowId : null
        );
      } else {
        expect(result.positions[0]?.status).toBe("failed");
        expect(result.positions[0]?.bundleId).toBeNull();
        expect(result.positions[0]?.diagnostic?.stage).toBe("assembly");
      }
    }
  });

  it("publishes complete and reused briefs with the exact bundle ID", async () => {
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    const base = createBaseServices(evalTime);

    const briefOutcomes: GenerateResearchBriefOutcome[] = [
      { outcome: "generated_complete", row: dummyBriefRow, brief: dummyBrief },
      { outcome: "reused", row: dummyBriefRow, brief: dummyBrief }
    ];

    for (const briefOutcome of briefOutcomes) {
      let briefTargetId: number | null = null;
      let publishTargetId: number | null = null;

      const services: CoreEvidencePipelineServices = {
        ...base,
        generateBrief: async (req) => {
          briefTargetId = req.evidenceBundleId;
          return briefOutcome;
        },
        publish: async (req) => {
          publishTargetId = req.evidenceBundleId;
          return { outcome: "created", bundleId: req.evidenceBundleId, attemptCount: 1 };
        }
      };

      const deps: RunCoreEvidencePipelineDeps = {
        clock: new QueuedClock([
          "2026-07-30T12:00:00.000Z",
          "2026-07-30T12:00:05.000Z",
          "2026-07-30T12:00:06.000Z"
        ]),
        runIdFactory: new FakeRunIdFactory(["run-brief-success"]),
        lock: new FakePipelineRunLock(),
        openResources: async () => ({ connection: new FakeDbConnection(), services })
      };

      const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1"]));

      expect(result.positions[0]?.status).toBe("complete");
      expect(briefTargetId).toBe(101);
      expect(publishTargetId).toBe(101);
    }
  });

  it("publishes a generated_degraded brief as degraded without retargeting", async () => {
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    const base = createBaseServices(evalTime);

    let publishedId: number | null = null;

    const services: CoreEvidencePipelineServices = {
      ...base,
      generateBrief: async () => ({
        outcome: "generated_degraded",
        row: dummyBriefRow,
        brief: dummyBrief
      }),
      publish: async (req) => {
        publishedId = req.evidenceBundleId;
        return { outcome: "created", bundleId: req.evidenceBundleId, attemptCount: 1 };
      }
    };

    const deps: RunCoreEvidencePipelineDeps = {
      clock: new QueuedClock([
        "2026-07-30T12:00:00.000Z",
        "2026-07-30T12:00:05.000Z",
        "2026-07-30T12:00:06.000Z"
      ]),
      runIdFactory: new FakeRunIdFactory(["run-brief-degraded"]),
      lock: new FakePipelineRunLock(),
      openResources: async () => ({ connection: new FakeDbConnection(), services })
    };

    const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1"]));

    expect(result.positions[0]?.status).toBe("degraded");
    expect(result.positions[0]?.briefOutcome).toBe("generated_degraded");
    expect(publishedId).toBe(101);
    expect(result.status).toBe("degraded");
  });

  it("publishes a created_degraded outcome as degraded status", async () => {
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    const base = createBaseServices(evalTime);

    let publishedId: number | null = null;

    const services: CoreEvidencePipelineServices = {
      ...base,
      publish: async (req) => {
        publishedId = req.evidenceBundleId;
        return { outcome: "created_degraded", bundleId: req.evidenceBundleId, attemptCount: 1 };
      }
    };

    const deps: RunCoreEvidencePipelineDeps = {
      clock: new QueuedClock([
        "2026-07-30T12:00:00.000Z",
        "2026-07-30T12:00:05.000Z",
        "2026-07-30T12:00:06.000Z"
      ]),
      runIdFactory: new FakeRunIdFactory(["run-pub-degraded"]),
      lock: new FakePipelineRunLock(),
      openResources: async () => ({ connection: new FakeDbConnection(), services })
    };

    const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1"]));

    expect(result.positions[0]?.status).toBe("degraded");
    expect(result.positions[0]?.publishOutcome).toBe("created_degraded");
    expect(publishedId).toBe(101);
    expect(result.status).toBe("degraded");
  });

  it("fails no_brief and thrown brief errors without publishing", async () => {
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    const base = createBaseServices(evalTime);

    const testCases: Array<() => Promise<GenerateResearchBriefOutcome>> = [
      async () => ({ outcome: "no_brief", reason: "no_bundle" }),
      async () => {
        throw new Error("Brief LLM provider crashed");
      }
    ];

    for (const briefFn of testCases) {
      let publishCalled = false;
      const services: CoreEvidencePipelineServices = {
        ...base,
        generateBrief: briefFn,
        publish: async () => {
          publishCalled = true;
          return { outcome: "created", bundleId: 101, attemptCount: 1 };
        }
      };

      const deps: RunCoreEvidencePipelineDeps = {
        clock: new QueuedClock([
          "2026-07-30T12:00:00.000Z",
          "2026-07-30T12:00:05.000Z",
          "2026-07-30T12:00:06.000Z"
        ]),
        runIdFactory: new FakeRunIdFactory(["run-brief-fail"]),
        lock: new FakePipelineRunLock(),
        openResources: async () => ({ connection: new FakeDbConnection(), services })
      };

      const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1"]));

      expect(publishCalled).toBe(false);
      expect(result.positions[0]?.status).toBe("failed");
      expect(result.positions[0]?.diagnostic?.stage).toBe("brief");
    }
  });

  it("fails every non-success publish outcome for only its own position", async () => {
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    const base = createBaseServices(evalTime);

    const nonSuccessPublishOutcomes: PublishEvidenceBundleResult[] = [
      { outcome: "bundle_not_found" },
      { outcome: "local_validation_failed", reason: "bad schema" },
      { outcome: "validation_failed", bundleId: 101, httpStatus: 400 },
      { outcome: "auth_failed", bundleId: 101, httpStatus: 401 },
      { outcome: "conflict", bundleId: 101, httpStatus: 409 },
      { outcome: "unknown_failed", bundleId: 101, httpStatus: 500 },
      { outcome: "permanent_http_failed", bundleId: 101, httpStatus: 500 },
      { outcome: "audit_store_failed", reason: "db error" },
      { outcome: "transient_failure_exhausted", bundleId: 101, httpStatus: 503 }
    ];

    for (const pubResult of nonSuccessPublishOutcomes) {
      const services: CoreEvidencePipelineServices = {
        ...base,
        publish: async (req) => {
          if (req.evidenceBundleId === 101) {
            return pubResult;
          }
          return { outcome: "created", bundleId: 102, attemptCount: 1 };
        }
      };

      const deps: RunCoreEvidencePipelineDeps = {
        clock: new QueuedClock([
          "2026-07-30T12:00:00.000Z",
          "2026-07-30T12:00:05.000Z",
          "2026-07-30T12:00:06.000Z",
          "2026-07-30T12:00:07.000Z"
        ]),
        runIdFactory: new FakeRunIdFactory(["run-pub-fail"]),
        lock: new FakePipelineRunLock(),
        openResources: async () => ({ connection: new FakeDbConnection(), services })
      };

      const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1", "pos-2"]));

      expect(result.positions[0]?.positionId).toBe("pos-1");
      expect(result.positions[0]?.status).toBe("failed");
      expect(result.positions[0]?.publishOutcome).toBe(pubResult.outcome);
      expect(result.positions[0]?.diagnostic?.stage).toBe("publish");

      expect(result.positions[1]?.positionId).toBe("pos-2");
      expect(result.positions[1]?.status).toBe("complete");

      expect(result.status).toBe("partial_failure");
    }
  });

  it("computes complete degraded partial_failure and failed from all attempted positions", async () => {
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    const base = createBaseServices(evalTime);

    // 1. All complete => status complete
    {
      const deps: RunCoreEvidencePipelineDeps = {
        clock: new QueuedClock([
          "2026-07-30T12:00:00.000Z",
          "2026-07-30T12:00:05.000Z",
          "2026-07-30T12:00:06.000Z",
          "2026-07-30T12:00:07.000Z"
        ]),
        runIdFactory: new FakeRunIdFactory(["run-agg-1"]),
        lock: new FakePipelineRunLock(),
        openResources: async () => ({ connection: new FakeDbConnection(), services: base })
      };
      const res = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1", "pos-2"]));
      expect(res.status).toBe("complete");
    }

    // 2. One complete, one degraded => status degraded
    {
      const services = {
        ...base,
        generateBrief: async (req: { evidenceBundleId: number }) => {
          if (req.evidenceBundleId === 102) {
            return {
              outcome: "generated_degraded" as const,
              row: dummyBriefRow,
              brief: dummyBrief
            };
          }
          return { outcome: "generated_complete" as const, row: dummyBriefRow, brief: dummyBrief };
        }
      };
      const deps: RunCoreEvidencePipelineDeps = {
        clock: new QueuedClock([
          "2026-07-30T12:00:00.000Z",
          "2026-07-30T12:00:05.000Z",
          "2026-07-30T12:00:06.000Z",
          "2026-07-30T12:00:07.000Z"
        ]),
        runIdFactory: new FakeRunIdFactory(["run-agg-2"]),
        lock: new FakePipelineRunLock(),
        openResources: async () => ({ connection: new FakeDbConnection(), services })
      };
      const res = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1", "pos-2"]));
      expect(res.status).toBe("degraded");
    }

    // 3. One complete, one failed => status partial_failure
    {
      const services = {
        ...base,
        generateBrief: async (req: { evidenceBundleId: number }) => {
          if (req.evidenceBundleId === 102) {
            return { outcome: "no_brief" as const, reason: "no_bundle" as const };
          }
          return { outcome: "generated_complete" as const, row: dummyBriefRow, brief: dummyBrief };
        }
      };
      const deps: RunCoreEvidencePipelineDeps = {
        clock: new QueuedClock([
          "2026-07-30T12:00:00.000Z",
          "2026-07-30T12:00:05.000Z",
          "2026-07-30T12:00:06.000Z",
          "2026-07-30T12:00:07.000Z"
        ]),
        runIdFactory: new FakeRunIdFactory(["run-agg-3"]),
        lock: new FakePipelineRunLock(),
        openResources: async () => ({ connection: new FakeDbConnection(), services })
      };
      const res = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1", "pos-2"]));
      expect(res.status).toBe("partial_failure");
    }

    // 4. All failed => status failed
    {
      const services = {
        ...base,
        assemble: async () => ({ outcome: "no_bundle" as const }),
        assemblePair: async () => ({ outcome: "no_bundle" as const })
      };
      const deps: RunCoreEvidencePipelineDeps = {
        clock: new QueuedClock([
          "2026-07-30T12:00:00.000Z",
          "2026-07-30T12:00:05.000Z",
          "2026-07-30T12:00:06.000Z",
          "2026-07-30T12:00:07.000Z"
        ]),
        runIdFactory: new FakeRunIdFactory(["run-agg-4"]),
        lock: new FakePipelineRunLock(),
        openResources: async () => ({ connection: new FakeDbConnection(), services })
      };
      const res = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1", "pos-2"]));
      expect(res.status).toBe("failed");
    }
  });
});
