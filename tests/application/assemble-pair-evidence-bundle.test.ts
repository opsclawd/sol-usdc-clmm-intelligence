import { describe, it, expect } from "vitest";
import type { Clock } from "../../src/ports/clock.js";
import type {
  NormalizedObservationRepo,
  RawObservationRepo,
  EvidenceBundleRepo,
  EvidenceBundleContract
} from "../../src/ports/index.js";
import type {
  DerivedFeatureRepo,
  DerivedFeatureRow,
  BundleFeatureCandidateQuery
} from "../../src/ports/feature-repo.js";
import type {
  EvidenceBundleRow,
  EvidenceBundleInsert,
  EvidenceBundleInsertOutcome
} from "../../src/ports/bundle-repo.js";
import type { CanonicalEvidenceBundle } from "../../src/ports/evidence-bundle-contract.js";
import type {
  Confidence,
  Provenance,
  ProvenanceRef,
  SignalClass,
  EvidenceFamily,
  FeatureKind
} from "../../src/contracts/taxonomy.js";
import type { ScheduledEventPayloadV1 } from "../../src/contracts/context-events.js";
import type { NormalizedObservationRow, RawObservationRow } from "../../src/contracts/index.js";
import type { EvidenceBundleV1 } from "../../src/contracts/generated/evidence-bundle-v1.js";
import { MVP_FEATURE_KINDS } from "../../src/contracts/derived-feature.js";
import type { PersistedResearchBrief } from "../../src/contracts/research-brief.js";
import { MVP_ACCEPTED_CALCULATOR_VERSIONS } from "../../src/domain/derived-feature/constants.js";
import { EVIDENCE_BUNDLE_SELECTION_VERSION } from "../../src/domain/evidence-bundle/select.js";
import {
  preparePairEvidenceBundle,
  finalizePairEvidenceBundle,
  type AssemblePairEvidenceBundleRequest,
  type AssemblePairEvidenceBundleDeps,
  type AssemblePairEvidenceBundleResult
} from "../../src/application/assemble-pair-evidence-bundle.js";
import { createEvidenceBundleContract } from "../../src/adapters/node/evidence-bundle-v1-contract.js";

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
  overrides: Partial<RawObservationRow> & { id: number }
): RawObservationRow {
  return {
    id: overrides.id,
    source: (overrides.source ?? "macro-calendar-api") as RawObservationRow["source"],
    sourceObservationKey: overrides.sourceObservationKey ?? `key-${overrides.id}`,
    observedAtUnixMs: overrides.observedAtUnixMs ?? 1000000,
    fetchedAtUnixMs: overrides.fetchedAtUnixMs ?? 1000000,
    payloadHash: overrides.payloadHash ?? `raw-hash-${overrides.id}`,
    payloadCanonical: overrides.payloadCanonical ?? JSON.stringify({ title: "FOMC Meeting" }),
    parseStatus: overrides.parseStatus ?? "parsed",
    sourceRequestMeta: overrides.sourceRequestMeta ?? null,
    receivedAtUnixMs: overrides.receivedAtUnixMs ?? 1000000
  };
}

function makeScheduledEventPayload(
  overrides: Partial<ScheduledEventPayloadV1> = {}
): ScheduledEventPayloadV1 {
  return {
    sourceEventId: overrides.sourceEventId ?? "evt-1",
    eventFamily: "macro_protocol_risk",
    eventType: "scheduled_event",
    title: overrides.title ?? "FOMC Meeting",
    description: "Federal Open Market Committee Meeting",
    asOfUnixMs: overrides.asOfUnixMs ?? 1000000,
    expiresAtUnixMs: overrides.expiresAtUnixMs ?? 2000000,
    scheduledStartUnixMs: 1200000,
    scheduledEndUnixMs: 1400000,
    severity: overrides.severity ?? "HIGH",
    status: overrides.status ?? "SCHEDULED",
    affectedScope: ["SOL/USDC"],
    sourceReferences: [],
    sourceQuality: {
      providerId: "macro-calendar-api",
      reliability: 0.9,
      completeness: "complete",
      confirmation: "official"
    },
    rawProvenance: {
      sourceObservedAtUnixMs: 1000000,
      retrievedAtUnixMs: 1000000,
      retentionMode: "bounded_factual_extract",
      license: "public"
    },
    warnings: [],
    ...overrides
  };
}

function makeNormalizedRow(
  overrides: Partial<NormalizedObservationRow> & { id: number; rawObservationId: number }
): NormalizedObservationRow {
  const rawId = overrides.rawObservationId;
  const source = overrides.source ?? "macro-calendar-api";
  const rawHash = overrides.payloadHash ?? `raw-hash-${rawId}`;

  const provenance: Provenance = overrides.provenance ?? {
    ...DEFAULT_PROVENANCE,
    rawObservationRefs: [
      {
        refType: "raw_observation",
        id: rawId,
        source: source as ProvenanceRef["source"],
        payloadHash: rawHash
      }
    ]
  };

  return {
    id: overrides.id,
    rawObservationId: rawId,
    source: source as NormalizedObservationRow["source"],
    observationKind: (overrides.observationKind ??
      "scheduled_event") as NormalizedObservationRow["observationKind"],
    signalClass: (overrides.signalClass ?? "contextual") as SignalClass,
    evidenceFamily: (overrides.evidenceFamily ?? "macro_events") as EvidenceFamily,
    payload: overrides.payload ?? makeScheduledEventPayload(),
    payloadHash: overrides.payloadHash ?? `norm-hash-${overrides.id}`,
    confidence: overrides.confidence ?? DEFAULT_CONFIDENCE,
    confidenceComposite: overrides.confidenceComposite ?? null,
    confidenceLevel: overrides.confidenceLevel ?? null,
    validUntilUnixMs: overrides.validUntilUnixMs ?? null,
    isStale: overrides.isStale ?? false,
    staleBehavior: overrides.staleBehavior ?? null,
    provenance,
    receivedAtUnixMs: overrides.receivedAtUnixMs ?? 1000000
  };
}

