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
import type { ResearchBriefRepo, ResearchBriefRow } from "../../src/ports/brief-repo.js";
import type { PersistedResearchBrief } from "../../src/contracts/research-brief.js";
import type { PrepareEvidenceBundleResult } from "../../src/application/assemble-evidence-bundle.js";
import type {
  GenerateResearchBriefOutcome,
  GenerateResearchBriefParams
} from "../../src/application/generate-research-brief.js";
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

import type { PreparedEvidenceBundle } from "../../src/application/assemble-evidence-bundle.js";
import type { PreparedPairEvidenceBundle } from "../../src/application/assemble-pair-evidence-bundle.js";
import type { EvidenceBundleV1 } from "../../src/contracts/generated/evidence-bundle-v1.js";
import type { CanonicalEvidenceBundle } from "../../src/ports/evidence-bundle-contract.js";

const dummyPreparedBundle: PreparedEvidenceBundle = {
  slots: [],
  lineage: { rawObservationIds: [], normalizedObservationIds: [], sourceReferences: [] },
  selectedContextEvents: [],
  selectedSupportResistance: [],
  selectedNewsEvidence: [],
  qualityInputFacts: {
    createdAt: 0,
    asOf: 0,
    freshUntil: 0,
    expiresAt: 0,
    hasSupportResistance: true,
    hasFlows: true,
    hasDerivatives: true,
    hasEvents: true,
    hasNewsRegulatory: true
  },
  requestMeta: {
    pair: "SOL/USDC",
    poolId: "pool-1",
    positionId: "pos-1",
    walletId: "wallet-1",
    pipelineRunId: "run-1",
    correlationId: "corr-1",
    evaluationTimeUnixMs: 0,
    createdAtUnixMs: 0,
    codeVersion: "1.0.0",
    gitCommit: "commit",
    environment: "test"
  },
  nullBriefCandidate: {
    requestMeta: {
      pair: "SOL/USDC",
      poolId: "pool-1",
      positionId: "pos-1",
      walletId: "wallet-1",
      pipelineRunId: "run-1",
      correlationId: "corr-1",
      evaluationTimeUnixMs: 0,
      createdAtUnixMs: 0,
      codeVersion: "1.0.0",
      gitCommit: "commit",
      environment: "test"
    }
  } as unknown as EvidenceBundleV1,
  canonical: {} as CanonicalEvidenceBundle
};

const dummyPreparedPairBundle: PreparedPairEvidenceBundle = {
  slots: [],
  lineage: { rawObservationIds: [], normalizedObservationIds: [], sourceReferences: [] },
  selectedContextEvents: [],
  selectedSupportResistance: [],
  selectedNewsEvidence: [],
  qualityInputFacts: {
    createdAt: 0,
    asOf: 0,
    freshUntil: 0,
    expiresAt: 0,
    hasSupportResistance: true,
    hasFlows: true,
    hasDerivatives: true,
    hasEvents: true,
    hasNewsRegulatory: true
  },
  requestMeta: {
    pair: "SOL/USDC",
    poolId: "pool-1",
    pipelineRunId: "run-1",
    correlationId: "corr-1",
    evaluationTimeUnixMs: 0,
    createdAtUnixMs: 0,
    codeVersion: "1.0.0",
    gitCommit: "commit",
    environment: "test"
  },
  nullBriefCandidate: {
    requestMeta: {
      pair: "SOL/USDC",
      poolId: "pool-1",
      pipelineRunId: "run-1",
      correlationId: "corr-1",
      evaluationTimeUnixMs: 0,
      createdAtUnixMs: 0,
      codeVersion: "1.0.0",
      gitCommit: "commit",
      environment: "test"
    }
  } as unknown as EvidenceBundleV1,
  canonical: {} as CanonicalEvidenceBundle
};

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
    prepare: async (req) => ({
      outcome: "prepared",
      prepared: {
        ...dummyPreparedBundle,
        requestMeta: { ...dummyPreparedBundle.requestMeta, positionId: req.positionId },
        nullBriefCandidate: {
          ...dummyPreparedBundle.nullBriefCandidate,
          requestMeta: {
            ...(
              dummyPreparedBundle.nullBriefCandidate as unknown as {
                requestMeta?: { positionId?: string };
              }
            ).requestMeta,
            positionId: req.positionId
          }
        }
      }
    }),
    preparePair: async () => ({ outcome: "prepared", prepared: dummyPreparedPairBundle }),
    finalize: async (prep) => {
      const rowId = prep.requestMeta.positionId === "pos-1" ? 101 : 102;
      return {
        outcome: "persisted",
        rowId,
        payloadHash: `hash-${rowId}`,
        slotCount: 3,
        warnings: []
      };
    },
    finalizePair: async () => ({
      outcome: "persisted",
      rowId: 500,
      payloadHash: "hash-500",
      slotCount: 16,
      warnings: []
    }),
    generateBrief: async () => ({
      outcome: "generated_complete",
      brief: dummyBrief
    }),
    persistBrief: async (params) =>
      ({ id: 1, evidenceBundleId: params.bundleId }) as ResearchBriefRow,
    publish: async (req) => ({
      outcome: "created",
      bundleId: req.evidenceBundleId,
      attemptCount: 1
    })
  };
}

