import { describe, it, expect } from "vitest";
import type {
  FeatureKind,
  SignalClass,
  EvidenceFamily,
  Confidence,
  Provenance,
  ProvenanceRef,
  ObservationKind,
  Source
} from "../../../src/contracts/taxonomy.js";
import type { NormalizedObservationRow } from "../../../src/ports/index.js";
import type { RawObservationRow } from "../../../src/ports/observation-repo.js";
import { verifyEvidenceLineage } from "../../../src/domain/evidence-bundle/lineage.js";

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
    source: (overrides.source ?? "clmm-v2-bundle") as RawObservationRow["source"],
    sourceObservationKey: overrides.sourceObservationKey ?? `key-${overrides.id}`,
    observedAtUnixMs: overrides.observedAtUnixMs ?? 1000000,
    fetchedAtUnixMs: overrides.fetchedAtUnixMs ?? 1000000,
    payloadHash: overrides.payloadHash ?? `raw-hash-${overrides.id}`,
    payloadCanonical: overrides.payloadCanonical ?? JSON.stringify({ pair: "SOL/USDC" }),
    parseStatus: overrides.parseStatus ?? "parsed",
    sourceRequestMeta: overrides.sourceRequestMeta ?? null,
    receivedAtUnixMs: overrides.receivedAtUnixMs ?? 1000000
  };
}

function makeNormalizedRow(
  overrides: Partial<NormalizedObservationRow> & { id: number; rawObservationId: number }
): NormalizedObservationRow {
  return {
    id: overrides.id,
    rawObservationId: overrides.rawObservationId,
    source: (overrides.source ?? "clmm-v2-bundle") as NormalizedObservationRow["source"],
    observationKind: (overrides.observationKind ??
      "pool_state") as NormalizedObservationRow["observationKind"],
    signalClass: (overrides.signalClass ?? "deterministic") as SignalClass,
    evidenceFamily: (overrides.evidenceFamily ?? "clmm_state") as EvidenceFamily,
    payload: overrides.payload ?? { pair: "SOL/USDC" },
    payloadHash: overrides.payloadHash ?? `norm-hash-${overrides.id}`,
    confidence: overrides.confidence ?? DEFAULT_CONFIDENCE,
    confidenceComposite: overrides.confidenceComposite ?? null,
    confidenceLevel: overrides.confidenceLevel ?? null,
    validUntilUnixMs: overrides.validUntilUnixMs ?? null,
    isStale: overrides.isStale ?? false,
    staleBehavior: overrides.staleBehavior ?? null,
    provenance: overrides.provenance ?? DEFAULT_PROVENANCE,
    receivedAtUnixMs: overrides.receivedAtUnixMs ?? 1000000
  };
}

function makeClmmBundlePayload(walletId: string, positionId: string, poolId: string) {
  return {
    pair: "SOL/USDC" as const,
    source: "orca" as const,
    observedAtUnixMs: 1000000,
    pool: {
      poolId,
      pair: "SOL/USDC" as const,
      source: "orca" as const,
      observedAtUnixMs: 1000000,
      tokenPairLabel: "SOL/USDC",
      currentPrice: 100,
      currentPriceLabel: "100",
      sqrtPrice: "10",
      tickCurrentIndex: 0,
      tickSpacing: 64,
      feeRate: 0.0003,
      feeRateLabel: "0.03%",
      poolLiquidity: "1000000",
      priceSource: "orca_whirlpool_sqrt_price" as const
    },
    srLevels: null,
    positions: [
      {
        walletId,
        positionId,
        poolId,
        pair: "SOL/USDC" as const,
        source: "orca" as const,
        observedAtUnixMs: 1000000,
        rangeState: "in-range" as const,
        lowerTick: -1000,
        upperTick: 1000,
        currentTick: 0,
        lowerPriceLabel: "99",
        upperPriceLabel: "101",
        currentPrice: 100,
        currentPriceLabel: "100",
        rangeDistance: {
          belowLowerTickPercent: 1,
          aboveUpperTickPercent: 1
        },
        feeRateLabel: "0.03%",
        unclaimedFees: {
          feeOwedA: { raw: "0", decimals: null, symbol: "SOL", mint: "sol" },
          feeOwedB: { raw: "0", decimals: null, symbol: "USDC", mint: "usdc" }
        },
        unclaimedRewards: [],
        unclaimedFeesUsd: null,
        unclaimedRewardsUsd: null,
        positionLiquidity: "1000",
        poolLiquidity: "1000000",
        hasActionableTrigger: false
      }
    ],
    alerts: [],
    dataQuality: {
      warnings: [],
      partial: false
    }
  };
}

