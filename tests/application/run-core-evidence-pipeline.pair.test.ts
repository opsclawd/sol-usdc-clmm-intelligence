import { describe, it, expect } from "vitest";
import { runCoreEvidencePipeline } from "../../src/application/run-core-evidence-pipeline.js";
import type {
  CoreEvidencePipelineServices,
  RunCoreEvidencePipelineDeps
} from "../../src/application/run-core-evidence-pipeline.js";
import type { AssembleEvidenceBundleRequest } from "../../src/application/assemble-evidence-bundle.js";
import type { AssemblePairEvidenceBundleRequest } from "../../src/application/assemble-pair-evidence-bundle.js";
import type { GenerateAndPersistResearchBriefParams as GenerateResearchBriefParams } from "../../src/application/generate-research-brief.js";
import type { CoreEvidencePipelineConfig } from "../../src/application/load-core-evidence-pipeline-config.js";
import type { Clock } from "../../src/ports/clock.js";
import type { DbConnection } from "../../src/ports/db.js";
import type { DerivedFeatureRow } from "../../src/ports/feature-repo.js";
import type { ResearchBriefRow } from "../../src/ports/brief-repo.js";
import type { PersistedResearchBrief } from "../../src/contracts/research-brief.js";
import { FakePipelineRunLock } from "../fakes/fake-pipeline-run-lock.js";
import { FakeRunIdFactory } from "../fakes/fake-run-id-factory.js";
import { MVP_ACCEPTED_CALCULATOR_VERSIONS } from "../../src/domain/derived-feature/constants.js";
import { EVIDENCE_BUNDLE_SELECTION_VERSION } from "../../src/domain/evidence-bundle/select.js";

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