function makeFeatureRow(
  overrides: Partial<DerivedFeatureRow> & {
    id: number;
    featureKind: FeatureKind;
    derivationKey: string;
    asOfUnixMs: number;
    receivedAtUnixMs: number;
    status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
    value?: number | null;
    calculatorVersion?: string;
    selectionVersion?: string;
    poolId?: string | null;
    positionId?: string | null;
    pair?: string;
    validUntilUnixMs?: number | null;
  }
): DerivedFeatureRow {
  const normId = overrides.provenance?.rawObservationRefs?.[0]?.id ?? 15;
  const rawId = overrides.inputObservationIds?.[0] ?? 5;

  const provenance: Provenance = overrides.provenance ?? {
    ...DEFAULT_PROVENANCE,
    rawObservationRefs: [
      {
        refType: "normalized_observation",
        id: normId,
        source: "jupiter-price",
        payloadHash: `norm-hash-${normId}`
      }
    ]
  };

  return {
    id: overrides.id,
    featureKind: overrides.featureKind,
    signalClass: (overrides.signalClass ?? "deterministic") as SignalClass,
    evidenceFamily: (overrides.evidenceFamily ?? "price_and_volatility") as EvidenceFamily,
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
    unit: overrides.unit ?? "PPM",
    pair: overrides.pair ?? "SOL/USDC",
    calculatorVersion:
      overrides.calculatorVersion ?? MVP_ACCEPTED_CALCULATOR_VERSIONS[overrides.featureKind],
    selectionVersion: overrides.selectionVersion ?? "mvp-evidence-bundle-selection/v1",
    inputObservationIds: overrides.inputObservationIds ?? [rawId],
    rejectedObservationIds: overrides.rejectedObservationIds ?? [],
    derivationKey: overrides.derivationKey,
    poolId: overrides.poolId ?? null,
    positionId: overrides.positionId ?? null,
    warnings: overrides.warnings ?? [],
    reasons: overrides.reasons ?? []
  };
}

