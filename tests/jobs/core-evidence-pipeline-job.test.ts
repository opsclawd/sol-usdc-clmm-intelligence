import { describe, it, expect } from "vitest";
import { coreEvidencePipelineJob } from "../../src/jobs/core-evidence-pipeline-job.js";
import type {
  RunCoreEvidencePipelineDeps,
  CoreEvidencePipelineServices
} from "../../src/application/run-core-evidence-pipeline.js";
import type { CoreEvidencePipelineConfig } from "../../src/application/load-core-evidence-pipeline-config.js";
import type { Clock } from "../../src/ports/clock.js";
import type { DbConnection } from "../../src/ports/db.js";
import type { DerivedFeatureRow } from "../../src/ports/feature-repo.js";
import type { ResearchBriefRow } from "../../src/ports/brief-repo.js";
import type { PersistedResearchBrief } from "../../src/contracts/research-brief.js";
import type { EvidenceBundleV1 } from "../../src/contracts/generated/evidence-bundle-v1.js";
import type { CanonicalEvidenceBundle } from "../../src/ports/evidence-bundle-contract.js";
import { FakePipelineRunLock } from "../fakes/fake-pipeline-run-lock.js";
import { FakeRunIdFactory } from "../fakes/fake-run-id-factory.js";

class QueuedClock implements Clock {
  now(): string {
    return "2026-07-30T12:00:00.000Z";
  }
}

class FakeDbConnection implements DbConnection {
  public closeCalls = 0;
  async close(): Promise<void> {
    this.closeCalls++;
  }
}

function createDummyPositionFeature(
  kind: "range_location" | "distance_to_lower" | "distance_to_upper",
  poolId: string,
  positionId: string,
  asOfUnixMs: number
): DerivedFeatureRow {
  return {
    id: 1,
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

const dummyBrief = {} as unknown as PersistedResearchBrief;

describe("coreEvidencePipelineJob", () => {
  it("delegates config and dependencies to the application use case without owning cleanup", async () => {
    const lock = new FakePipelineRunLock();
    const connection = new FakeDbConnection();

    let openResourcesCalled = false;
    const evalTime = new Date("2026-07-30T12:00:00.000Z").getTime();

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
      derive: async () => ({
        rows: [
          createDummyPositionFeature("range_location", "pool-1", "pos-1", evalTime),
          createDummyPositionFeature("distance_to_lower", "pool-1", "pos-1", evalTime),
          createDummyPositionFeature("distance_to_upper", "pool-1", "pos-1", evalTime)
        ],
        counts: { AVAILABLE: 3, PARTIAL: 0, UNAVAILABLE: 0, REJECTED: 0 },
        warnings: []
      }),
      prepare: async () => ({
        outcome: "prepared",
        prepared: {
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
          nullBriefCandidate: {} as unknown as EvidenceBundleV1,
          canonical: {} as unknown as CanonicalEvidenceBundle
        }
      }),
      preparePair: async () => ({
        outcome: "prepared",
        prepared: {
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
          nullBriefCandidate: {} as unknown as EvidenceBundleV1,
          canonical: {} as unknown as CanonicalEvidenceBundle
        }
      }),
      finalize: async () => ({
        outcome: "persisted",
        rowId: 50,
        payloadHash: "h",
        slotCount: 3,
        warnings: []
      }),
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
      persistBrief: async (p) => ({ id: 1, evidenceBundleId: p.bundleId }) as ResearchBriefRow,
      publish: async () => ({ outcome: "created", bundleId: 50, attemptCount: 1 })
    };

    const deps: RunCoreEvidencePipelineDeps = {
      clock: new QueuedClock(),
      runIdFactory: new FakeRunIdFactory(["run-job-1"]),
      lock,
      openResources: async () => {
        openResourcesCalled = true;
        return { connection, services };
      }
    };

    const config: CoreEvidencePipelineConfig = {
      positionIds: ["pos-1"],
      poolId: "pool-1",
      walletId: "wallet-1",
      codeVersion: "1.0.0",
      gitCommit: "0123456789abcdef0123456789abcdef01234567",
      environment: "test",
      configuredFamilies: new Set([
        "deterministic",
        "supportResistance",
        "flows",
        "derivatives",
        "events",
        "newsRegulatory",
        "researchBrief"
      ])
    };

    const job = coreEvidencePipelineJob(deps);
    const result = await job(config);

    expect(openResourcesCalled).toBe(true);
    expect(result.pipelineRunId).toBe("run-job-1");
    expect(result.status).toBe("complete");
    expect(connection.closeCalls).toBe(1);
    expect(lock.releaseCalls).toBe(1);
  });
});
