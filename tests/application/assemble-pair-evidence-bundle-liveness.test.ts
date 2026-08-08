import { describe, it, expect } from "vitest";
import type { Clock } from "../../src/ports/clock.js";
import type {
  NormalizedObservationRepo,
  RawObservationRepo,
  EvidenceBundleRepo,
  EvidenceBundleContract,
  DerivedFeatureRepo
} from "../../src/ports/index.js";
import type { EvidenceBundleRow } from "../../src/ports/bundle-repo.js";
import type {
  Confidence,
  Provenance,
  SignalClass,
  EvidenceFamily,
  FeatureKind,
  Source
} from "../../src/contracts/taxonomy.js";
import type { FeatureUnit, FeatureStatus } from "../../src/contracts/derived-feature.js";
import type {
  NormalizedObservationRow,
  RawObservationRow,
  DerivedFeatureRow
} from "../../src/contracts/index.js";
import type { FamilyLiveness } from "../../src/domain/evidence-bundle/liveness.js";
import { MVP_ACCEPTED_CALCULATOR_VERSIONS } from "../../src/domain/derived-feature/constants.js";
import { EVIDENCE_BUNDLE_SELECTION_VERSION } from "../../src/domain/evidence-bundle/select.js";
import {
  preparePairEvidenceBundle,
  type AssemblePairEvidenceBundleRequest,
  type AssemblePairEvidenceBundleDeps
} from "../../src/application/assemble-pair-evidence-bundle.js";
import { createEvidenceBundleContract } from "../../src/adapters/node/evidence-bundle-v1-contract.js";
import type { BundleFamilyId } from "../../src/application/load-core-evidence-pipeline-config.js";

const DEFAULT_CONFIDENCE: Confidence = {
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
};

const DEFAULT_PROVENANCE: Provenance = {
  sourceRefs: [],
  rawObservationRefs: [],
  derivedFromRefs: [],
  processRef: {
    collector: "test",
    jobName: "test",
    pipelineRunId: null,
    codeVersion: null,
    modelVersion: null
  },
  codeVersion: "test",
  runId: null
};

function makeRawObservationRow(
  overrides: Partial<RawObservationRow> & { id: number; source: Source }
): RawObservationRow {
  return {
    id: overrides.id,
    source: overrides.source,
    sourceObservationKey: overrides.sourceObservationKey ?? `key-${overrides.id}`,
    observedAtUnixMs: overrides.observedAtUnixMs ?? 1_000_000,
    fetchedAtUnixMs: overrides.fetchedAtUnixMs ?? 1_000_000,
    payloadHash: overrides.payloadHash ?? `raw-hash-${overrides.id}`,
    payloadCanonical: overrides.payloadCanonical ?? JSON.stringify({ ok: true }),
    parseStatus: overrides.parseStatus ?? "parsed",
    sourceRequestMeta: overrides.sourceRequestMeta ?? null,
    receivedAtUnixMs: overrides.receivedAtUnixMs ?? 1_000_000
  };
}

function makeNormalizedRow(
  overrides: Partial<NormalizedObservationRow> & {
    id: number;
    rawObservationId: number;
    source: Source;
  }
): NormalizedObservationRow {
  const rawId = overrides.rawObservationId;
  const source = overrides.source;
  const rawHash = overrides.payloadHash ?? `raw-hash-${rawId}`;

  const provenance: Provenance = overrides.provenance ?? {
    ...DEFAULT_PROVENANCE,
    rawObservationRefs: [
      {
        refType: "raw_observation",
        id: rawId,
        source: source,
        payloadHash: rawHash
      }
    ]
  };

  return {
    id: overrides.id,
    rawObservationId: rawId,
    source: source,
    observationKind: overrides.observationKind ?? "oracle_price",
    signalClass: (overrides.signalClass ?? "deterministic") as SignalClass,
    evidenceFamily: (overrides.evidenceFamily ?? "clmm_state") as EvidenceFamily,
    payload: overrides.payload ?? { price: 100 },
    payloadHash: overrides.payloadHash ?? `norm-hash-${overrides.id}`,
    confidence: overrides.confidence ?? DEFAULT_CONFIDENCE,
    confidenceComposite: overrides.confidenceComposite ?? null,
    confidenceLevel: overrides.confidenceLevel ?? null,
    validUntilUnixMs: overrides.validUntilUnixMs ?? null,
    isStale: overrides.isStale ?? false,
    staleBehavior: overrides.staleBehavior ?? null,
    provenance,
    receivedAtUnixMs: overrides.receivedAtUnixMs ?? 1_000_000
  };
}

