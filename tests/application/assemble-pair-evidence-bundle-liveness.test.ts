import { describe, it, expect } from "vitest";
import type { RawObservationRepo } from "../../src/ports/observation-repo.js";
import type { EvidenceBundleContract } from "../../src/ports/evidence-bundle-contract.js";
import type { EvidenceFamily, Source } from "../../src/contracts/taxonomy.js";
import {
  preparePairEvidenceBundle,
  type AssemblePairEvidenceBundleRequest,
  type AssemblePairEvidenceBundleDeps
} from "../../src/application/assemble-pair-evidence-bundle.js";
import { createEvidenceBundleContract } from "../../src/adapters/node/evidence-bundle-v1-contract.js";
import { FakeObservationRepo } from "../fakes/fake-observation-repo.js";
import { FakeNormalizedObservationRepo } from "../fakes/fake-normalized-observation-repo.js";
import { FakeFeatureRepo } from "../fakes/fake-feature-repo.js";
import { FakeBundleRepo } from "../fakes/fake-bundle-repo.js";
import { FakeClock } from "../fakes/fake-clock.js";
import { DEFAULT_CONFIDENCE, DEFAULT_PROVENANCE } from "../helpers/derived-feature-fixtures.js";
import { MVP_ACCEPTED_CALCULATOR_VERSIONS } from "../../src/domain/derived-feature/constants.js";
import { EVIDENCE_BUNDLE_SELECTION_VERSION } from "../../src/domain/evidence-bundle/select.js";

class TestRawObservationRepo extends FakeObservationRepo implements RawObservationRepo {
  latestReceivedAtMap = new Map<Source, number>();
  shouldFailGetLatestReceivedAt = false;

  override async getLatestReceivedAt(): Promise<Map<Source, number>> {
    if (this.shouldFailGetLatestReceivedAt) {
      throw new Error("Database connection failed for getLatestReceivedAt");
    }
    if (this.latestReceivedAtMap.size > 0) {
      return this.latestReceivedAtMap;
    }
    return super.getLatestReceivedAt();
  }
}

async function setupFixture() {
  const clock = new FakeClock(1_700_000_000_000);
  const rawRepo = new TestRawObservationRepo();
  const normalizedRepo = new FakeNormalizedObservationRepo();
  const featureRepo = new FakeFeatureRepo();
  const bundleRepo = new FakeBundleRepo();
  const contract = createEvidenceBundleContract();

  const rawRow = await rawRepo.insertOrClassify({
    source: "orca-whirlpool-api",
    sourceObservationKey: "raw-key-100",
    observedAtUnixMs: 1_700_000_000_000,
    fetchedAtUnixMs: 1_700_000_000_000,
    payloadHash: "raw-hash-100",
    payloadCanonical: "{}",
    parseStatus: "parsed",
    receivedAtUnixMs: 1_700_000_000_000
  });

  const rawId = rawRow.row.id;

  const normRow = await normalizedRepo.insert({
    rawObservationId: rawId,
    source: "orca-whirlpool-api",
    observationKind: "pool_state",
    signalClass: "deterministic",
    evidenceFamily: "clmm_state",
    payload: { price: 100 },
    payloadHash: "norm-hash-10",
    confidence: DEFAULT_CONFIDENCE,
    provenance: {
      ...DEFAULT_PROVENANCE,
      rawObservationRefs: [
        {
          refType: "raw_observation",
          id: rawId,
          source: "orca-whirlpool-api",
          payloadHash: "raw-hash-100"
        }
      ]
    },
    receivedAtUnixMs: 1_700_000_000_000
  });

  const normId = normRow.id;
  const calcVersion = MVP_ACCEPTED_CALCULATOR_VERSIONS.realized_volatility_1h;

  const featurePayload = {
    schemaVersion: 1,
    featureKind: "realized_volatility_1h" as const,
    status: "AVAILABLE" as const,
    value: 0.05,
    unit: "RATIO",
    pair: "SOL/USDC" as const,
    poolId: "sol-usdc-pool",
    positionId: null,
    asOfUnixMs: 1_700_000_000_000,
    expiresAtUnixMs: 1_700_000_060_000,
    confidence: DEFAULT_CONFIDENCE,
    freshness: {
      isStale: false,
      validUntilUnixMs: 1_700_000_060_000,
      derivedAt: 1_700_000_000_000,
      policyKind: "realized_volatility_1h" as const,
      reasons: []
    },
    inputObservationIds: [normId],
    rejectedObservationIds: [],
    provenance: {
      ...DEFAULT_PROVENANCE,
      rawObservationRefs: [
        {
          refType: "raw_observation" as const,
          id: rawId,
          source: "orca-whirlpool-api",
          payloadHash: "raw-hash-100"
        }
      ],
      derivedFromRefs: [
        {
          refType: "normalized_observation" as const,
          id: normId,
          source: "orca-whirlpool-api",
          payloadHash: "norm-hash-10"
        }
      ]
    },
    warnings: [],
    reasons: [],
    calculatorVersion: calcVersion,
    selectionVersion: EVIDENCE_BUNDLE_SELECTION_VERSION,
    calculationMetadata: {}
  };

  await featureRepo.insert({
    featureKind: "realized_volatility_1h",
    signalClass: "deterministic",
    evidenceFamily: "price_quality",
    value: 0.05,
    structuredPayload: featurePayload,
    asOfUnixMs: 1_700_000_000_000,
    validUntilUnixMs: 1_700_000_060_000,
    receivedAtUnixMs: 1_700_000_000_000,
    status: "AVAILABLE",
    unit: "RATIO",
    pair: "SOL/USDC",
    calculatorVersion: calcVersion,
    selectionVersion: EVIDENCE_BUNDLE_SELECTION_VERSION,
    inputObservationIds: [normId],
    rejectedObservationIds: [],
    derivationKey: "pair=SOL/USDC,kind=realized_volatility_1h",
    poolId: null,
    positionId: null,
    provenance: featurePayload.provenance,
    payloadHash: "feat-hash-1",
    confidence: DEFAULT_CONFIDENCE
  });

  const deps: AssemblePairEvidenceBundleDeps = {
    clock,
    rawRepo,
    normalizedRepo,
    featureRepo,
    bundleRepo,
    contract
  };

  const baseRequest = {
    pair: "SOL/USDC",
    poolId: "sol-usdc-pool",
    pipelineRunId: "run-123",
    correlationId: "corr-123",
    evaluationTimeUnixMs: 1_700_000_000_000,
    createdAtUnixMs: 1_700_000_000_000,
    acceptedCalculatorVersions: MVP_ACCEPTED_CALCULATOR_VERSIONS,
    schemaVersion: "evidence-bundle.v1",
    assemblySelectionVersion: EVIDENCE_BUNDLE_SELECTION_VERSION,
    codeVersion: "1.0.0",
    gitCommit: "0".repeat(64),
    environment: "test",
    configuredEvidenceFamilies: new Set<EvidenceFamily>([
      "clmm_state",
      "price_quality",
      "clmm_economics",
      "execution_safety",
      "market_regime",
      "support_resistance",
      "on_chain_flow",
      "perp_liquidation",
      "macro_protocol_risk",
      "news_evidence"
    ])
  } as unknown as AssemblePairEvidenceBundleRequest;

  return { deps, rawRepo, baseRequest };
}

