import { describe, it, expect } from "vitest";
import type {
  FeatureKind,
  SignalClass,
  EvidenceFamily,
  Confidence,
  Provenance,
  ProvenanceRef
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
      isPartial: false,
      missingSources: []
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

  return {
    poolId,
    positionId,
    walletId,
    clmmCanonical,
    rawObs,
    normObs
  };
}

describe("contextual event lineage verification", () => {
  describe("bundle event lineage resolves to retained raw source", () => {
    it("verifies scheduled_event contextual observation resolves to retained raw parent", () => {
      const base = makeBaseInput();

      const contextualRawObs = makeRawObservationRow({
        id: 200,
        source: "macro-calendar-api",
        sourceObservationKey: "macro-cal-key-200",
        payloadHash: "contextual-raw-hash-200",
        observedAtUnixMs: 2000000
      });

      const contextualNormObs = makeNormalizedRow({
        id: 300,
        rawObservationId: 200,
        source: "macro-calendar-api",
        observationKind: "scheduled_event",
        signalClass: "contextual",
        evidenceFamily: "macro_protocol_risk",
        payload: {
          sourceEventId: "event-123",
          eventFamily: "macro_protocol_risk",
          eventType: "scheduled_event",
          title: "FOMC Meeting",
          description: "Federal Reserve meeting",
          asOfUnixMs: 2000000,
          expiresAtUnixMs: 3000000,
          scheduledStartUnixMs: 2000000,
          scheduledEndUnixMs: null,
          severity: "HIGH",
          status: "SCHEDULED",
          affectedScope: ["SOL", "USDC"],
          sourceReferences: [],
          sourceQuality: {
            providerId: "macro-cal",
            reliability: 0.9,
            completeness: "complete",
            confirmation: "official"
          },
          rawProvenance: {
            sourceObservedAtUnixMs: 2000000,
            retrievedAtUnixMs: 2000000,
            retentionMode: "bounded_factual_extract",
            license: "MIT"
          },
          warnings: []
        } as unknown as NormalizedObservationRow["payload"],
        provenance: {
          ...DEFAULT_PROVENANCE,
          rawObservationRefs: [
            makeProvenanceRef(
              "raw_observation",
              200,
              "macro-calendar-api",
              contextualRawObs.payloadHash
            )
          ]
        }
      });

      const rawObservations = new Map<number, RawObservationRow>([
        [base.rawObs.id, base.rawObs],
        [contextualRawObs.id, contextualRawObs]
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
        contextualObservations: [contextualNormObs]
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.lineage.rawObservationIds).toContain(200);
        expect(result.lineage.normalizedObservationIds).toContain(300);
        const sourceRef = result.lineage.sourceReferences.find(
          (s) => s.referenceId === `raw-${contextualRawObs.id}`
        );
        expect(sourceRef).toBeDefined();
        expect(sourceRef?.sourceType).toBe("api");
        expect(sourceRef?.locator).toBe("macro-cal-key-200");
      }
    });

    it("verifies protocol_incident contextual observation resolves to retained raw parent", () => {
      const base = makeBaseInput();

      const contextualRawObs = makeRawObservationRow({
        id: 201,
        source: "solana-status-api",
        sourceObservationKey: "solana-status-key-201",
        payloadHash: "contextual-raw-hash-201",
        observedAtUnixMs: 2000000
      });

      const contextualNormObs = makeNormalizedRow({
        id: 301,
        rawObservationId: 201,
        source: "solana-status-api",
        observationKind: "protocol_incident",
        signalClass: "contextual",
        evidenceFamily: "macro_protocol_risk",
        payload: {
          sourceEventId: "incident-456",
          eventFamily: "macro_protocol_risk",
          eventType: "protocol_incident",
          title: "Solana Network Issue",
          description: "Network congestion detected",
          asOfUnixMs: 2000000,
          expiresAtUnixMs: 3000000,
          detectedAtUnixMs: 1900000,
          resolvedAtUnixMs: null,
          severity: "CRITICAL",
          status: "ACTIVE",
          affectedScope: ["SOL"],
          sourceReferences: [],
          sourceQuality: {
            providerId: "solana-status",
            reliability: 0.95,
            completeness: "complete",
            confirmation: "official"
          },
          rawProvenance: {
            sourceObservedAtUnixMs: 2000000,
            retrievedAtUnixMs: 2000000,
            retentionMode: "bounded_factual_extract",
            license: "MIT"
          },
          warnings: []
        } as unknown as NormalizedObservationRow["payload"],
        provenance: {
          ...DEFAULT_PROVENANCE,
          rawObservationRefs: [
            makeProvenanceRef(
              "raw_observation",
              201,
              "solana-status-api",
              contextualRawObs.payloadHash
            )
          ]
        }
      });

      const rawObservations = new Map<number, RawObservationRow>([
        [base.rawObs.id, base.rawObs],
        [contextualRawObs.id, contextualRawObs]
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
        contextualObservations: [contextualNormObs]
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.lineage.rawObservationIds).toContain(201);
        expect(result.lineage.normalizedObservationIds).toContain(301);
        const sourceRef = result.lineage.sourceReferences.find(
          (s) => s.referenceId === `raw-${contextualRawObs.id}`
        );
        expect(sourceRef).toBeDefined();
        expect(sourceRef?.sourceType).toBe("api");
        expect(sourceRef?.locator).toBe("solana-status-key-201");
      }
    });
  });

  describe("rejects contextual observation with missing raw parent", () => {
    it("returns error when contextual normalized observation has no matching raw parent", () => {
      const base = makeBaseInput();

      const contextualNormObs = makeNormalizedRow({
        id: 300,
        rawObservationId: 999,
        source: "macro-calendar-api",
        observationKind: "scheduled_event",
        signalClass: "contextual",
        evidenceFamily: "macro_protocol_risk",
        payload: {
          sourceEventId: "event-123",
          eventFamily: "macro_protocol_risk",
          eventType: "scheduled_event",
          title: "FOMC Meeting",
          description: "Federal Reserve meeting",
          asOfUnixMs: 2000000,
          expiresAtUnixMs: 3000000,
          scheduledStartUnixMs: 2000000,
          scheduledEndUnixMs: null,
          severity: "HIGH",
          status: "SCHEDULED",
          affectedScope: ["SOL", "USDC"],
          sourceReferences: [],
          sourceQuality: {
            providerId: "macro-cal",
            reliability: 0.9,
            completeness: "complete",
            confirmation: "official"
          },
          rawProvenance: {
            sourceObservedAtUnixMs: 2000000,
            retrievedAtUnixMs: 2000000,
            retentionMode: "bounded_factual_extract",
            license: "MIT"
          },
          warnings: []
        } as unknown as NormalizedObservationRow["payload"],
        provenance: {
          ...DEFAULT_PROVENANCE,
          rawObservationRefs: [
            makeProvenanceRef("raw_observation", 999, "macro-calendar-api", "some-hash")
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
        contextualObservations: [contextualNormObs]
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("MISSING_RAW_PARENT");
      }
    });
  });

  describe("rejects contextual observation with source mismatch", () => {
    it("returns error when contextual normalized observation source does not match raw parent source", () => {
      const base = makeBaseInput();

      const contextualRawObs = makeRawObservationRow({
        id: 200,
        source: "macro-calendar-api",
        sourceObservationKey: "macro-cal-key-200",
        payloadHash: "contextual-raw-hash-200"
      });

      const contextualNormObs = makeNormalizedRow({
        id: 300,
        rawObservationId: 200,
        source: "different-source",
        observationKind: "scheduled_event",
        signalClass: "contextual",
        evidenceFamily: "macro_protocol_risk",
        payload: {
          sourceEventId: "event-123",
          eventFamily: "macro_protocol_risk",
          eventType: "scheduled_event",
          title: "FOMC Meeting",
          description: "Federal Reserve meeting",
          asOfUnixMs: 2000000,
          expiresAtUnixMs: 3000000,
          scheduledStartUnixMs: 2000000,
          scheduledEndUnixMs: null,
          severity: "HIGH",
          status: "SCHEDULED",
          affectedScope: ["SOL", "USDC"],
          sourceReferences: [],
          sourceQuality: {
            providerId: "macro-cal",
            reliability: 0.9,
            completeness: "complete",
            confirmation: "official"
          },
          rawProvenance: {
            sourceObservedAtUnixMs: 2000000,
            retrievedAtUnixMs: 2000000,
            retentionMode: "bounded_factual_extract",
            license: "MIT"
          },
          warnings: []
        } as unknown as NormalizedObservationRow["payload"],
        provenance: {
          ...DEFAULT_PROVENANCE,
          rawObservationRefs: [
            makeProvenanceRef(
              "raw_observation",
              200,
              "macro-calendar-api",
              contextualRawObs.payloadHash
            )
          ]
        }
      });

      const rawObservations = new Map<number, RawObservationRow>([
        [base.rawObs.id, base.rawObs],
        [contextualRawObs.id, contextualRawObs]
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
        contextualObservations: [contextualNormObs]
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PROVENANCE_SOURCE_MISMATCH");
      }
    });
  });

  describe("rejects contextual observation with payload hash mismatch", () => {
    it("returns error when contextual normalized observation payload hash does not match raw parent hash", () => {
      const base = makeBaseInput();

      const contextualRawObs = makeRawObservationRow({
        id: 200,
        source: "macro-calendar-api",
        sourceObservationKey: "macro-cal-key-200",
        payloadHash: "contextual-raw-hash-200"
      });

      const contextualNormObs = makeNormalizedRow({
        id: 300,
        rawObservationId: 200,
        source: "macro-calendar-api",
        observationKind: "scheduled_event",
        signalClass: "contextual",
        evidenceFamily: "macro_protocol_risk",
        payload: {
          sourceEventId: "event-123",
          eventFamily: "macro_protocol_risk",
          eventType: "scheduled_event",
          title: "FOMC Meeting",
          description: "Federal Reserve meeting",
          asOfUnixMs: 2000000,
          expiresAtUnixMs: 3000000,
          scheduledStartUnixMs: 2000000,
          scheduledEndUnixMs: null,
          severity: "HIGH",
          status: "SCHEDULED",
          affectedScope: ["SOL", "USDC"],
          sourceReferences: [],
          sourceQuality: {
            providerId: "macro-cal",
            reliability: 0.9,
            completeness: "complete",
            confirmation: "official"
          },
          rawProvenance: {
            sourceObservedAtUnixMs: 2000000,
            retrievedAtUnixMs: 2000000,
            retentionMode: "bounded_factual_extract",
            license: "MIT"
          },
          warnings: []
        } as unknown as NormalizedObservationRow["payload"],
        provenance: {
          ...DEFAULT_PROVENANCE,
          rawObservationRefs: [
            makeProvenanceRef("raw_observation", 200, "macro-calendar-api", "wrong-hash")
          ]
        }
      });

      const rawObservations = new Map<number, RawObservationRow>([
        [base.rawObs.id, base.rawObs],
        [contextualRawObs.id, contextualRawObs]
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
        contextualObservations: [contextualNormObs]
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PROVENANCE_HASH_MISMATCH");
      }
    });
  });

  describe("rejects unsupported contextual observation kinds", () => {
    it("returns error when contextual observation kind is not scheduled_event or protocol_incident", () => {
      const base = makeBaseInput();

      const contextualRawObs = makeRawObservationRow({
        id: 200,
        source: "jupiter-price",
        sourceObservationKey: "price-key-200",
        payloadHash: "price-raw-hash-200"
      });

      const contextualNormObs = makeNormalizedRow({
        id: 300,
        rawObservationId: 200,
        source: "jupiter-price",
        observationKind: "oracle_price",
        signalClass: "contextual",
        evidenceFamily: "price_quality",
        payload: {} as NormalizedObservationRow["payload"],
        provenance: {
          ...DEFAULT_PROVENANCE,
          rawObservationRefs: [
            makeProvenanceRef("raw_observation", 200, "jupiter-price", contextualRawObs.payloadHash)
          ]
        }
      });

      const rawObservations = new Map<number, RawObservationRow>([
        [base.rawObs.id, base.rawObs],
        [contextualRawObs.id, contextualRawObs]
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
        contextualObservations: [contextualNormObs]
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("UNSUPPORTED_CONTEXTUAL_KIND");
      }
    });
  });

  describe("maps source types correctly for contextual sources", () => {
    it("maps macro-calendar-api source to api source type", () => {
      const base = makeBaseInput();

      const contextualRawObs = makeRawObservationRow({
        id: 200,
        source: "macro-calendar-api",
        sourceObservationKey: "macro-cal-key-200",
        payloadHash: "contextual-raw-hash-200"
      });

      const contextualNormObs = makeNormalizedRow({
        id: 300,
        rawObservationId: 200,
        source: "macro-calendar-api",
        observationKind: "scheduled_event",
        signalClass: "contextual",
        evidenceFamily: "macro_protocol_risk",
        payload: {
          sourceEventId: "event-123",
          eventFamily: "macro_protocol_risk",
          eventType: "scheduled_event",
          title: "FOMC Meeting",
          description: "Federal Reserve meeting",
          asOfUnixMs: 2000000,
          expiresAtUnixMs: 3000000,
          scheduledStartUnixMs: 2000000,
          scheduledEndUnixMs: null,
          severity: "HIGH",
          status: "SCHEDULED",
          affectedScope: ["SOL", "USDC"],
          sourceReferences: [],
          sourceQuality: {
            providerId: "macro-cal",
            reliability: 0.9,
            completeness: "complete",
            confirmation: "official"
          },
          rawProvenance: {
            sourceObservedAtUnixMs: 2000000,
            retrievedAtUnixMs: 2000000,
            retentionMode: "bounded_factual_extract",
            license: "MIT"
          },
          warnings: []
        } as unknown as NormalizedObservationRow["payload"],
        provenance: {
          ...DEFAULT_PROVENANCE,
          rawObservationRefs: [
            makeProvenanceRef(
              "raw_observation",
              200,
              "macro-calendar-api",
              contextualRawObs.payloadHash
            )
          ]
        }
      });

      const rawObservations = new Map<number, RawObservationRow>([
        [base.rawObs.id, base.rawObs],
        [contextualRawObs.id, contextualRawObs]
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
        contextualObservations: [contextualNormObs]
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const sourceRef = result.lineage.sourceReferences.find(
          (s) => s.referenceId === `raw-${contextualRawObs.id}`
        );
        expect(sourceRef?.sourceType).toBe("api");
      }
    });

    it("maps solana-status-api source to api source type", () => {
      const base = makeBaseInput();

      const contextualRawObs = makeRawObservationRow({
        id: 201,
        source: "solana-status-api",
        sourceObservationKey: "solana-status-key-201",
        payloadHash: "contextual-raw-hash-201"
      });

      const contextualNormObs = makeNormalizedRow({
        id: 301,
        rawObservationId: 201,
        source: "solana-status-api",
        observationKind: "protocol_incident",
        signalClass: "contextual",
        evidenceFamily: "macro_protocol_risk",
        payload: {
          sourceEventId: "incident-456",
          eventFamily: "macro_protocol_risk",
          eventType: "protocol_incident",
          title: "Solana Network Issue",
          description: "Network congestion detected",
          asOfUnixMs: 2000000,
          expiresAtUnixMs: 3000000,
          detectedAtUnixMs: 1900000,
          resolvedAtUnixMs: null,
          severity: "CRITICAL",
          status: "ACTIVE",
          affectedScope: ["SOL"],
          sourceReferences: [],
          sourceQuality: {
            providerId: "solana-status",
            reliability: 0.95,
            completeness: "complete",
            confirmation: "official"
          },
          rawProvenance: {
            sourceObservedAtUnixMs: 2000000,
            retrievedAtUnixMs: 2000000,
            retentionMode: "bounded_factual_extract",
            license: "MIT"
          },
          warnings: []
        } as unknown as NormalizedObservationRow["payload"],
        provenance: {
          ...DEFAULT_PROVENANCE,
          rawObservationRefs: [
            makeProvenanceRef(
              "raw_observation",
              201,
              "solana-status-api",
              contextualRawObs.payloadHash
            )
          ]
        }
      });

      const rawObservations = new Map<number, RawObservationRow>([
        [base.rawObs.id, base.rawObs],
        [contextualRawObs.id, contextualRawObs]
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
        contextualObservations: [contextualNormObs]
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const sourceRef = result.lineage.sourceReferences.find(
          (s) => s.referenceId === `raw-${contextualRawObs.id}`
        );
        expect(sourceRef?.sourceType).toBe("api");
      }
    });
  });

  describe("uses retained raw observation keys as source locators", () => {
    it("uses raw observation sourceObservationKey as locator in source references", () => {
      const base = makeBaseInput();

      const contextualRawObs = makeRawObservationRow({
        id: 200,
        source: "macro-calendar-api",
        sourceObservationKey: "unique-macro-cal-key-xyz",
        payloadHash: "contextual-raw-hash-200"
      });

      const contextualNormObs = makeNormalizedRow({
        id: 300,
        rawObservationId: 200,
        source: "macro-calendar-api",
        observationKind: "scheduled_event",
        signalClass: "contextual",
        evidenceFamily: "macro_protocol_risk",
        payload: {
          sourceEventId: "event-123",
          eventFamily: "macro_protocol_risk",
          eventType: "scheduled_event",
          title: "FOMC Meeting",
          description: "Federal Reserve meeting",
          asOfUnixMs: 2000000,
          expiresAtUnixMs: 3000000,
          scheduledStartUnixMs: 2000000,
          scheduledEndUnixMs: null,
          severity: "HIGH",
          status: "SCHEDULED",
          affectedScope: ["SOL", "USDC"],
          sourceReferences: [],
          sourceQuality: {
            providerId: "macro-cal",
            reliability: 0.9,
            completeness: "complete",
            confirmation: "official"
          },
          rawProvenance: {
            sourceObservedAtUnixMs: 2000000,
            retrievedAtUnixMs: 2000000,
            retentionMode: "bounded_factual_extract",
            license: "MIT"
          },
          warnings: []
        } as unknown as NormalizedObservationRow["payload"],
        provenance: {
          ...DEFAULT_PROVENANCE,
          rawObservationRefs: [
            makeProvenanceRef(
              "raw_observation",
              200,
              "macro-calendar-api",
              contextualRawObs.payloadHash
            )
          ]
        }
      });

      const rawObservations = new Map<number, RawObservationRow>([
        [base.rawObs.id, base.rawObs],
        [contextualRawObs.id, contextualRawObs]
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
        contextualObservations: [contextualNormObs]
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const sourceRef = result.lineage.sourceReferences.find(
          (s) => s.referenceId === `raw-${contextualRawObs.id}`
        );
        expect(sourceRef?.locator).toBe("unique-macro-cal-key-xyz");
      }
    });
  });
});