function makeFeatureRow(
  overrides: Partial<DerivedFeatureRow> & {
    id: number;
    featureKind: FeatureKind;
    derivationKey: string;
    asOfUnixMs: number;
    receivedAtUnixMs: number;
    status: FeatureStatus;
    value?: number | null;
  }
): DerivedFeatureRow {
  const normId = overrides.provenance?.derivedFromRefs?.[0]?.id ?? 15;
  const rawId = overrides.provenance?.rawObservationRefs?.[0]?.id ?? 5;
  const source = overrides.provenance?.derivedFromRefs?.[0]?.source ?? "jupiter-price";

  const provenance: Provenance = overrides.provenance ?? {
    ...DEFAULT_PROVENANCE,
    rawObservationRefs: [
      {
        refType: "raw_observation",
        id: rawId,
        source,
        payloadHash: `raw-hash-${rawId}`
      }
    ],
    derivedFromRefs: [
      {
        refType: "normalized_observation",
        id: normId,
        source,
        payloadHash: `norm-hash-${normId}`
      }
    ]
  };

  return {
    id: overrides.id,
    featureKind: overrides.featureKind,
    signalClass: (overrides.signalClass ?? "deterministic") as SignalClass,
    evidenceFamily: (overrides.evidenceFamily ?? "clmm_state") as EvidenceFamily,
    value: overrides.value ?? null,
    structuredPayload: overrides.structuredPayload ?? {},
    asOfUnixMs: overrides.asOfUnixMs,
    confidence: overrides.confidence ?? DEFAULT_CONFIDENCE,
    confidenceComposite: overrides.confidenceComposite ?? null,
    confidenceLevel: overrides.confidenceLevel ?? null,
    validUntilUnixMs: overrides.validUntilUnixMs ?? null,
    isStale: overrides.isStale ?? false,
    staleBehavior: overrides.staleBehavior ?? null,
    provenance,
    payloadHash: overrides.payloadHash ?? `feature-hash-${overrides.id}`,
    receivedAtUnixMs: overrides.receivedAtUnixMs,
    status: overrides.status,
    unit: (overrides.unit ?? "PPM") as FeatureUnit,
    pair: overrides.pair ?? "SOL/USDC",
    calculatorVersion:
      overrides.calculatorVersion ?? MVP_ACCEPTED_CALCULATOR_VERSIONS[overrides.featureKind],
    selectionVersion: overrides.selectionVersion ?? EVIDENCE_BUNDLE_SELECTION_VERSION,
    inputObservationIds: overrides.inputObservationIds ?? [rawId],
    rejectedObservationIds: overrides.rejectedObservationIds ?? [],
    derivationKey: overrides.derivationKey,
    poolId: overrides.poolId ?? null,
    positionId: overrides.positionId ?? null,
    warnings: overrides.warnings ?? [],
    reasons: overrides.reasons ?? []
  };
}

function makeBundleRow(overrides: Partial<EvidenceBundleRow> = {}): EvidenceBundleRow {
  return {
    id: 100,
    schemaVersion: "evidence-bundle.v1",
    pair: "SOL/USDC",
    asOfUnixMs: 1000000,
    expiresAtUnixMs: 4600000,
    payload: {},
    payloadHash: "canonical-hash-1",
    payloadCanonical: JSON.stringify({ pair: "SOL/USDC" }),
    idempotencyKey: "canonical-idemp-1",
    taxonomySummary: null,
    dominantSignalClass: "deterministic",
    confidence: DEFAULT_CONFIDENCE,
    confidenceComposite: 8000,
    confidenceLevel: "high",
    validUntilUnixMs: 8200000,
    isStale: false,
    staleBehavior: null,
    provenance: DEFAULT_PROVENANCE,
    version: 1,
    receivedAtUnixMs: 1000000,
    ...overrides
  };
}