describe("pair-evidence-bundle liveness regression proof", () => {
  it("emits liveness for every coverage family before canonical hashing", async () => {
    const { deps, baseRequest } = await setupFixture();

    const result = await preparePairEvidenceBundle(deps, baseRequest);
    expect(result.outcome).toBe("prepared");
    if (result.outcome !== "prepared") return;

    const assessment = result.prepared.canonical.payload.assessment;
    expect(assessment.liveness).toBeDefined();
    const liveness = assessment.liveness;
    if (!liveness) throw new Error("liveness must be defined");

    expect(Object.keys(liveness).sort()).toEqual(Object.keys(assessment.coverage).sort());
  });

  it("uses the latest mapped source time and null for a configured family that never ran", async () => {
    const { deps, rawRepo, baseRequest } = await setupFixture();

    rawRepo.latestReceivedAtMap.set("orca-whirlpool-api", 1_700_000_000_100);
    rawRepo.latestReceivedAtMap.set("pyth-price-feed", 1_700_000_000_123);

    const result = await preparePairEvidenceBundle(deps, baseRequest);
    expect(result.outcome).toBe("prepared");
    if (result.outcome !== "prepared") return;

    const assessment = result.prepared.canonical.payload.assessment;
    expect(assessment.liveness).toBeDefined();
    const liveness = assessment.liveness;
    if (!liveness) throw new Error("liveness must be defined");

    expect(Object.keys(liveness).sort()).toEqual(Object.keys(assessment.coverage).sort());

    expect(liveness.deterministic).toEqual({
      isConfigured: true,
      lastCollectedAt: "2023-11-14T22:13:20.123Z"
    });

    expect(liveness.derivatives).toEqual({
      isConfigured: true,
      lastCollectedAt: null
    });
  });

  it("preserves a historical last run when a family is now unconfigured", async () => {
    const { deps, rawRepo, baseRequest } = await setupFixture();

    rawRepo.latestReceivedAtMap.set("technical-analysis-api", 1_700_000_000_123);

    const request = {
      ...baseRequest,
      configuredEvidenceFamilies: new Set<EvidenceFamily>([
        "clmm_state",
        "price_quality",
        "clmm_economics",
        "execution_safety",
        "market_regime",
        "on_chain_flow",
        "perp_liquidation",
        "macro_protocol_risk",
        "news_evidence"
      ])
    } as unknown as AssemblePairEvidenceBundleRequest;

    const result = await preparePairEvidenceBundle(deps, request);
    expect(result.outcome).toBe("prepared");
    if (result.outcome !== "prepared") return;

    const assessment = result.prepared.canonical.payload.assessment;
    expect(assessment.liveness).toBeDefined();
    const liveness = assessment.liveness;
    if (!liveness) throw new Error("liveness must be defined");

    expect(Object.keys(liveness).sort()).toEqual(Object.keys(assessment.coverage).sort());

    expect(liveness.supportResistance).toEqual({
      isConfigured: false,
      lastCollectedAt: "2023-11-14T22:13:20.123Z"
    });
  });

  it("fails pair preparation closed when collection liveness cannot be loaded", async () => {
    const { deps, rawRepo, baseRequest } = await setupFixture();

    rawRepo.shouldFailGetLatestReceivedAt = true;

    let validateCallCount = 0;
    const realContract = deps.contract;
    const contractDelegate: EvidenceBundleContract = {
      async validateCanonicalizeAndHash(candidate: unknown) {
        validateCallCount++;
        return realContract.validateCanonicalizeAndHash(candidate);
      }
    };

    const depsWithDelegate: AssemblePairEvidenceBundleDeps = {
      ...deps,
      contract: contractDelegate
    };

    const result = await preparePairEvidenceBundle(depsWithDelegate, baseRequest);

    expect("code" in result && result.code).toBe("LINEAGE_ERROR");
    expect(validateCallCount).toBe(0);
  });
});