function createDefaultConfig(positionIds: string[] = ["pos-1"]): CoreEvidencePipelineConfig {
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
    assemble: async () => ({
      outcome: "persisted",
      rowId: 101,
      payloadHash: "hash-pos-101",
      slotCount: 3,
      warnings: []
    }),
    assemblePair: async () => ({
      outcome: "persisted",
      rowId: 500,
      payloadHash: "hash-pair-500",
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
}

describe("runCoreEvidencePipeline - Pair Orchestration", () => {
  it("publishes one pair bundle in addition to every configured position bundle", async () => {
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    let assemblePairCalled = 0;
    let assemblePositionCalled = 0;
    const publishedBundleIds: number[] = [];

    const base = createBaseServices(evalTime);
    const services: CoreEvidencePipelineServices = {
      ...base,
      assemblePair: async () => {
        assemblePairCalled++;
        return { outcome: "persisted", rowId: 500, payloadHash: "hp", slotCount: 16, warnings: [] };
      },
      assemble: async () => {
        assemblePositionCalled++;
        return { outcome: "persisted", rowId: 101, payloadHash: "h1", slotCount: 3, warnings: [] };
      },
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
      runIdFactory: new FakeRunIdFactory(["run-pair-pos"]),
      lock: new FakePipelineRunLock(),
      openResources: async () => ({ connection: new FakeDbConnection(), services })
    };

    const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1"]));

    expect(assemblePairCalled).toBe(1);
    expect(assemblePositionCalled).toBe(1);
    expect(publishedBundleIds).toEqual([500, 101]);
    expect(result.pair).not.toBeNull();
    expect(result.pair?.bundleId).toBe(500);
    expect(result.pair?.status).toBe("complete");
    expect(result.positions[0]?.bundleId).toBe(101);
    expect(result.positions[0]?.status).toBe("complete");
    expect(result.status).toBe("complete");
  });

  it("shares pipelineRunId and evaluation time while passing the canonical pool id and a pair-specific correlation id", async () => {
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    let capturedPairReq: AssemblePairEvidenceBundleRequest | null = null;
    let capturedPairBriefReq: GenerateResearchBriefParams | null = null;

    const base = createBaseServices(evalTime);
    const services: CoreEvidencePipelineServices = {
      ...base,
      assemblePair: async (req: AssemblePairEvidenceBundleRequest) => {
        capturedPairReq = req;
        return { outcome: "persisted", rowId: 500, payloadHash: "hp", slotCount: 16, warnings: [] };
      },
      generateBrief: async (req) => {
        if (req.evidenceBundleId === 500) {
          capturedPairBriefReq = req;
        }
        return {
          outcome: "generated_complete",
          row: { id: req.evidenceBundleId } as unknown as ResearchBriefRow,
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
      runIdFactory: new FakeRunIdFactory(["run-identity"]),
      lock: new FakePipelineRunLock(),
      openResources: async () => ({ connection: new FakeDbConnection(), services })
    };

    await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1"]));

    expect(capturedPairReq).not.toBeNull();
    const pairReq = capturedPairReq!;
    expect(pairReq.pair).toBe("SOL/USDC");
    expect(pairReq.poolId).toBe("pool-1");
    expect(pairReq.pipelineRunId).toBe("run-identity");
    expect(pairReq.correlationId).toBe("run:run-identity:pair");
    expect(pairReq.evaluationTimeUnixMs).toBe(evalTime);
    expect(pairReq.acceptedCalculatorVersions).toBe(MVP_ACCEPTED_CALCULATOR_VERSIONS);
    expect(pairReq.assemblySelectionVersion).toBe(EVIDENCE_BUNDLE_SELECTION_VERSION);
    const pairReqObj = pairReq as unknown as Record<string, unknown>;
    expect(pairReqObj.walletId).toBeUndefined();
    expect(pairReqObj.positionId).toBeUndefined();

    expect(capturedPairBriefReq).not.toBeNull();
    const briefReq = capturedPairBriefReq!;
    expect(briefReq.pair).toBe("SOL/USDC");
    expect(briefReq.runId).toBe("run-identity");
    expect(briefReq.evaluationTimeUnixMs).toBe(evalTime);
  });

  it("does not run pair or position publication after unavailable collection or failed derivation", async () => {
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();

    for (const collectionStatus of ["UNAVAILABLE", "FAILED"] as const) {
      let assemblePairCalled = false;
      let assemblePosCalled = false;

      const services: CoreEvidencePipelineServices = {
        ...createBaseServices(evalTime),
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
          status: collectionStatus,
          shouldFailCommand: true
        }),
        assemblePair: async () => {
          assemblePairCalled = true;
          return { outcome: "no_bundle" };
        },
        assemble: async () => {
          assemblePosCalled = true;
          return { outcome: "no_bundle" };
        }
      };

      const deps: RunCoreEvidencePipelineDeps = {
        clock: new QueuedClock(["2026-07-30T12:00:00.000Z", "2026-07-30T12:00:05.000Z"]),
        runIdFactory: new FakeRunIdFactory([`run-unavail-${collectionStatus}`]),
        lock: new FakePipelineRunLock(),
        openResources: async () => ({ connection: new FakeDbConnection(), services })
      };

      const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1"]));

      expect(assemblePairCalled).toBe(false);
      expect(assemblePosCalled).toBe(false);
      expect(result.pair).toBeNull();
      expect(result.positions).toEqual([]);
      expect(result.status).toBe("failed");
    }

    // Derivation failure case
    let assemblePairCalledOnDeriveFail = false;
    const servicesDeriveFail: CoreEvidencePipelineServices = {
      ...createBaseServices(evalTime),
      derive: async () => {
        throw new Error("Derivation error");
      },
      assemblePair: async () => {
        assemblePairCalledOnDeriveFail = true;
        return { outcome: "no_bundle" };
      }
    };
    const depsDeriveFail: RunCoreEvidencePipelineDeps = {
      clock: new QueuedClock(["2026-07-30T12:00:00.000Z", "2026-07-30T12:00:05.000Z"]),
      runIdFactory: new FakeRunIdFactory(["run-derive-fail"]),
      lock: new FakePipelineRunLock(),
      openResources: async () => ({
        connection: new FakeDbConnection(),
        services: servicesDeriveFail
      })
    };

    const resultDeriveFail = await runCoreEvidencePipeline(
      depsDeriveFail,
      createDefaultConfig(["pos-1"])
    );
    expect(assemblePairCalledOnDeriveFail).toBe(false);
    expect(resultDeriveFail.pair).toBeNull();
    expect(resultDeriveFail.positions).toEqual([]);
    expect(resultDeriveFail.status).toBe("failed");
  });

  it("records pair assembly failure without blocking position targets", async () => {
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    const base = createBaseServices(evalTime);

    const services: CoreEvidencePipelineServices = {
      ...base,
      assemblePair: async () => {
        throw new Error("Pair assembly database crash");
      }
    };

    const deps: RunCoreEvidencePipelineDeps = {
      clock: new QueuedClock([
        "2026-07-30T12:00:00.000Z",
        "2026-07-30T12:00:05.000Z",
        "2026-07-30T12:00:06.000Z"
      ]),
      runIdFactory: new FakeRunIdFactory(["run-pair-assembly-fail"]),
      lock: new FakePipelineRunLock(),
      openResources: async () => ({ connection: new FakeDbConnection(), services })
    };

    const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1"]));

    expect(result.pair).not.toBeNull();
    expect(result.pair?.status).toBe("failed");
    expect(result.pair?.bundleId).toBeNull();
    expect(result.pair?.assemblyOutcome).toBe("error");
    expect(result.pair?.diagnostic?.stage).toBe("assembly");

    expect(result.positions).toHaveLength(1);
    expect(result.positions[0]?.status).toBe("complete");
    expect(result.positions[0]?.bundleId).toBe(101);

    expect(result.status).toBe("partial_failure");
  });

  it("records pair brief failure without publishing the pair bundle", async () => {
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    const base = createBaseServices(evalTime);
    let pairPublished = false;

    const services: CoreEvidencePipelineServices = {
      ...base,
      generateBrief: async (req) => {
        if (req.evidenceBundleId === 500) {
          return { outcome: "no_brief", reason: "no_bundle" };
        }
        return {
          outcome: "generated_complete",
          row: { id: req.evidenceBundleId } as unknown as ResearchBriefRow,
          brief: dummyBrief
        };
      },
      publish: async (req) => {
        if (req.evidenceBundleId === 500) {
          pairPublished = true;
        }
        return { outcome: "created", bundleId: req.evidenceBundleId, attemptCount: 1 };
      }
    };

    const deps: RunCoreEvidencePipelineDeps = {
      clock: new QueuedClock([
        "2026-07-30T12:00:00.000Z",
        "2026-07-30T12:00:05.000Z",
        "2026-07-30T12:00:06.000Z"
      ]),
      runIdFactory: new FakeRunIdFactory(["run-pair-brief-fail"]),
      lock: new FakePipelineRunLock(),
      openResources: async () => ({ connection: new FakeDbConnection(), services })
    };

    const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1"]));

    expect(pairPublished).toBe(false);
    expect(result.pair).not.toBeNull();
    expect(result.pair?.bundleId).toBe(500);
    expect(result.pair?.briefOutcome).toBe("no_brief");
    expect(result.pair?.publishOutcome).toBeNull();
    expect(result.pair?.status).toBe("failed");
    expect(result.pair?.diagnostic?.stage).toBe("brief");

    expect(result.positions[0]?.status).toBe("complete");
    expect(result.status).toBe("partial_failure");
  });

  it("records pair publish failure without hiding successful positions", async () => {
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    const base = createBaseServices(evalTime);

    const services: CoreEvidencePipelineServices = {
      ...base,
      publish: async (req) => {
        if (req.evidenceBundleId === 500) {
          return { outcome: "validation_failed", bundleId: 500, httpStatus: 400 };
        }
        return { outcome: "created", bundleId: req.evidenceBundleId, attemptCount: 1 };
      }
    };

    const deps: RunCoreEvidencePipelineDeps = {
      clock: new QueuedClock([
        "2026-07-30T12:00:00.000Z",
        "2026-07-30T12:00:05.000Z",
        "2026-07-30T12:00:06.000Z"
      ]),
      runIdFactory: new FakeRunIdFactory(["run-pair-pub-fail"]),
      lock: new FakePipelineRunLock(),
      openResources: async () => ({ connection: new FakeDbConnection(), services })
    };

    const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1"]));

    expect(result.pair).not.toBeNull();
    expect(result.pair?.status).toBe("failed");
    expect(result.pair?.publishOutcome).toBe("validation_failed");
    expect(result.pair?.diagnostic?.stage).toBe("publish");

    expect(result.positions[0]?.status).toBe("complete");
    expect(result.status).toBe("partial_failure");
  });

  it("marks pair degraded for partial collection degraded brief or degraded publication", async () => {
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    const base = createBaseServices(evalTime);

    // 1. Partial collection
    {
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
            warnings: [{ source: "pyth", code: "stale", message: "stale" }],
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
        runIdFactory: new FakeRunIdFactory(["run-deg-coll"]),
        lock: new FakePipelineRunLock(),
        openResources: async () => ({ connection: new FakeDbConnection(), services })
      };

      const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1"]));
      expect(result.pair?.status).toBe("degraded");
      expect(result.status).toBe("degraded");
    }

    // 2. Degraded brief
    {
      const services: CoreEvidencePipelineServices = {
        ...base,
        generateBrief: async (req) => {
          if (req.evidenceBundleId === 500) {
            return {
              outcome: "generated_degraded",
              row: { id: 500 } as unknown as ResearchBriefRow,
              brief: dummyBrief
            };
          }
          return {
            outcome: "generated_complete",
            row: { id: req.evidenceBundleId } as unknown as ResearchBriefRow,
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
        runIdFactory: new FakeRunIdFactory(["run-deg-brief"]),
        lock: new FakePipelineRunLock(),
        openResources: async () => ({ connection: new FakeDbConnection(), services })
      };

      const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1"]));
      expect(result.pair?.status).toBe("degraded");
      expect(result.pair?.briefOutcome).toBe("generated_degraded");
      expect(result.status).toBe("degraded");
    }

    // 3. Degraded publish
    {
      const services: CoreEvidencePipelineServices = {
        ...base,
        publish: async (req) => {
          if (req.evidenceBundleId === 500) {
            return { outcome: "created_degraded", bundleId: 500, attemptCount: 1 };
          }
          return { outcome: "created", bundleId: req.evidenceBundleId, attemptCount: 1 };
        }
      };

      const deps: RunCoreEvidencePipelineDeps = {
        clock: new QueuedClock([
          "2026-07-30T12:00:00.000Z",
          "2026-07-30T12:00:05.000Z",
          "2026-07-30T12:00:06.000Z"
        ]),
        runIdFactory: new FakeRunIdFactory(["run-deg-pub"]),
        lock: new FakePipelineRunLock(),
        openResources: async () => ({ connection: new FakeDbConnection(), services })
      };

      const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1"]));
      expect(result.pair?.status).toBe("degraded");
      expect(result.pair?.publishOutcome).toBe("created_degraded");
      expect(result.status).toBe("degraded");
    }
  });

  it("includes pair failure in aggregate status even when every position completes", async () => {
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    const base = createBaseServices(evalTime);

    const services: CoreEvidencePipelineServices = {
      ...base,
      assemblePair: async () => ({ outcome: "no_bundle" })
    };

    const deps: RunCoreEvidencePipelineDeps = {
      clock: new QueuedClock([
        "2026-07-30T12:00:00.000Z",
        "2026-07-30T12:00:05.000Z",
        "2026-07-30T12:00:06.000Z"
      ]),
      runIdFactory: new FakeRunIdFactory(["run-pair-fail-agg"]),
      lock: new FakePipelineRunLock(),
      openResources: async () => ({ connection: new FakeDbConnection(), services })
    };

    const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1", "pos-2"]));

    expect(result.pair?.status).toBe("failed");
    expect(result.positions[0]?.status).toBe("complete");
    expect(result.positions[1]?.status).toBe("complete");
    expect(result.status).toBe("partial_failure");
  });

  it("returns pair null on skipped lock preflight and infrastructure failure paths", async () => {
    // 1. Skipped lock
    {
      const lock = new FakePipelineRunLock();
      lock.shouldContend = true;
      const deps: RunCoreEvidencePipelineDeps = {
        clock: new QueuedClock(["2026-07-30T12:00:00.000Z"]),
        runIdFactory: new FakeRunIdFactory(["run-skip"]),
        lock,
        openResources: async () => {
          throw new Error("Should not open");
        }
      };

      const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1"]));
      expect(result.pair).toBeNull();
      expect(result.status).toBe("skipped_already_running");
    }

    // 2. Lock acquire failure
    {
      const lock = new FakePipelineRunLock();
      lock.acquireError = new Error("Lock failed");
      const deps: RunCoreEvidencePipelineDeps = {
        clock: new QueuedClock(["2026-07-30T12:00:00.000Z"]),
        runIdFactory: new FakeRunIdFactory(["run-acq-err"]),
        lock,
        openResources: async () => {
          throw new Error("Should not open");
        }
      };

      const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1"]));
      expect(result.pair).toBeNull();
      expect(result.status).toBe("failed");
    }

    // 3. Open resources failure
    {
      const lock = new FakePipelineRunLock();
      const deps: RunCoreEvidencePipelineDeps = {
        clock: new QueuedClock(["2026-07-30T12:00:00.000Z"]),
        runIdFactory: new FakeRunIdFactory(["run-open-err"]),
        lock,
        openResources: async () => {
          throw new Error("DB connection failed");
        }
      };

      const result = await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1"]));
      expect(result.pair).toBeNull();
      expect(result.status).toBe("failed");
    }
  });

  it("uses pair and position run identities that cannot collide at regime-engine", async () => {
    const evalTime = new Date("2026-07-30T12:00:05.000Z").getTime();
    let capturedPairReq: AssemblePairEvidenceBundleRequest | null = null;
    let capturedPosReq: AssembleEvidenceBundleRequest | null = null;

    const base = createBaseServices(evalTime);
    const services: CoreEvidencePipelineServices = {
      ...base,
      assemblePair: async (req: AssemblePairEvidenceBundleRequest) => {
        capturedPairReq = req;
        return { outcome: "persisted", rowId: 500, payloadHash: "hp", slotCount: 16, warnings: [] };
      },
      assemble: async (req: AssembleEvidenceBundleRequest) => {
        capturedPosReq = req;
        return { outcome: "persisted", rowId: 101, payloadHash: "h1", slotCount: 3, warnings: [] };
      }
    };

    const deps: RunCoreEvidencePipelineDeps = {
      clock: new QueuedClock([
        "2026-07-30T12:00:00.000Z",
        "2026-07-30T12:00:05.000Z",
        "2026-07-30T12:00:06.000Z"
      ]),
      runIdFactory: new FakeRunIdFactory(["shared-run-abc"]),
      lock: new FakePipelineRunLock(),
      openResources: async () => ({ connection: new FakeDbConnection(), services })
    };

    await runCoreEvidencePipeline(deps, createDefaultConfig(["pos-1"]));

    const pairReq = capturedPairReq!;
    expect(pairReq.correlationId).toBe("run:shared-run-abc:pair");
    expect(capturedPosReq).not.toBeNull();
    const posReq = capturedPosReq!;
    expect(posReq.correlationId).toBe("run:shared-run-abc:position:pos-1");
    expect(pairReq.correlationId).not.toEqual(posReq.correlationId);
  });
});