function createStubRawRepo(
  latestReceivedAt: Map<Source, number> | (() => Promise<Map<Source, number>>),
  rows: RawObservationRow[] = []
): RawObservationRepo {
  return {
    async insertOrClassify() {
      throw new Error("not implemented");
    },
    async findById(id) {
      return rows.find((r) => r.id === id);
    },
    async findByIds(ids) {
      const set = new Set(ids);
      return rows.filter((r) => set.has(r.id));
    },
    async findByIdentity() {
      return undefined;
    },
    async findByHash() {
      return undefined;
    },
    async findBySource() {
      return [];
    },
    async updateParseStatus() {
      throw new Error("not implemented");
    },
    async getLatestReceivedAt() {
      if (typeof latestReceivedAt === "function") {
        return latestReceivedAt();
      }
      return latestReceivedAt;
    }
  };
}

function createStubNormalizedRepo(
  rows: NormalizedObservationRow[] = []
): NormalizedObservationRepo {
  return {
    async insert() {
      throw new Error("not implemented");
    },
    async insertMany() {
      throw new Error("not implemented");
    },
    async findBySource() {
      return [];
    },
    async findFreshByKind() {
      return [];
    },
    async findLatestByKind() {
      return null;
    },
    async findByRawObservation() {
      return null;
    },
    async listCandidates() {
      return [];
    },
    async findByIds(ids) {
      const set = new Set(ids);
      return rows.filter((r) => set.has(r.id));
    }
  };
}

function createStubFeatureRepo(featureRows: DerivedFeatureRow[] = []): DerivedFeatureRepo {
  return {
    async insert() {
      throw new Error("not implemented");
    },
    async insertMany() {
      throw new Error("not implemented");
    },
    async findByDerivationKey() {
      return undefined;
    },
    async findByKind() {
      return [];
    },
    async listBundleCandidates() {
      return featureRows;
    }
  };
}

function createStubBundleRepo(): EvidenceBundleRepo {
  return {
    async insertOrClassify() {
      return { outcome: "inserted", row: makeBundleRow() };
    },
    async findById() {
      return undefined;
    },
    async findByPair() {
      return [];
    },
    async findLatestByPair() {
      return undefined;
    }
  };
}

function makeFixture(
  latestReceivedAtMap: Map<Source, number> | (() => Promise<Map<Source, number>>)
) {
  const rawRow = makeRawObservationRow({
    id: 5,
    source: "jupiter-price",
    payloadHash: "raw-hash-5"
  });
  const normRow = makeNormalizedRow({
    id: 15,
    rawObservationId: 5,
    source: "jupiter-price",
    payloadHash: "norm-hash-15",
    provenance: {
      ...DEFAULT_PROVENANCE,
      rawObservationRefs: [
        { refType: "raw_observation", id: 5, source: "jupiter-price", payloadHash: "raw-hash-5" }
      ]
    }
  });
  const featureRow = makeFeatureRow({
    id: 100,
    featureKind: "realized_volatility_1h",
    derivationKey: "pair=SOL/USDC,kind=realized_volatility_1h",
    asOfUnixMs: 1_700_000_000_123,
    receivedAtUnixMs: 1_700_000_000_123,
    status: "AVAILABLE",
    value: 0.25,
    pair: "SOL/USDC",
    poolId: null,
    positionId: null
  });

  const rawRepo = createStubRawRepo(latestReceivedAtMap, [rawRow]);
  const normalizedRepo = createStubNormalizedRepo([normRow]);
  const featureRepo = createStubFeatureRepo([featureRow]);
  const bundleRepo = createStubBundleRepo();
  const contract = createEvidenceBundleContract();
  const clock: Clock = { now: () => "2023-11-14T22:13:20.123Z" };

  return {
    rawRepo,
    normalizedRepo,
    featureRepo,
    bundleRepo,
    contract,
    clock,
    featureRow
  };
}