describe("runCoreEvidencePipeline - Per-Position Targeting", () => {
  it("exact replay skips brief generation and repairs missing lineage", async () => {
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    let generateCalled = false;
    let finalizeCalled = false;
    let persistBriefCalled = false;
    let published = false;

    const base = createBaseServices(evalTime);
    const services: CoreEvidencePipelineServices = {
      ...base,
      prepare: async () => ({
        outcome: "identical_replay",
        rowId: 101,
        payloadHash: "hash-pos-101",
        slotCount: 3,
        warnings: [],
        embeddedBrief: dummyBrief
      }),
      generateBrief: async (req) => {
        if (
          (req.evidenceBundlePayload as unknown as { requestMeta?: { positionId?: string } })
            ?.requestMeta?.positionId === "pos-1"
        ) {
          generateCalled = true;
        }
        return { outcome: "generated_complete", brief: dummyBrief };
      },
      finalize: async () => {
        finalizeCalled = true;
        return {
          outcome: "persisted",
          rowId: 101,
          payloadHash: "hash-pos-101",
          slotCount: 3,
          warnings: []
        };
      },
      persistBrief: async (params) => {
        if (params.bundleId === 101) {
          persistBriefCalled = true;
        }
        return { id: 1, evidenceBundleId: params.bundleId } as ResearchBriefRow;
      },
      publish: async (req) => {
        if (req.evidenceBundleId === 101) {
          published = true;
        }
        return { outcome: "created", bundleId: req.evidenceBundleId, attemptCount: 1 };
      }
    };

    const briefRepo = {
      insert: async () => ({ id: 1 }) as ResearchBriefRow,
      findByBundleId: async () => [],
      findByHash: async () => undefined
    };

    const deps: RunCoreEvidencePipelineDeps = {
      clock: new QueuedClock(["2026-07-30T12:00:00.000Z", "2026-07-30T12:00:05.000Z"]),
      runIdFactory: new FakeRunIdFactory(["run-replay-pos"]),
      lock: new FakePipelineRunLock(),
      openResources: async () => ({
        connection: new FakeDbConnection(),
        briefRepo: briefRepo as unknown as ResearchBriefRepo,
        services
      })
    };

    const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1"]));

    expect(generateCalled).toBe(false);
    expect(finalizeCalled).toBe(false);
    expect(persistBriefCalled).toBe(true);
    expect(published).toBe(true);
    expect(result.positions[0]?.briefOutcome).toBe("reused");
    expect(result.positions[0]?.assemblyOutcome).toBe("identical_replay");
    expect(result.positions[0]?.status).toBe("complete");
  });

  it("final bundle and linked brief are ordered before publish", async () => {
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    const callLog: string[] = [];

    const base = createBaseServices(evalTime);
    const services: CoreEvidencePipelineServices = {
      ...base,
      prepare: async () => {
        callLog.push("prepare");
        return { outcome: "prepared", prepared: dummyPreparedBundle };
      },
      generateBrief: async (req) => {
        if (
          (req.evidenceBundlePayload as unknown as { requestMeta?: { positionId?: string } })
            ?.requestMeta?.positionId === "pos-1"
        ) {
          callLog.push("generate");
        }
        return { outcome: "generated_complete", brief: dummyBrief };
      },
      finalize: async () => {
        callLog.push("finalize");
        return {
          outcome: "persisted",
          rowId: 101,
          payloadHash: "h101",
          slotCount: 3,
          warnings: []
        };
      },
      persistBrief: async (p) => {
        if (p.bundleId === 101) {
          callLog.push("persistBrief");
        }
        return { id: 1, evidenceBundleId: p.bundleId } as ResearchBriefRow;
      },
      publish: async (r) => {
        if (r.evidenceBundleId === 101) {
          callLog.push("publish");
        }
        return { outcome: "created", bundleId: r.evidenceBundleId, attemptCount: 1 };
      }
    };

    const deps: RunCoreEvidencePipelineDeps = {
      clock: new QueuedClock(["2026-07-30T12:00:00.000Z", "2026-07-30T12:00:05.000Z"]),
      runIdFactory: new FakeRunIdFactory(["run-order-pos"]),
      lock: new FakePipelineRunLock(),
      openResources: async () => ({ connection: new FakeDbConnection(), services })
    };

    await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1"]));

    expect(callLog).toEqual(["prepare", "generate", "finalize", "persistBrief", "publish"]);
  });

  it("degraded generated brief is finalized and published as degraded", async () => {
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    let finalizeReceivedBrief: PersistedResearchBrief | undefined;
    let published = false;

    const base = createBaseServices(evalTime);
    const services: CoreEvidencePipelineServices = {
      ...base,
      generateBrief: async () => ({ outcome: "generated_degraded", brief: dummyBrief }),
      finalize: async (_, brief) => {
        finalizeReceivedBrief = brief;
        return {
          outcome: "persisted",
          rowId: 101,
          payloadHash: "hash-101",
          slotCount: 3,
          warnings: []
        };
      },
      publish: async (req) => {
        published = true;
        return { outcome: "created", bundleId: req.evidenceBundleId, attemptCount: 1 };
      }
    };

    const deps: RunCoreEvidencePipelineDeps = {
      clock: new QueuedClock(["2026-07-30T12:00:00.000Z", "2026-07-30T12:00:05.000Z"]),
      runIdFactory: new FakeRunIdFactory(["run-deg-pos"]),
      lock: new FakePipelineRunLock(),
      openResources: async () => ({ connection: new FakeDbConnection(), services })
    };

    const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1"]));

    expect(finalizeReceivedBrief).toBe(dummyBrief);
    expect(published).toBe(true);
    expect(result.positions[0]?.briefOutcome).toBe("generated_degraded");
    expect(result.positions[0]?.status).toBe("degraded");
  });

  it("brief persistence failure stops publish after bundle finalization", async () => {
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    let publishCalled = false;

    const base = createBaseServices(evalTime);
    const services: CoreEvidencePipelineServices = {
      ...base,
      persistBrief: async () => {
        throw new Error("DB insert brief row failed for position");
      },
      publish: async () => {
        publishCalled = true;
        return { outcome: "created", bundleId: 101, attemptCount: 1 };
      }
    };

    const deps: RunCoreEvidencePipelineDeps = {
      clock: new QueuedClock(["2026-07-30T12:00:00.000Z", "2026-07-30T12:00:05.000Z"]),
      runIdFactory: new FakeRunIdFactory(["run-brief-persist-fail-pos"]),
      lock: new FakePipelineRunLock(),
      openResources: async () => ({ connection: new FakeDbConnection(), services })
    };

    const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1"]));

    expect(publishCalled).toBe(false);
    expect(result.positions[0]?.status).toBe("failed");
    expect(result.positions[0]?.briefOutcome).toBe("error");
    expect(result.positions[0]?.publishOutcome).toBeNull();
    expect(result.positions[0]?.diagnostic?.stage).toBe("brief");
  });

  it("target failure is isolated", async () => {
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    const base = createBaseServices(evalTime);

    const services: CoreEvidencePipelineServices = {
      ...base,
      prepare: async (req) => {
        if (req.positionId === "pos-1") {
          throw new Error("Position 1 prepare crash");
        }
        return { outcome: "prepared", prepared: dummyPreparedBundle };
      }
    };

    const deps: RunCoreEvidencePipelineDeps = {
      clock: new QueuedClock([
        "2026-07-30T12:00:00.000Z",
        "2026-07-30T12:00:05.000Z",
        "2026-07-30T12:00:06.000Z"
      ]),
      runIdFactory: new FakeRunIdFactory(["run-pos-iso"]),
      lock: new FakePipelineRunLock(),
      openResources: async () => ({ connection: new FakeDbConnection(), services })
    };

    const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1", "pos-2"]));

    expect(result.positions[0]?.positionId).toBe("pos-1");
    expect(result.positions[0]?.status).toBe("failed");
    expect(result.positions[1]?.positionId).toBe("pos-2");
    expect(result.positions[1]?.status).toBe("complete");
  });

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

    const outcomes = [
      { outcome: "prepared" as const },
      {
        outcome: "identical_replay" as const,
        rowId: 202,
        payloadHash: "h",
        slotCount: 3,
        warnings: [],
        embeddedBrief: dummyBrief
      },
      { outcome: "no_bundle" as const },
      { code: "VALIDATION_ERROR" as const, errors: ["bad"] }
    ];

    for (const prepOutcome of outcomes) {
      const services: CoreEvidencePipelineServices = {
        ...base,
        prepare: async () => {
          if ("outcome" in prepOutcome && prepOutcome.outcome === "prepared") {
            return { outcome: "prepared", prepared: dummyPreparedBundle };
          }
          return prepOutcome as unknown as PrepareEvidenceBundleResult;
        }
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

      if (
        "outcome" in prepOutcome &&
        (prepOutcome.outcome === "prepared" || prepOutcome.outcome === "identical_replay")
      ) {
        expect(result.positions[0]?.status).toBe("complete");
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
      { outcome: "generated_complete", brief: dummyBrief },
      { outcome: "reused", brief: dummyBrief, reusedRow: dummyBriefRow }
    ];

    for (const briefOutcome of briefOutcomes) {
      let publishTargetId: number | null = null;

      const services: CoreEvidencePipelineServices = {
        ...base,
        generateBrief: async () => briefOutcome,
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
        generateBrief: async (req: GenerateResearchBriefParams) => {
          if (
            (req.evidenceBundlePayload as unknown as { requestMeta?: { positionId?: string } })
              ?.requestMeta?.positionId === "pos-2"
          ) {
            return {
              outcome: "generated_degraded" as const,
              brief: dummyBrief
            };
          }
          return { outcome: "generated_complete" as const, brief: dummyBrief };
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
        generateBrief: async (req: GenerateResearchBriefParams) => {
          if (
            (req.evidenceBundlePayload as unknown as { requestMeta?: { positionId?: string } })
              ?.requestMeta?.positionId === "pos-2"
          ) {
            return { outcome: "no_brief" as const, reason: "no_bundle" as const };
          }
          return { outcome: "generated_complete" as const, brief: dummyBrief };
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
        prepare: async () => ({ outcome: "no_bundle" as const }),
        preparePair: async () => ({ outcome: "no_bundle" as const })
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

  it("does not fall back to single-phase position assembly when position preparation fails", async () => {
    let publishCalled = false;

    const base = createBaseServices(new Date("2026-07-30T12:00:00.000Z").getTime());
    const services: CoreEvidencePipelineServices = {
      ...base,
      preparePair: async () => ({ outcome: "no_bundle" }),
      prepare: async () => {
        throw new Error("position prepare failed");
      },
      publish: async () => {
        publishCalled = true;
        return { outcome: "created", bundleId: 999, attemptCount: 1 };
      }
    };

    const deps: RunCoreEvidencePipelineDeps = {
      clock: new QueuedClock(["2026-07-30T12:00:00.000Z"]),
      runIdFactory: new FakeRunIdFactory(["run-123"]),
      lock: new FakePipelineRunLock(),
      openResources: async () => ({ connection: new FakeDbConnection(), services })
    };

    const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1"]));

    expect(result.positions).toHaveLength(1);
    expect(result.positions[0]?.status).toBe("failed");
    expect(result.positions[0]?.bundleId).toBeNull();
    expect(result.positions[0]?.diagnostic?.code).toBe("ASSEMBLY_FAILED");
    expect(publishCalled).toBe(false);
  });
});