function makeProvenanceRef(
  refType: ProvenanceRef["refType"],
  id: number,
  source: string,
  payloadHash: string
): ProvenanceRef {
  return { refType, id, source: source as ProvenanceRef["source"], payloadHash };
}

function makeBaseInput() {
  const poolId = "pool-abc";
  const positionId = "position-1";
  const walletId = "wallet-xyz";

  const clmmCanonical = JSON.stringify(makeClmmBundlePayload(walletId, positionId, poolId));
  const rawObs = makeRawObservationRow({
    id: 1,
    source: "clmm-v2-bundle",
    payloadCanonical: clmmCanonical
  });
  const normObs = makeNormalizedRow({
    id: 10,
    rawObservationId: 1,
    source: "clmm-v2-bundle",
    observationKind: "pool_state",
    provenance: {
      ...DEFAULT_PROVENANCE,
      rawObservationRefs: [
        makeProvenanceRef("raw_observation", 1, "clmm-v2-bundle", rawObs.payloadHash)
      ]
    }
  });

  return { poolId, positionId, walletId, clmmCanonical, rawObs, normObs };
}

describe("contextual lineage verification exhaustive allowed set and API classification", () => {
  const testCases: Array<{
    source: Source;
    observationKind: ObservationKind;
    expectedSourceType: "api" | "chain" | "database" | "document" | "internal_bundle";
  }> = [
    {
      source: "macro-calendar-api",
      observationKind: "scheduled_event",
      expectedSourceType: "api"
    },
    {
      source: "solana-status-api",
      observationKind: "protocol_incident",
      expectedSourceType: "api"
    },
    {
      source: "helius-api",
      observationKind: "whale_swap",
      expectedSourceType: "api"
    },
    {
      source: "birdeye-api",
      observationKind: "whale_swap",
      expectedSourceType: "api"
    },
    {
      source: "helius-api",
      observationKind: "stablecoin_flow",
      expectedSourceType: "api"
    },
    {
      source: "helius-api",
      observationKind: "cex_flow_proxy",
      expectedSourceType: "api"
    },
    {
      source: "birdeye-api",
      observationKind: "dex_net_flow",
      expectedSourceType: "api"
    },
    {
      source: "technical-analysis-api",
      observationKind: "support_resistance_level",
      expectedSourceType: "api"
    },
    {
      source: "crypto-news-api",
      observationKind: "ecosystem_news",
      expectedSourceType: "api"
    },
    {
      source: "regulatory-monitor-api",
      observationKind: "regulatory_risk",
      expectedSourceType: "api"
    }
  ];

  it.each(testCases)(
    "verifies $observationKind from $source resolves with source type $expectedSourceType",
    ({ source, observationKind, expectedSourceType }) => {
      const base = makeBaseInput();

      const rawObs = makeRawObservationRow({
        id: 200,
        source,
        sourceObservationKey: `key-${source}-200`,
        payloadHash: `hash-${source}-200`
      });

      const normObs = makeNormalizedRow({
        id: 300,
        rawObservationId: 200,
        source,
        observationKind,
        signalClass: "contextual",
        evidenceFamily: "support_resistance",
        provenance: {
          ...DEFAULT_PROVENANCE,
          rawObservationRefs: [
            makeProvenanceRef("raw_observation", 200, source, rawObs.payloadHash)
          ]
        }
      });

      const rawObservations = new Map<number, RawObservationRow>([
        [base.rawObs.id, base.rawObs],
        [rawObs.id, rawObs]
      ]);
      const normalizedObservations = new Map<number, NormalizedObservationRow>([
        [base.normObs.id, base.normObs]
      ]);

      const result = verifyEvidenceLineage({
        request: {
          evaluationTimeUnixMs: 5000000000,
          selectionVersion: "1.0",
          calculatorVersions: { range_location: "1.0" } as Record<FeatureKind, string>,
          candidates: [],
          poolId: base.poolId,
          positionId: base.positionId
        },
        slots: [
          {
            featureKind: "range_location",
            outcome: "selected_available",
            rowId: base.normObs.id,
            provenance: base.normObs.provenance,
            reasons: []
          }
        ],
        rawObservations,
        normalizedObservations,
        derivedFeatures: new Map(),
        clmmCanonical: base.clmmCanonical,
        walletId: base.walletId,
        positionId: base.positionId,
        poolId: base.poolId,
        contextualObservations: [normObs]
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.lineage.rawObservationIds).toContain(200);
        expect(result.lineage.normalizedObservationIds).toContain(300);
        const sourceRef = result.lineage.sourceReferences.find(
          (s) => s.referenceId === `raw-${rawObs.id}`
        );
        expect(sourceRef).toBeDefined();
        expect(sourceRef?.sourceType).toBe(expectedSourceType);
      }
    }
  );

  it("classifies technical analysis crypto news and regulatory source references as api", () => {
    const base = makeBaseInput();

    const taRaw = makeRawObservationRow({
      id: 501,
      source: "technical-analysis-api",
      sourceObservationKey: "ta-501",
      payloadHash: "hash-ta-501"
    });
    const newsRaw = makeRawObservationRow({
      id: 502,
      source: "crypto-news-api",
      sourceObservationKey: "news-502",
      payloadHash: "hash-news-502"
    });
    const regRaw = makeRawObservationRow({
      id: 503,
      source: "regulatory-monitor-api",
      sourceObservationKey: "reg-503",
      payloadHash: "hash-reg-503"
    });

    const taNorm = makeNormalizedRow({
      id: 601,
      rawObservationId: 501,
      source: "technical-analysis-api",
      observationKind: "support_resistance_level",
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          makeProvenanceRef("raw_observation", 501, "technical-analysis-api", taRaw.payloadHash)
        ]
      }
    });

    const newsNorm = makeNormalizedRow({
      id: 602,
      rawObservationId: 502,
      source: "crypto-news-api",
      observationKind: "ecosystem_news",
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          makeProvenanceRef("raw_observation", 502, "crypto-news-api", newsRaw.payloadHash)
        ]
      }
    });

    const regNorm = makeNormalizedRow({
      id: 603,
      rawObservationId: 503,
      source: "regulatory-monitor-api",
      observationKind: "regulatory_risk",
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          makeProvenanceRef("raw_observation", 503, "regulatory-monitor-api", regRaw.payloadHash)
        ]
      }
    });

    const rawObservations = new Map<number, RawObservationRow>([
      [base.rawObs.id, base.rawObs],
      [501, taRaw],
      [502, newsRaw],
      [503, regRaw]
    ]);
    const normalizedObservations = new Map<number, NormalizedObservationRow>([
      [base.normObs.id, base.normObs]
    ]);

    const result = verifyEvidenceLineage({
      request: {
        evaluationTimeUnixMs: 5000000000,
        selectionVersion: "1.0",
        calculatorVersions: { range_location: "1.0" } as Record<FeatureKind, string>,
        candidates: [],
        poolId: base.poolId,
        positionId: base.positionId
      },
      slots: [
        {
          featureKind: "range_location",
          outcome: "selected_available",
          rowId: base.normObs.id,
          provenance: base.normObs.provenance,
          reasons: []
        }
      ],
      rawObservations,
      normalizedObservations,
      derivedFeatures: new Map(),
      clmmCanonical: base.clmmCanonical,
      walletId: base.walletId,
      positionId: base.positionId,
      poolId: base.poolId,
      contextualObservations: [taNorm, newsNorm, regNorm]
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const refMap = new Map(
        result.lineage.sourceReferences.map((s) => [s.referenceId, s.sourceType])
      );
      expect(refMap.get("raw-501")).toBe("api");
      expect(refMap.get("raw-502")).toBe("api");
      expect(refMap.get("raw-503")).toBe("api");
    }
  });

  it("sorts raw and normalized IDs and deduplicates source references", () => {
    const base = makeBaseInput();

    const raw20 = makeRawObservationRow({
      id: 20,
      source: "technical-analysis-api",
      payloadHash: "hash-20"
    });
    const raw10 = makeRawObservationRow({
      id: 10,
      source: "crypto-news-api",
      payloadHash: "hash-10"
    });

    const norm50 = makeNormalizedRow({
      id: 50,
      rawObservationId: 20,
      source: "technical-analysis-api",
      observationKind: "support_resistance_level",
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          makeProvenanceRef("raw_observation", 20, "technical-analysis-api", "hash-20")
        ]
      }
    });

    const norm30 = makeNormalizedRow({
      id: 30,
      rawObservationId: 10,
      source: "crypto-news-api",
      observationKind: "ecosystem_news",
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [makeProvenanceRef("raw_observation", 10, "crypto-news-api", "hash-10")]
      }
    });

    const norm30Dup = makeNormalizedRow({
      id: 30,
      rawObservationId: 10,
      source: "crypto-news-api",
      observationKind: "ecosystem_news",
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [makeProvenanceRef("raw_observation", 10, "crypto-news-api", "hash-10")]
      }
    });

    const rawObservations = new Map<number, RawObservationRow>([
      [base.rawObs.id, base.rawObs],
      [20, raw20],
      [10, raw10]
    ]);
    const normalizedObservations = new Map<number, NormalizedObservationRow>([
      [base.normObs.id, base.normObs]
    ]);

    const result = verifyEvidenceLineage({
      request: {
        evaluationTimeUnixMs: 5000000000,
        selectionVersion: "1.0",
        calculatorVersions: { range_location: "1.0" } as Record<FeatureKind, string>,
        candidates: [],
        poolId: base.poolId,
        positionId: base.positionId
      },
      slots: [
        {
          featureKind: "range_location",
          outcome: "selected_available",
          rowId: base.normObs.id,
          provenance: base.normObs.provenance,
          reasons: []
        }
      ],
      rawObservations,
      normalizedObservations,
      derivedFeatures: new Map(),
      clmmCanonical: base.clmmCanonical,
      walletId: base.walletId,
      positionId: base.positionId,
      poolId: base.poolId,
      contextualObservations: [norm50, norm30, norm30Dup]
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lineage.rawObservationIds).toEqual(
        [...result.lineage.rawObservationIds].sort((a, b) => a - b)
      );
      expect(result.lineage.normalizedObservationIds).toEqual(
        [...result.lineage.normalizedObservationIds].sort((a, b) => a - b)
      );

      const refIds = result.lineage.sourceReferences.map((s) => s.referenceId);
      const uniqueRefIds = new Set(refIds);
      expect(refIds.length).toBe(uniqueRefIds.size);
    }
  });

  it("excludes contextual observation when selected contextual raw parent is missing", () => {
    const base = makeBaseInput();

    const normObs = makeNormalizedRow({
      id: 300,
      rawObservationId: 999,
      source: "technical-analysis-api",
      observationKind: "support_resistance_level",
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          makeProvenanceRef("raw_observation", 999, "technical-analysis-api", "hash-999")
        ]
      }
    });

    const rawObservations = new Map<number, RawObservationRow>([[base.rawObs.id, base.rawObs]]);
    const normalizedObservations = new Map<number, NormalizedObservationRow>([
      [base.normObs.id, base.normObs]
    ]);

    const result = verifyEvidenceLineage({
      request: {
        evaluationTimeUnixMs: 5000000000,
        selectionVersion: "1.0",
        calculatorVersions: { range_location: "1.0" } as Record<FeatureKind, string>,
        candidates: [],
        poolId: base.poolId,
        positionId: base.positionId
      },
      slots: [
        {
          featureKind: "range_location",
          outcome: "selected_available",
          rowId: base.normObs.id,
          provenance: base.normObs.provenance,
          reasons: []
        }
      ],
      rawObservations,
      normalizedObservations,
      derivedFeatures: new Map(),
      clmmCanonical: base.clmmCanonical,
      walletId: base.walletId,
      positionId: base.positionId,
      poolId: base.poolId,
      contextualObservations: [normObs]
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.validContextualObservations).toHaveLength(0);
      expect(result.excludedContextualObservations).toHaveLength(1);
      expect(result.excludedContextualObservations[0]?.error.code).toBe("MISSING_RAW_PARENT");
    }
  });

  it("excludes contextual observation when selected contextual source or hash provenance mismatches", () => {
    const base = makeBaseInput();

    const rawObs = makeRawObservationRow({
      id: 200,
      source: "technical-analysis-api",
      payloadHash: "real-hash-200"
    });

    const normObsHashMismatch = makeNormalizedRow({
      id: 300,
      rawObservationId: 200,
      source: "technical-analysis-api",
      observationKind: "support_resistance_level",
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          makeProvenanceRef("raw_observation", 200, "technical-analysis-api", "wrong-hash")
        ]
      }
    });

    const rawObservations = new Map<number, RawObservationRow>([
      [base.rawObs.id, base.rawObs],
      [200, rawObs]
    ]);
    const normalizedObservations = new Map<number, NormalizedObservationRow>([
      [base.normObs.id, base.normObs]
    ]);

    const result = verifyEvidenceLineage({
      request: {
        evaluationTimeUnixMs: 5000000000,
        selectionVersion: "1.0",
        calculatorVersions: { range_location: "1.0" } as Record<FeatureKind, string>,
        candidates: [],
        poolId: base.poolId,
        positionId: base.positionId
      },
      slots: [
        {
          featureKind: "range_location",
          outcome: "selected_available",
          rowId: base.normObs.id,
          provenance: base.normObs.provenance,
          reasons: []
        }
      ],
      rawObservations,
      normalizedObservations,
      derivedFeatures: new Map(),
      clmmCanonical: base.clmmCanonical,
      walletId: base.walletId,
      positionId: base.positionId,
      poolId: base.poolId,
      contextualObservations: [normObsHashMismatch]
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.validContextualObservations).toHaveLength(0);
      expect(result.excludedContextualObservations).toHaveLength(1);
      expect(result.excludedContextualObservations[0]?.error.code).toBe("PROVENANCE_HASH_MISMATCH");
    }
  });
});