describe("assemble-pair-evidence-bundle liveness regression", () => {
  it("emits liveness for every coverage family before canonical hashing", async () => {
    const latestReceivedAt = new Map<Source, number>([
      ["jupiter-price", 1_700_000_000_123],
      ["technical-analysis-api", 1_700_000_000_123],
      ["helius-api", 1_700_000_000_123],
      ["binance-fapi", 1_700_000_000_123],
      ["macro-calendar-api", 1_700_000_000_123],
      ["crypto-news-api", 1_700_000_000_123]
    ]);

    const { rawRepo, normalizedRepo, featureRepo, bundleRepo, contract, clock } =
      makeFixture(latestReceivedAt);

    const allFamilies = new Set<BundleFamilyId>([
      "deterministic",
      "supportResistance",
      "flows",
      "derivatives",
      "events",
      "newsRegulatory",
      "researchBrief"
    ]);

    const request: AssemblePairEvidenceBundleRequest = {
      pair: "SOL/USDC",
      poolId: "pool123",
      pipelineRunId: "run123",
      correlationId: "corr123",
      evaluationTimeUnixMs: 1_700_000_000_123,
      createdAtUnixMs: 1_700_000_000_123,
      acceptedCalculatorVersions: MVP_ACCEPTED_CALCULATOR_VERSIONS,
      schemaVersion: "evidence-bundle.v1",
      assemblySelectionVersion: EVIDENCE_BUNDLE_SELECTION_VERSION,
      codeVersion: "1.0.0",
      gitCommit: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      environment: "test",
      configuredFamilies: allFamilies
    };

    const deps: AssemblePairEvidenceBundleDeps = {
      clock,
      featureRepo,
      normalizedRepo,
      rawRepo,
      bundleRepo,
      contract
    };

    const result = await preparePairEvidenceBundle(deps, request);
    expect("outcome" in result && result.outcome === "prepared").toBe(true);

    if ("outcome" in result && result.outcome === "prepared") {
      const payload = result.prepared.canonical.payload;
      const assessment = payload.assessment;
      const liveness = (assessment as unknown as { liveness?: FamilyLiveness }).liveness;

      expect(liveness).toBeDefined();
      expect(Object.keys(liveness!).sort()).toEqual(Object.keys(assessment.coverage).sort());
    }
  });

  it("uses the latest mapped source time and null for a configured family that never ran", async () => {
    const latestReceivedAt = new Map<Source, number>([
      ["jupiter-price", 1_700_000_000_123],
      ["crypto-news-api", 1_700_000_000_100],
      ["regulatory-monitor-api", 1_700_000_000_200]
    ]);

    const { rawRepo, normalizedRepo, featureRepo, bundleRepo, contract, clock } =
      makeFixture(latestReceivedAt);

    const configuredFamilies = new Set<BundleFamilyId>([
      "deterministic",
      "newsRegulatory",
      "flows"
    ]);

    const request: AssemblePairEvidenceBundleRequest = {
      pair: "SOL/USDC",
      poolId: "pool123",
      pipelineRunId: "run123",
      correlationId: "corr123",
      evaluationTimeUnixMs: 1_700_000_000_200,
      createdAtUnixMs: 1_700_000_000_200,
      acceptedCalculatorVersions: MVP_ACCEPTED_CALCULATOR_VERSIONS,
      schemaVersion: "evidence-bundle.v1",
      assemblySelectionVersion: EVIDENCE_BUNDLE_SELECTION_VERSION,
      codeVersion: "1.0.0",
      gitCommit: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      environment: "test",
      configuredFamilies
    };

    const deps: AssemblePairEvidenceBundleDeps = {
      clock,
      featureRepo,
      normalizedRepo,
      rawRepo,
      bundleRepo,
      contract
    };

    const result = await preparePairEvidenceBundle(deps, request);
    expect("outcome" in result && result.outcome === "prepared").toBe(true);

    if ("outcome" in result && result.outcome === "prepared") {
      const assessment = result.prepared.canonical.payload.assessment;
      const liveness = (assessment as unknown as { liveness?: FamilyLiveness }).liveness;

      expect(liveness).toBeDefined();
      expect(liveness!.newsRegulatory).toEqual({
        isConfigured: true,
        lastCollectedAt: "2023-11-14T22:13:20.200Z"
      });
      expect(liveness!.flows).toEqual({
        isConfigured: true,
        lastCollectedAt: null
      });
    }
  });

  it("preserves a historical last run when a family is now unconfigured", async () => {
    const latestReceivedAt = new Map<Source, number>([
      ["jupiter-price", 1_700_000_000_123],
      ["technical-analysis-api", 1_700_000_000_123]
    ]);

    const { rawRepo, normalizedRepo, featureRepo, bundleRepo, contract, clock } =
      makeFixture(latestReceivedAt);

    const configuredFamilies = new Set<BundleFamilyId>(["deterministic"]);

    const request: AssemblePairEvidenceBundleRequest = {
      pair: "SOL/USDC",
      poolId: "pool123",
      pipelineRunId: "run123",
      correlationId: "corr123",
      evaluationTimeUnixMs: 1_700_000_000_123,
      createdAtUnixMs: 1_700_000_000_123,
      acceptedCalculatorVersions: MVP_ACCEPTED_CALCULATOR_VERSIONS,
      schemaVersion: "evidence-bundle.v1",
      assemblySelectionVersion: EVIDENCE_BUNDLE_SELECTION_VERSION,
      codeVersion: "1.0.0",
      gitCommit: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      environment: "test",
      configuredFamilies
    };

    const deps: AssemblePairEvidenceBundleDeps = {
      clock,
      featureRepo,
      normalizedRepo,
      rawRepo,
      bundleRepo,
      contract
    };

    const result = await preparePairEvidenceBundle(deps, request);
    expect("outcome" in result && result.outcome === "prepared").toBe(true);

    if ("outcome" in result && result.outcome === "prepared") {
      const assessment = result.prepared.canonical.payload.assessment;
      const liveness = (assessment as unknown as { liveness?: FamilyLiveness }).liveness;

      expect(liveness).toBeDefined();
      expect(liveness!.supportResistance).toEqual({
        isConfigured: false,
        lastCollectedAt: "2023-11-14T22:13:20.123Z"
      });
    }
  });

  it("fails pair preparation closed when collection liveness cannot be loaded", async () => {
    const realContract = createEvidenceBundleContract();
    let validateCallCount = 0;
    const delegateContract: EvidenceBundleContract = {
      async validateCanonicalizeAndHash(candidate: unknown) {
        validateCallCount++;
        return realContract.validateCanonicalizeAndHash(candidate);
      }
    };

    const rawRepoRejection = () => Promise.reject(new Error("Database liveness query failed"));

    const { rawRepo, normalizedRepo, featureRepo, bundleRepo, clock } =
      makeFixture(rawRepoRejection);

    const request: AssemblePairEvidenceBundleRequest = {
      pair: "SOL/USDC",
      poolId: "pool123",
      pipelineRunId: "run123",
      correlationId: "corr123",
      evaluationTimeUnixMs: 1_700_000_000_123,
      createdAtUnixMs: 1_700_000_000_123,
      acceptedCalculatorVersions: MVP_ACCEPTED_CALCULATOR_VERSIONS,
      schemaVersion: "evidence-bundle.v1",
      assemblySelectionVersion: EVIDENCE_BUNDLE_SELECTION_VERSION,
      codeVersion: "1.0.0",
      gitCommit: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      environment: "test",
      configuredFamilies: new Set<BundleFamilyId>(["deterministic"])
    };

    const deps: AssemblePairEvidenceBundleDeps = {
      clock,
      featureRepo,
      normalizedRepo,
      rawRepo,
      bundleRepo,
      contract: delegateContract
    };

    const result = await preparePairEvidenceBundle(deps, request);

    expect("code" in result && result.code === "LINEAGE_ERROR").toBe(true);
    expect(validateCallCount).toBe(0);
  });
});
