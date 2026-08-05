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

const dummyBrief = { briefId: "b-1" } as unknown as PersistedResearchBrief;
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
  nullBriefCandidate: {} as EvidenceBundleV1,
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
  nullBriefCandidate: {} as EvidenceBundleV1,
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
        createDummyPositionFeature("distance_to_upper", "pool-1", "pos-1", evalTime)
      ],
      counts: { AVAILABLE: 3, PARTIAL: 0, UNAVAILABLE: 0, REJECTED: 0 },
      warnings: []
    }),
    prepare: async () => ({ outcome: "prepared", prepared: dummyPreparedBundle }),
    preparePair: async () => ({ outcome: "prepared", prepared: dummyPreparedPairBundle }),
    finalize: async () => ({
      outcome: "persisted",
      rowId: 42,
      payloadHash: "hash42",
      slotCount: 3,
      warnings: []
    }),
    finalizePair: async () => ({
      outcome: "persisted",
      rowId: 50,
      payloadHash: "hash50",
      slotCount: 16,
      warnings: []
    }),
    generateBrief: async () => ({ outcome: "generated_complete", brief: dummyBrief }),
    persistBrief: async (p) => ({ id: 1, evidenceBundleId: p.bundleId }) as ResearchBriefRow,
    publish: async (req) => ({
      outcome: "created",
      bundleId: req.evidenceBundleId,
      attemptCount: 1
    })
  };
}

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

  it("final bundle and linked brief are ordered before publish", async () => {
    const lock = new FakePipelineRunLock();
    const connection = new FakeDbConnection();
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    const callLog: string[] = [];

    const base = createBaseServices(evalTime);
    const services: CoreEvidencePipelineServices = {
      ...base,
      preparePair: async () => {
        callLog.push("preparePair");
        return { outcome: "prepared", prepared: dummyPreparedPairBundle };
      },
      prepare: async () => {
        callLog.push("prepare");
        return { outcome: "prepared", prepared: dummyPreparedBundle };
      },
      generateBrief: async () => {
        callLog.push("generate");
        return { outcome: "generated_complete", brief: dummyBrief };
      },
      finalizePair: async () => {
        callLog.push("finalizePair");
        return {
          outcome: "persisted",
          rowId: 50,
          payloadHash: "hash50",
          slotCount: 16,
          warnings: []
        };
      },
      finalize: async () => {
        callLog.push("finalize");
        return {
          outcome: "persisted",
          rowId: 42,
          payloadHash: "hash42",
          slotCount: 3,
          warnings: []
        };
      },
      persistBrief: async (p) => {
        callLog.push("persistBrief");
        return { id: 1, evidenceBundleId: p.bundleId } as ResearchBriefRow;
      },
      publish: async (r) => {
        callLog.push("publish");
        return { outcome: "created", bundleId: r.evidenceBundleId, attemptCount: 1 };
      }
    };

    const deps: RunCoreEvidencePipelineDeps = {
      clock: new QueuedClock(["2026-07-30T12:00:00.000Z", "2026-07-30T12:00:05.000Z"]),
      runIdFactory: new FakeRunIdFactory(["run-order"]),
      lock,
      openResources: async () => ({ connection, services })
    };

    const result = await runCoreEvidencePipeline(deps, createDefaultConfig());

    expect(result.status).toBe("complete");
    expect(callLog).toEqual([
      "preparePair",
      "generate",
      "finalizePair",
      "persistBrief",
      "publish",
      "prepare",
      "generate",
      "finalize",
      "persistBrief",
      "publish"
    ]);
  });

  it("shares one run ID from collection through derivation assembly brief and result", async () => {
    const lock = new FakePipelineRunLock();
    const connection = new FakeDbConnection();

    let collectedRunId: string | null = null;
    let derivedRunId: string | null = null;
    let preparedRunId: string | null = null;
    let briefRunId: string | null = null;

    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    const base = createBaseServices(evalTime);

    const services: CoreEvidencePipelineServices = {
      ...base,
      collect: async (ctx) => {
        collectedRunId = ctx.runId;
        return await base.collect(ctx);
      },
      derive: async (req) => {
        derivedRunId = req.pipelineRunId;
        return await base.derive(req);
      },
      prepare: async (req) => {
        preparedRunId = req.pipelineRunId;
        return { outcome: "prepared", prepared: dummyPreparedBundle };
      },
      generateBrief: async (req) => {
        briefRunId = req.runId ?? null;
        return {
          outcome: "generated_complete",
          brief: dummyBrief
        };
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
    expect(preparedRunId).toBe("shared-run-999");
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
    let prepareEvalTime: number | null = null;
    let briefEvalTime: number | null = null;

    const base = createBaseServices(t2Ms);
    const services: CoreEvidencePipelineServices = {
      ...base,
      derive: async (req) => {
        derivedEvalTime = req.evaluationTimeUnixMs;
        return await base.derive(req);
      },
      prepare: async (req) => {
        prepareEvalTime = req.evaluationTimeUnixMs;
        return { outcome: "prepared", prepared: dummyPreparedBundle };
      },
      generateBrief: async (req) => {
        briefEvalTime = req.evaluationTimeUnixMs;
        return { outcome: "generated_complete", brief: dummyBrief };
      }
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
    expect(prepareEvalTime).toBe(t2Ms);
    expect(briefEvalTime).toBe(t2Ms);
  });

  it("continues after PARTIAL collection with sorted warnings and degradation", async () => {
    const lock = new FakePipelineRunLock();
    const connection = new FakeDbConnection();
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    const base = createBaseServices(evalTime);

    const services: CoreEvidencePipelineServices = {
      ...base,
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
      })
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
        prepare: async () => ({ outcome: "no_bundle" }),
        preparePair: async () => ({ outcome: "no_bundle" }),
        finalize: async () => ({ outcome: "no_bundle" }),
        finalizePair: async () => ({ outcome: "no_bundle" }),
        generateBrief: async () => ({ outcome: "no_brief", reason: "no_bundle" }),
        persistBrief: async () => ({ id: 1 }) as ResearchBriefRow,
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
    const base = createBaseServices(evalTime);

    const services: CoreEvidencePipelineServices = {
      ...base,
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
      }
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