function makeCanonicalBundle(): CanonicalEvidenceBundle {
  return {
    schemaVersion: "evidence-bundle.v1",
    payload: {} as unknown as EvidenceBundleV1,
    payloadCanonical: JSON.stringify({ pair: "SOL/USDC" }),
    payloadHash: "canonical-hash-1",
    idempotencyKey: "canonical-idemp-1"
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

function makeDefaultRequest(
  overrides: Partial<AssemblePairEvidenceBundleRequest> = {}
): AssemblePairEvidenceBundleRequest {
  return {
    pair: "SOL/USDC",
    poolId: "pool-1",
    pipelineRunId: "pipeline-1",
    correlationId: "corr-1",
    evaluationTimeUnixMs: 1000000,
    createdAtUnixMs: 1000000,
    acceptedCalculatorVersions: MVP_ACCEPTED_CALCULATOR_VERSIONS,
    schemaVersion: "evidence-bundle.v1",
    assemblySelectionVersion: EVIDENCE_BUNDLE_SELECTION_VERSION,
    codeVersion: "1.0.0",
    gitCommit: "9a0c68f4080ec2b934f44b0e3bc0f668d5255171",
    environment: "test",
    ...overrides
  };
}

function makeMockNormalizedRepo(
  overrides: Partial<NormalizedObservationRepo> = {}
): NormalizedObservationRepo {
  return {
    insert: async () => {
      throw new Error("not implemented");
    },
    insertMany: async () => {
      throw new Error("not implemented");
    },
    findBySource: async () => [],
    findFreshByKind: async () => [],
    findLatestByKind: async () => null,
    findByRawObservation: async () => null,
    listCandidates: async () => [],
    findByIds: async () => [],
    ...overrides
  };
}

function makeMockRawRepo(overrides: Partial<RawObservationRepo> = {}): RawObservationRepo {
  return {
    insertOrClassify: async () => {
      throw new Error("not implemented");
    },
    findById: async () => undefined,
    findByIds: async () => [],
    findByIdentity: async () => undefined,
    findByHash: async () => undefined,
    findBySource: async () => [],
    updateParseStatus: async () => {
      throw new Error("not implemented");
    },
    ...overrides
  };
}

function makeMockFeatureRepo(overrides: Partial<DerivedFeatureRepo> = {}): DerivedFeatureRepo {
  return {
    insert: async () => {
      throw new Error("not implemented");
    },
    insertMany: async () => {
      throw new Error("not implemented");
    },
    findByDerivationKey: async () => undefined,
    findByKind: async () => [],
    listBundleCandidates: async () => [],
    ...overrides
  };
}

function makeValidPairFeatureFixture() {
  const detRaw = makeRawObservationRow({
    id: 5,
    source: "jupiter-price",
    payloadHash: "raw-hash-5"
  });
  const detNorm = makeNormalizedRow({
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
    asOfUnixMs: 1000000,
    receivedAtUnixMs: 1000000,
    status: "AVAILABLE",
    value: 0.25,
    pair: "SOL/USDC",
    poolId: null,
    positionId: null,
    provenance: {
      ...DEFAULT_PROVENANCE,
      rawObservationRefs: [
        {
          refType: "normalized_observation",
          id: 15,
          source: "jupiter-price",
          payloadHash: "norm-hash-15"
        }
      ]
    }
  });

  return { detRaw, detNorm, featureRow };
}

function makeMockBrief(overrides: Partial<PersistedResearchBrief> = {}): PersistedResearchBrief {
  return {
    briefId: "brief-1",
    pair: "SOL/USDC",
    generationStatus: "complete",
    llmOutput: {
      summary: "Market conditions normal.",
      keyTakeaways: ["Key takeaway 1"],
      supportsCurrentRegime: "supports",
      regimeAssessmentReasoning: "Reasoning here",
      confidenceScore: 0.9,
      confidenceReasoning: "High confidence",
      sourceEvidenceIds: ["feat-realized_volatility_1h-100"],
      unsupportedOrMissingInputs: []
    },
    sourceRefs: [],
    providerMetadata: { provider: "openai", model: "gpt-4" },
    sourceBundleRef: { bundleId: "b-1", bundleHash: "hash-1" },
    inputContextHash: "ctx-hash-1",
    priorBriefRef: null,
    generatedAt: "2026-05-10T12:00:00.000Z",
    promptVersion: "1.0.0",
    ...overrides
  };
}

async function prepareAndFinalizePairWithoutBriefForTest(
  deps: AssemblePairEvidenceBundleDeps,
  request: AssemblePairEvidenceBundleRequest
): Promise<AssemblePairEvidenceBundleResult> {
  const prepared = await preparePairEvidenceBundle(deps, request);
  if ("code" in prepared || prepared.outcome !== "prepared") return prepared;
  return finalizePairEvidenceBundle(deps, prepared.prepared, undefined);
}

describe("assemblePairEvidenceBundle", () => {
  it("queries pair-applicable deterministic features for the canonical pool with no position filter", async () => {
    let capturedQuery: BundleFeatureCandidateQuery | null = null;
    const { detRaw, detNorm, featureRow } = makeValidPairFeatureFixture();

    const featureRepo = makeMockFeatureRepo({
      listBundleCandidates: async (q) => {
        capturedQuery = q;
        return [featureRow];
      }
    });

    const normalizedRepo = makeMockNormalizedRepo({
      listCandidates: async () => [],
      findByIds: async () => [detNorm]
    });

    const rawRepo = makeMockRawRepo({
      findByIds: async () => [detRaw],
      findById: async () => detRaw
    });

    const bundleRepo: EvidenceBundleRepo = {
      insertOrClassify: async () => ({ outcome: "inserted", row: makeBundleRow() }),
      findById: async () => undefined,
      findByPair: async () => [],
      findLatestByPair: async () => undefined
    };

    const contract: EvidenceBundleContract = {
      validateCanonicalizeAndHash: async () => makeCanonicalBundle()
    };

    const clock: Clock = { now: () => "2026-05-10T12:00:00.000Z" };

    const deps: AssemblePairEvidenceBundleDeps = {
      clock,
      featureRepo,
      normalizedRepo,
      rawRepo,
      bundleRepo,
      contract
    };

    const expectedPairFeatureKinds = MVP_FEATURE_KINDS.filter(
      (kind) => !["range_location", "distance_to_lower", "distance_to_upper"].includes(kind)
    );

    const result = await prepareAndFinalizePairWithoutBriefForTest(deps, makeDefaultRequest());
    expect("outcome" in result && result.outcome).toBe("persisted");

    expect(capturedQuery).not.toBeNull();
    const query = capturedQuery as unknown as BundleFeatureCandidateQuery;
    expect(query.pair).toBe("SOL/USDC");
    expect(query.featureKinds).toEqual(expectedPairFeatureKinds);
    expect(query.asOfAtOrAfterUnixMs).toBe(1000000 - 24 * 3600000);
    expect(query.asOfAtOrBeforeUnixMs).toBe(1000000);
    expect(query.receivedAtOrBeforeUnixMs).toBe(1000000);
    expect(query.poolId).toBe("pool-1");
    expect(query.positionId).toBeNull();
  });

  it("selects a pool-scoped volume ratio into the pair bundle", async () => {
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

    const poolVolumeRow = makeFeatureRow({
      id: 101,
      featureKind: "volume_liquidity_ratio_24h",
      derivationKey: "pool=pool-1,kind=volume_liquidity_ratio_24h",
      asOfUnixMs: 1000000,
      receivedAtUnixMs: 1000000,
      status: "AVAILABLE",
      value: 1.5,
      pair: "SOL/USDC",
      poolId: "pool-1",
      positionId: null,
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          {
            refType: "normalized_observation",
            id: 15,
            source: "jupiter-price",
            payloadHash: "norm-hash-15"
          }
        ]
      }
    });

    let capturedCandidate: unknown = null;

    const deps: AssemblePairEvidenceBundleDeps = {
      clock: { now: () => "2026-05-10T12:00:00.000Z" },
      featureRepo: makeMockFeatureRepo({
        listBundleCandidates: async () => [poolVolumeRow]
      }),
      normalizedRepo: makeMockNormalizedRepo({
        listCandidates: async () => [],
        findByIds: async () => [normRow]
      }),
      rawRepo: makeMockRawRepo({
        findByIds: async () => [rawRow],
        findById: async () => rawRow
      }),
      contract: {
        validateCanonicalizeAndHash: async (candidate) => {
          capturedCandidate = candidate;
          return makeCanonicalBundle();
        }
      },
      bundleRepo: {
        insertOrClassify: async () => ({ outcome: "inserted", row: makeBundleRow() }),
        findById: async () => undefined,
        findByPair: async () => [],
        findLatestByPair: async () => undefined
      }
    };

    const result = await prepareAndFinalizePairWithoutBriefForTest(deps, makeDefaultRequest());
    expect("outcome" in result && result.outcome).toBe("persisted");

    const candidateObj = capturedCandidate as {
      deterministicFeatures: Array<{ featureId: string; status: string; value: number | null }>;
    };

    const selectedVolumeRatio = candidateObj.deterministicFeatures.find((f) =>
      f.featureId.includes("volume_liquidity_ratio_24h")
    );
    expect(selectedVolumeRatio).toBeDefined();
    expect(selectedVolumeRatio?.status).toBe("available");
    expect(selectedVolumeRatio?.value).toBe(1.5);
  });

  it("omits position-scoped kinds from pair quality warnings and deterministic output", async () => {
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

    const expectedPairKinds = MVP_FEATURE_KINDS.filter(
      (kind) => !["range_location", "distance_to_lower", "distance_to_upper"].includes(kind)
    );

    const featureRows: DerivedFeatureRow[] = expectedPairKinds.map((kind, idx) =>
      makeFeatureRow({
        id: 200 + idx,
        featureKind: kind,
        derivationKey: `kind=${kind}`,
        asOfUnixMs: 1000000,
        receivedAtUnixMs: 1000000,
        status: "AVAILABLE",
        value: 10 + idx,
        pair: "SOL/USDC",
        poolId: kind === "volume_liquidity_ratio_24h" ? "pool-1" : null,
        positionId: null,
        provenance: {
          ...DEFAULT_PROVENANCE,
          rawObservationRefs: [
            {
              refType: "normalized_observation",
              id: 15,
              source: "jupiter-price",
              payloadHash: "norm-hash-15"
            }
          ]
        }
      })
    );

    let capturedCandidate: unknown = null;

    const deps: AssemblePairEvidenceBundleDeps = {
      clock: { now: () => "2026-05-10T12:00:00.000Z" },
      featureRepo: makeMockFeatureRepo({
        listBundleCandidates: async () => featureRows
      }),
      normalizedRepo: makeMockNormalizedRepo({
        listCandidates: async () => [],
        findByIds: async () => [normRow]
      }),
      rawRepo: makeMockRawRepo({
        findByIds: async () => [rawRow],
        findById: async () => rawRow
      }),
      contract: {
        validateCanonicalizeAndHash: async (candidate) => {
          capturedCandidate = candidate;
          return makeCanonicalBundle();
        }
      },
      bundleRepo: {
        insertOrClassify: async () => ({ outcome: "inserted", row: makeBundleRow() }),
        findById: async () => undefined,
        findByPair: async () => [],
        findLatestByPair: async () => undefined
      }
    };

    const result = await prepareAndFinalizePairWithoutBriefForTest(deps, makeDefaultRequest());
    expect("outcome" in result && result.outcome).toBe("persisted");

    const candidateObj = capturedCandidate as {
      deterministicFeatures: Array<{ featureId: string; status: string; value: number | null }>;
      assessment: { warnings: Array<{ code: string; message: string }> };
    };

    const deterministicKinds = candidateObj.deterministicFeatures.map((f) =>
      f.featureId.replace(/^feat-/, "").replace(/-\d+$|-missing$/, "")
    );
    expect(deterministicKinds).toEqual(expectedPairKinds);

    const positionKinds = ["range_location", "distance_to_lower", "distance_to_upper"];
    for (const posKind of positionKinds) {
      expect(candidateObj.deterministicFeatures.some((f) => f.featureId.includes(posKind))).toBe(
        false
      );
      expect(
        candidateObj.deterministicFeatures.some((f) => f.featureId === `feat-${posKind}-missing`)
      ).toBe(false);
    }

    const missingSlotsWarnings = candidateObj.assessment.warnings.filter(
      (w) => w.code === "missing_slots"
    );
    expect(missingSlotsWarnings).toHaveLength(0);
  });

  it("persists a contract-valid pair bundle with usable derivative slots", async () => {
    const derivativeRaw = makeRawObservationRow({
      id: 101,
      source: "binance-fapi",
      payloadHash: "raw-hash-101"
    });
    const fundingFeature = makeFeatureRow({
      id: 201,
      featureKind: "funding_rate_annualized",
      derivationKey: "pair=SOL/USDC,kind=funding_rate_annualized",
      asOfUnixMs: 1000000,
      receivedAtUnixMs: 1000000,
      validUntilUnixMs: 2000000,
      status: "AVAILABLE",
      value: 150,
      unit: "BPS",
      pair: "SOL/USDC",
      poolId: null,
      positionId: null,
      evidenceFamily: "perp_liquidation",
      inputObservationIds: [101],
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          {
            refType: "raw_observation",
            id: 101,
            source: "binance-fapi",
            payloadHash: "raw-hash-101"
          }
        ]
      }
    });

    const productionContract = createEvidenceBundleContract();
    let validatedCandidate: EvidenceBundleV1 | null = null;
    let persistenceCalledTimes = 0;

    const deps: AssemblePairEvidenceBundleDeps = {
      clock: { now: () => "2026-05-10T12:00:00.000Z" },
      featureRepo: makeMockFeatureRepo({
        listBundleCandidates: async () => [fundingFeature]
      }),
      normalizedRepo: makeMockNormalizedRepo({
        listCandidates: async () => [],
        findByIds: async () => []
      }),
      rawRepo: makeMockRawRepo({
        findByIds: async () => [derivativeRaw],
        findById: async () => derivativeRaw
      }),
      contract: {
        validateCanonicalizeAndHash: async (candidate) => {
          validatedCandidate = candidate as EvidenceBundleV1;
          return productionContract.validateCanonicalizeAndHash(candidate);
        }
      },
      bundleRepo: {
        insertOrClassify: async () => {
          persistenceCalledTimes++;
          return { outcome: "inserted", row: makeBundleRow() };
        },
        findById: async () => undefined,
        findByPair: async () => [],
        findLatestByPair: async () => undefined
      }
    };

    const result = await prepareAndFinalizePairWithoutBriefForTest(
      deps,
      makeDefaultRequest({ gitCommit: "a".repeat(64) })
    );

    expect("outcome" in result && result.outcome).toBe("persisted");
    expect(persistenceCalledTimes).toBe(1);
    expect(validatedCandidate).not.toBeNull();
    const bundle = validatedCandidate as unknown as EvidenceBundleV1;
    expect(bundle.contextualEvidence.derivatives).toHaveLength(1);
    expect(bundle.contextualEvidence.derivatives[0]).toMatchObject({
      evidenceId: "derivative-funding_rate_annualized-201",
      kind: "funding",
      sourceReferenceIds: ["raw-101"]
    });
    expect(bundle.assessment.coverage.derivatives).toBe("partial");
    expect(bundle.assessment.warnings.map((warning) => warning.code)).not.toContain(
      "DERIVATIVES_UNAVAILABLE"
    );
  });

  it("persists a degraded pair bundle with deterministic features and no contextual claims", async () => {
    const { detRaw, detNorm, featureRow } = makeValidPairFeatureFixture();

    let capturedCandidate: unknown = null;
    let persistenceCalledTimes = 0;

    const deps: AssemblePairEvidenceBundleDeps = {
      clock: { now: () => "2026-05-10T12:00:00.000Z" },
      featureRepo: makeMockFeatureRepo({
        listBundleCandidates: async () => [featureRow]
      }),
      normalizedRepo: makeMockNormalizedRepo({
        listCandidates: async () => [],
        findByIds: async () => [detNorm]
      }),
      rawRepo: makeMockRawRepo({
        findByIds: async () => [detRaw],
        findById: async () => detRaw
      }),
      contract: {
        validateCanonicalizeAndHash: async (candidate) => {
          capturedCandidate = candidate;
          return makeCanonicalBundle();
        }
      },
      bundleRepo: {
        insertOrClassify: async () => {
          persistenceCalledTimes++;
          return { outcome: "inserted", row: makeBundleRow() };
        },
        findById: async () => undefined,
        findByPair: async () => [],
        findLatestByPair: async () => undefined
      }
    };

    const result = await prepareAndFinalizePairWithoutBriefForTest(deps, makeDefaultRequest());

    expect("outcome" in result && result.outcome).toBe("persisted");
    expect(persistenceCalledTimes).toBe(1);

    expect(capturedCandidate).toMatchObject({
      scope: { kind: "pair" },
      runId: "pipeline-1:pair",
      contextualEvidence: {
        events: [],
        flows: [],
        derivatives: [],
        supportResistance: [],
        newsRegulatory: []
      },
      assessment: {
        coverage: {
          derivatives: "unavailable"
        }
      }
    });

    const candidateObj = capturedCandidate as {
      deterministicFeatures: Array<{ featureId: string; status: string; value: number | null }>;
      assessment: { warnings: Array<{ message: string }> };
    };

    const selectedVol = candidateObj.deterministicFeatures.find((f) =>
      f.featureId.includes("realized_volatility_1h")
    );
    expect(selectedVol).toBeDefined();
    expect(selectedVol?.status).toBe("available");
    expect(selectedVol?.value).toBe(0.25);

    const warnings = candidateObj.assessment.warnings.map((w) => w.message);
    expect(warnings.some((w) => w.includes("evidence family is unavailable"))).toBe(true);
  });

  it("returns no_bundle without validating or writing when no deterministic evidence is usable", async () => {
    let contractCalled = false;
    let bundleRepoCalled = false;

    const rawRow = makeRawObservationRow({
      id: 1,
      source: "macro-calendar-api",
      payloadHash: "raw-hash-1"
    });
    const normRow = makeNormalizedRow({
      id: 10,
      rawObservationId: 1,
      source: "macro-calendar-api"
    });

    const deps: AssemblePairEvidenceBundleDeps = {
      clock: { now: () => "2026-05-10T12:00:00.000Z" },
      featureRepo: makeMockFeatureRepo({
        listBundleCandidates: async () => []
      }),
      normalizedRepo: makeMockNormalizedRepo({
        listCandidates: async () => [normRow],
        findByIds: async () => [normRow]
      }),
      rawRepo: makeMockRawRepo({
        findByIds: async () => [rawRow],
        findById: async () => rawRow
      }),
      contract: {
        validateCanonicalizeAndHash: async () => {
          contractCalled = true;
          return makeCanonicalBundle();
        }
      },
      bundleRepo: {
        insertOrClassify: async () => {
          bundleRepoCalled = true;
          return { outcome: "inserted", row: makeBundleRow() };
        },
        findById: async () => undefined,
        findByPair: async () => [],
        findLatestByPair: async () => undefined
      }
    };

    const result = await prepareAndFinalizePairWithoutBriefForTest(deps, makeDefaultRequest());

    expect("outcome" in result && result.outcome).toBe("no_bundle");
    expect(contractCalled).toBe(false);
    expect(bundleRepoCalled).toBe(false);
  });

  it("returns LINEAGE_ERROR without persistence when deterministic feature provenance is invalid", async () => {
    const invalidFeatureRow = makeFeatureRow({
      id: 100,
      featureKind: "realized_volatility_1h",
      derivationKey: "pair=SOL/USDC,kind=realized_volatility_1h",
      asOfUnixMs: 1000000,
      receivedAtUnixMs: 1000000,
      status: "AVAILABLE",
      value: 0.25,
      pair: "SOL/USDC",
      poolId: null,
      positionId: null,
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          {
            refType: "normalized_observation",
            id: 999,
            source: "jupiter-price",
            payloadHash: "missing-norm-hash"
          }
        ]
      }
    });

    let contractCalled = false;
    let bundleRepoCalled = false;

    const deps: AssemblePairEvidenceBundleDeps = {
      clock: { now: () => "2026-05-10T12:00:00.000Z" },
      featureRepo: makeMockFeatureRepo({
        listBundleCandidates: async () => [invalidFeatureRow]
      }),
      normalizedRepo: makeMockNormalizedRepo({
        listCandidates: async () => [],
        findByIds: async () => []
      }),
      rawRepo: makeMockRawRepo({
        findByIds: async () => [],
        findById: async () => undefined
      }),
      contract: {
        validateCanonicalizeAndHash: async () => {
          contractCalled = true;
          return makeCanonicalBundle();
        }
      },
      bundleRepo: {
        insertOrClassify: async () => {
          bundleRepoCalled = true;
          return { outcome: "inserted", row: makeBundleRow() };
        },
        findById: async () => undefined,
        findByPair: async () => [],
        findLatestByPair: async () => undefined
      }
    };

    const result = await prepareAndFinalizePairWithoutBriefForTest(deps, makeDefaultRequest());

    expect("code" in result && result.code).toBe("LINEAGE_ERROR");
    expect(contractCalled).toBe(false);
    expect(bundleRepoCalled).toBe(false);
  });

  it("returns identical_replay for the same pair run identity and canonical content", async () => {
    const { detRaw, detNorm, featureRow } = makeValidPairFeatureFixture();

    const deps: AssemblePairEvidenceBundleDeps = {
      clock: { now: () => "2026-05-10T12:00:00.000Z" },
      featureRepo: makeMockFeatureRepo({
        listBundleCandidates: async () => [featureRow]
      }),
      normalizedRepo: makeMockNormalizedRepo({
        listCandidates: async () => [],
        findByIds: async () => [detNorm]
      }),
      rawRepo: makeMockRawRepo({
        findByIds: async () => [detRaw],
        findById: async () => detRaw
      }),
      contract: {
        validateCanonicalizeAndHash: async () => makeCanonicalBundle()
      },
      bundleRepo: {
        insertOrClassify: async () => ({
          outcome: "identical_replay",
          row: makeBundleRow({ id: 200, payloadHash: "canonical-hash-1" })
        }),
        findById: async () => undefined,
        findByPair: async () => [],
        findLatestByPair: async () => undefined
      }
    };

    const result = await prepareAndFinalizePairWithoutBriefForTest(deps, makeDefaultRequest());

    expect("outcome" in result && result.outcome).toBe("identical_replay");
    if ("outcome" in result && result.outcome === "identical_replay") {
      expect(result.rowId).toBe(200);
      expect(result.payloadHash).toBe("canonical-hash-1");
    }
  });

  it("returns conflict for the same pair run identity with different canonical content", async () => {
    const { detRaw, detNorm, featureRow } = makeValidPairFeatureFixture();

    const deps: AssemblePairEvidenceBundleDeps = {
      clock: { now: () => "2026-05-10T12:00:00.000Z" },
      featureRepo: makeMockFeatureRepo({
        listBundleCandidates: async () => [featureRow]
      }),
      normalizedRepo: makeMockNormalizedRepo({
        listCandidates: async () => [],
        findByIds: async () => [detNorm]
      }),
      rawRepo: makeMockRawRepo({
        findByIds: async () => [detRaw],
        findById: async () => detRaw
      }),
      contract: {
        validateCanonicalizeAndHash: async () => makeCanonicalBundle()
      },
      bundleRepo: {
        insertOrClassify: async (): Promise<EvidenceBundleInsertOutcome> => ({
          outcome: "conflict",
          row: makeBundleRow({ id: 300, payloadHash: "existing-different-hash" }),
          incomingPayloadHash: "canonical-hash-1"
        }),
        findById: async () => undefined,
        findByPair: async () => [],
        findLatestByPair: async () => undefined
      }
    };

    const result = await prepareAndFinalizePairWithoutBriefForTest(deps, makeDefaultRequest());

    expect("outcome" in result && result.outcome).toBe("conflict");
    if ("outcome" in result && result.outcome === "conflict") {
      expect(result.rowId).toBe(300);
      expect(result.incomingPayloadHash).toBe("canonical-hash-1");
    }
  });

  it("converts contract and repository exceptions into typed errors without partial persistence", async () => {
    const { detRaw, detNorm, featureRow } = makeValidPairFeatureFixture();

    let bundleRepoCalled = false;

    // 1. Contract failure
    const contractErrorDeps: AssemblePairEvidenceBundleDeps = {
      clock: { now: () => "2026-05-10T12:00:00.000Z" },
      featureRepo: makeMockFeatureRepo({
        listBundleCandidates: async () => [featureRow]
      }),
      normalizedRepo: makeMockNormalizedRepo({
        listCandidates: async () => [],
        findByIds: async () => [detNorm]
      }),
      rawRepo: makeMockRawRepo({
        findByIds: async () => [detRaw],
        findById: async () => detRaw
      }),
      contract: {
        validateCanonicalizeAndHash: async () => {
          throw { code: "VALIDATION_ERROR", errors: ["Invalid schema"] };
        }
      },
      bundleRepo: {
        insertOrClassify: async () => {
          bundleRepoCalled = true;
          return { outcome: "inserted", row: makeBundleRow() };
        },
        findById: async () => undefined,
        findByPair: async () => [],
        findLatestByPair: async () => undefined
      }
    };

    const contractResult = await prepareAndFinalizePairWithoutBriefForTest(
      contractErrorDeps,
      makeDefaultRequest()
    );
    expect("code" in contractResult && contractResult.code).toBe("CONTRACT_ERROR");
    expect(bundleRepoCalled).toBe(false);

    // 2. Persistence failure
    const persistenceErrorDeps: AssemblePairEvidenceBundleDeps = {
      clock: { now: () => "2026-05-10T12:00:00.000Z" },
      featureRepo: makeMockFeatureRepo({
        listBundleCandidates: async () => [featureRow]
      }),
      normalizedRepo: makeMockNormalizedRepo({
        listCandidates: async () => [],
        findByIds: async () => [detNorm]
      }),
      rawRepo: makeMockRawRepo({
        findByIds: async () => [detRaw],
        findById: async () => detRaw
      }),
      contract: {
        validateCanonicalizeAndHash: async () => makeCanonicalBundle()
      },
      bundleRepo: {
        insertOrClassify: async () => {
          throw new Error("DB connection lost");
        },
        findById: async () => undefined,
        findByPair: async () => [],
        findLatestByPair: async () => undefined
      }
    };

    const persistenceResult = await prepareAndFinalizePairWithoutBriefForTest(
      persistenceErrorDeps,
      makeDefaultRequest()
    );
    expect("code" in persistenceResult && persistenceResult.code).toBe("PERSISTENCE_ERROR");
  });

  describe("prepare and replay", () => {
    it("pair prepare does not persist and finalize persists exactly once", async () => {
      const { detRaw, detNorm, featureRow } = makeValidPairFeatureFixture();

      let persistenceCalledTimes = 0;

      const deps: AssemblePairEvidenceBundleDeps = {
        clock: { now: () => "2026-05-10T12:00:00.000Z" },
        featureRepo: makeMockFeatureRepo({
          listBundleCandidates: async () => [featureRow]
        }),
        normalizedRepo: makeMockNormalizedRepo({
          listCandidates: async () => [],
          findByIds: async () => [detNorm]
        }),
        rawRepo: makeMockRawRepo({
          findByIds: async () => [detRaw],
          findById: async () => detRaw
        }),
        contract: {
          validateCanonicalizeAndHash: async () => makeCanonicalBundle()
        },
        bundleRepo: {
          insertOrClassify: async () => {
            persistenceCalledTimes++;
            return { outcome: "inserted", row: makeBundleRow() };
          },
          findById: async () => undefined,
          findByPair: async () => [],
          findLatestByPair: async () => undefined
        }
      };

      const prepareResult = await preparePairEvidenceBundle(deps, makeDefaultRequest());
      expect("outcome" in prepareResult && prepareResult.outcome).toBe("prepared");
      expect(persistenceCalledTimes).toBe(0);

      if ("outcome" in prepareResult && prepareResult.outcome === "prepared") {
        const finalizeResult = await finalizePairEvidenceBundle(deps, prepareResult.prepared);
        expect("outcome" in finalizeResult && finalizeResult.outcome).toBe("persisted");
        expect(persistenceCalledTimes).toBe(1);
      }
    });

    it("pair exact replay returns the existing brief-bearing row before generation", async () => {
      const { detRaw, detNorm, featureRow } = makeValidPairFeatureFixture();

      const existingRowWithBrief = makeBundleRow({
        id: 500,
        payloadHash: "canonical-hash-1",
        idempotencyKey: "canonical-idemp-1",
        payload: {
          researchBrief: { briefId: "brief-existing" },
          assessment: { warnings: [{ message: "Existing warning" }] }
        }
      });

      const deps: AssemblePairEvidenceBundleDeps = {
        clock: { now: () => "2026-05-10T12:00:00.000Z" },
        featureRepo: makeMockFeatureRepo({
          listBundleCandidates: async () => [featureRow]
        }),
        normalizedRepo: makeMockNormalizedRepo({
          listCandidates: async () => [],
          findByIds: async () => [detNorm]
        }),
        rawRepo: makeMockRawRepo({
          findByIds: async () => [detRaw],
          findById: async () => detRaw
        }),
        contract: {
          validateCanonicalizeAndHash: async () => makeCanonicalBundle()
        },
        bundleRepo: {
          insertOrClassify: async () => ({ outcome: "inserted", row: makeBundleRow() }),
          findById: async () => undefined,
          findByPair: async () => [existingRowWithBrief],
          findLatestByPair: async () => undefined
        }
      };

      const prepareResult = await preparePairEvidenceBundle(deps, makeDefaultRequest());
      expect("outcome" in prepareResult && prepareResult.outcome).toBe("identical_replay");
      if ("outcome" in prepareResult && prepareResult.outcome === "identical_replay") {
        expect(prepareResult.rowId).toBe(500);
        expect(prepareResult.payloadHash).toBe("canonical-hash-1");
      }
    });

    it("pair legacy replay without an embedded brief is not accepted as complete", async () => {
      const { detRaw, detNorm, featureRow } = makeValidPairFeatureFixture();

      const legacyRowNoBrief = makeBundleRow({
        id: 600,
        payloadHash: "canonical-hash-1",
        idempotencyKey: "canonical-idemp-1",
        payload: {
          researchBrief: null,
          assessment: { warnings: [] }
        }
      });

      const deps: AssemblePairEvidenceBundleDeps = {
        clock: { now: () => "2026-05-10T12:00:00.000Z" },
        featureRepo: makeMockFeatureRepo({
          listBundleCandidates: async () => [featureRow]
        }),
        normalizedRepo: makeMockNormalizedRepo({
          listCandidates: async () => [],
          findByIds: async () => [detNorm]
        }),
        rawRepo: makeMockRawRepo({
          findByIds: async () => [detRaw],
          findById: async () => detRaw
        }),
        contract: {
          validateCanonicalizeAndHash: async () => makeCanonicalBundle()
        },
        bundleRepo: {
          insertOrClassify: async () => ({ outcome: "inserted", row: makeBundleRow() }),
          findById: async () => undefined,
          findByPair: async () => [legacyRowNoBrief],
          findLatestByPair: async () => undefined
        }
      };

      const prepareResult = await preparePairEvidenceBundle(deps, makeDefaultRequest());
      expect("outcome" in prepareResult && prepareResult.outcome).toBe("conflict");
      if ("outcome" in prepareResult && prepareResult.outcome === "conflict") {
        expect(prepareResult.rowId).toBe(600);
        expect(prepareResult.incomingPayloadHash).toBe("canonical-hash-1");
      }
    });
  });

  describe("finalization and persistence", () => {
    it("pair finalization derives research brief coverage from actual attachment", async () => {
      const { detRaw, detNorm, featureRow } = makeValidPairFeatureFixture();

      let capturedInserts: EvidenceBundleInsert[] = [];

      const deps: AssemblePairEvidenceBundleDeps = {
        clock: { now: () => "2026-05-10T12:00:00.000Z" },
        featureRepo: makeMockFeatureRepo({
          listBundleCandidates: async () => [featureRow]
        }),
        normalizedRepo: makeMockNormalizedRepo({
          listCandidates: async () => [],
          findByIds: async () => [detNorm]
        }),
        rawRepo: makeMockRawRepo({
          findByIds: async () => [detRaw],
          findById: async () => detRaw
        }),
        contract: createEvidenceBundleContract(),
        bundleRepo: {
          insertOrClassify: async (insert) => {
            capturedInserts.push(insert);
            return { outcome: "inserted", row: makeBundleRow() };
          },
          findById: async () => undefined,
          findByPair: async () => [],
          findLatestByPair: async () => undefined
        }
      };

      const prepareResult = await preparePairEvidenceBundle(
        deps,
        makeDefaultRequest({ gitCommit: "a".repeat(64) })
      );
      expect("outcome" in prepareResult && prepareResult.outcome).toBe("prepared");

      if ("outcome" in prepareResult && prepareResult.outcome === "prepared") {
        // 1. Finalize without brief
        await finalizePairEvidenceBundle(deps, prepareResult.prepared);
        expect(capturedInserts).toHaveLength(1);
        const noBriefPayload = capturedInserts[0]!.payload as EvidenceBundleV1;
        expect(noBriefPayload.assessment.coverage.researchBrief).toBe("unavailable");
        expect(noBriefPayload.researchBrief).toBeNull();

        // 2. Finalize with brief
        capturedInserts = [];
        const brief = makeMockBrief();
        await finalizePairEvidenceBundle(deps, prepareResult.prepared, brief);
        expect(capturedInserts).toHaveLength(1);
        const withBriefPayload = capturedInserts[0]!.payload as EvidenceBundleV1;
        expect(withBriefPayload.assessment.coverage.researchBrief).not.toBe("unavailable");
        expect(withBriefPayload.researchBrief).not.toBeNull();
        expect(withBriefPayload.researchBrief?.briefId).toBe("brief-1");
      }
    });
  });
});
