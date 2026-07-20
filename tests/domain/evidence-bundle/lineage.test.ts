import { describe, it, expect } from "vitest";
import type {
  FeatureKind,
  SignalClass,
  EvidenceFamily,
  Confidence,
  Provenance,
  ProvenanceRef
} from "../../../src/contracts/taxonomy.js";
import type { DerivedFeatureRow } from "../../../src/ports/feature-repo.js";
import type { NormalizedObservationRow } from "../../../src/ports/normalized-observation-repo.js";
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

function makeDerivedRow(
  overrides: Partial<DerivedFeatureRow> & {
    id: number;
    featureKind: FeatureKind;
    derivationKey: string;
    asOfUnixMs: number;
    receivedAtUnixMs: number;
    status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
    inputObservationIds?: number[];
  }
): DerivedFeatureRow {
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
    provenance: overrides.provenance ?? DEFAULT_PROVENANCE,
    payloadHash: overrides.payloadHash ?? `derived-hash-${overrides.id}`,
    receivedAtUnixMs: overrides.receivedAtUnixMs,
    status: overrides.status,
    unit: overrides.unit ?? "PPM",
    pair: overrides.pair ?? "SOL/USDC",
    calculatorVersion: overrides.calculatorVersion ?? "1.0",
    selectionVersion: overrides.selectionVersion ?? "1.0",
    inputObservationIds: overrides.inputObservationIds ?? [],
    rejectedObservationIds: overrides.rejectedObservationIds ?? [],
    derivationKey: overrides.derivationKey,
    poolId: overrides.poolId ?? null,
    positionId: overrides.positionId ?? null,
    warnings: overrides.warnings ?? [],
    reasons: overrides.reasons ?? []
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

function makeInput(): {
  request: {
    evaluationTimeUnixMs: number;
    selectionVersion: string;
    calculatorVersions: Record<FeatureKind, string>;
    candidates: DerivedFeatureRow[];
    poolId: string;
    positionId: string;
  };
  slots: Array<{
    featureKind: FeatureKind;
    outcome: string;
    rowId?: number;
    provenance?: Provenance;
    reasons?: readonly string[];
  }>;
  rawObservations: Map<number, RawObservationRow>;
  normalizedObservations: Map<number, NormalizedObservationRow>;
  derivedFeatures: Map<number, DerivedFeatureRow>;
  clmmCanonical: string;
  walletId: string;
  positionId: string;
  poolId: string;
} {
  const poolId = "pool-abc";
  const positionId = "position-1";
  const walletId = "wallet-xyz";

  const rawObs = makeRawObservationRow({
    id: 1,
    payloadCanonical: JSON.stringify(makeClmmBundlePayload(walletId, positionId, poolId))
  });
  const normObs = makeNormalizedRow({
    id: 10,
    rawObservationId: 1,
    provenance: {
      ...DEFAULT_PROVENANCE,
      rawObservationRefs: [
        makeProvenanceRef("raw_observation", 1, "clmm-v2-bundle", rawObs.payloadHash)
      ]
    }
  });
  const derivedRow = makeDerivedRow({
    id: 100,
    featureKind: "range_location",
    derivationKey: `pool=${poolId},position=${positionId}`,
    asOfUnixMs: 1000,
    receivedAtUnixMs: 1000,
    status: "AVAILABLE",
    value: 5000,
    poolId,
    positionId,
    inputObservationIds: [10],
    provenance: {
      ...DEFAULT_PROVENANCE,
      rawObservationRefs: [
        makeProvenanceRef("normalized_observation", 10, "clmm-v2-bundle", normObs.payloadHash)
      ]
    }
  });

  return {
    request: {
      evaluationTimeUnixMs: 5000000000,
      selectionVersion: "1.0",
      calculatorVersions: {
        range_location: "1.0",
        distance_to_lower: "1.0",
        distance_to_upper: "1.0",
        oracle_dex_divergence: "1.0",
        oracle_confidence_width: "1.0",
        realized_volatility_1h: "1.0",
        volume_liquidity_ratio_24h: "1.0"
      },
      candidates: [derivedRow],
      poolId,
      positionId
    },
    slots: [
      {
        featureKind: "range_location",
        outcome: "selected_available",
        rowId: 100,
        provenance: derivedRow.provenance,
        reasons: []
      }
    ],
    rawObservations: new Map([[1, rawObs]]),
    normalizedObservations: new Map([[10, normObs]]),
    derivedFeatures: new Map([[100, derivedRow]]),
    clmmCanonical: JSON.stringify(makeClmmBundlePayload(walletId, positionId, poolId)),
    walletId,
    positionId,
    poolId
  };
}

describe("verifyEvidenceLineage", () => {
  describe("accepts complete raw normalized and derived lineage for the requested context", () => {
    it("returns verified lineage when all provenance refs resolve correctly", () => {
      const input = makeInput();

      const result = verifyEvidenceLineage({
        request: input.request,
        slots: input.slots,
        rawObservations: input.rawObservations,
        normalizedObservations: input.normalizedObservations,
        derivedFeatures: input.derivedFeatures,
        clmmCanonical: input.clmmCanonical,
        walletId: input.walletId,
        positionId: input.positionId,
        poolId: input.poolId
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.lineage.rawObservationIds).toContain(1);
        expect(result.lineage.normalizedObservationIds).toContain(10);
      }
    });
  });

  describe("rejects a missing normalized reference", () => {
    it("returns error when a provenance normalized observation id is not in the bulk result", () => {
      const input = makeInput();
      input.normalizedObservations.delete(10);

      const result = verifyEvidenceLineage({
        request: input.request,
        slots: input.slots,
        rawObservations: input.rawObservations,
        normalizedObservations: input.normalizedObservations,
        derivedFeatures: input.derivedFeatures,
        clmmCanonical: input.clmmCanonical,
        walletId: input.walletId,
        positionId: input.positionId,
        poolId: input.poolId
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("MISSING_NORMALIZED_REFERENCE");
      }
    });
  });

  describe("rejects a missing raw parent", () => {
    it("returns error when a resolved normalized row does not have its exact raw parent", () => {
      const input = makeInput();
      input.rawObservations.delete(1);

      const result = verifyEvidenceLineage({
        request: input.request,
        slots: input.slots,
        rawObservations: input.rawObservations,
        normalizedObservations: input.normalizedObservations,
        derivedFeatures: input.derivedFeatures,
        clmmCanonical: input.clmmCanonical,
        walletId: input.walletId,
        positionId: input.positionId,
        poolId: input.poolId
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("MISSING_RAW_PARENT");
      }
    });
  });

  describe("rejects provenance id source or payload hash mismatches", () => {
    it("returns error when provenance ref id does not match persisted row", () => {
      const input = makeInput();
      const normObs = input.normalizedObservations.get(10)!;
      input.normalizedObservations.set(10, { ...normObs, id: 999 });

      const result = verifyEvidenceLineage({
        request: input.request,
        slots: input.slots,
        rawObservations: input.rawObservations,
        normalizedObservations: input.normalizedObservations,
        derivedFeatures: input.derivedFeatures,
        clmmCanonical: input.clmmCanonical,
        walletId: input.walletId,
        positionId: input.positionId,
        poolId: input.poolId
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PROVENANCE_ID_MISMATCH");
      }
    });

    it("returns error when provenance ref source does not match persisted row", () => {
      const input = makeInput();
      const normObs = input.normalizedObservations.get(10)!;
      input.normalizedObservations.set(10, { ...normObs, source: "jupiter-price" });

      const result = verifyEvidenceLineage({
        request: input.request,
        slots: input.slots,
        rawObservations: input.rawObservations,
        normalizedObservations: input.normalizedObservations,
        derivedFeatures: input.derivedFeatures,
        clmmCanonical: input.clmmCanonical,
        walletId: input.walletId,
        positionId: input.positionId,
        poolId: input.poolId
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PROVENANCE_SOURCE_MISMATCH");
      }
    });

    it("returns error when provenance ref payload hash does not match persisted row", () => {
      const input = makeInput();
      const normObs = input.normalizedObservations.get(10)!;
      input.normalizedObservations.set(10, { ...normObs, payloadHash: "wrong-hash" });

      const result = verifyEvidenceLineage({
        request: input.request,
        slots: input.slots,
        rawObservations: input.rawObservations,
        normalizedObservations: input.normalizedObservations,
        derivedFeatures: input.derivedFeatures,
        clmmCanonical: input.clmmCanonical,
        walletId: input.walletId,
        positionId: input.positionId,
        poolId: input.poolId
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PROVENANCE_HASH_MISMATCH");
      }
    });
  });

  describe("rejects wallet position pool or pair contradictions", () => {
    it("returns error when clmm bundle wallet does not match requested wallet", () => {
      const input = makeInput();
      const wrongWalletBundle = makeClmmBundlePayload(
        "wrong-wallet",
        input.positionId,
        input.poolId
      );
      input.clmmCanonical = JSON.stringify(wrongWalletBundle);
      input.rawObservations.get(1)!.payloadCanonical = JSON.stringify(wrongWalletBundle);

      const result = verifyEvidenceLineage({
        request: input.request,
        slots: input.slots,
        rawObservations: input.rawObservations,
        normalizedObservations: input.normalizedObservations,
        derivedFeatures: input.derivedFeatures,
        clmmCanonical: input.clmmCanonical,
        walletId: input.walletId,
        positionId: input.positionId,
        poolId: input.poolId
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("WALLET_MISMATCH");
      }
    });

    it("returns error when clmm bundle position does not match requested position", () => {
      const input = makeInput();
      const wrongPositionBundle = makeClmmBundlePayload(
        input.walletId,
        "wrong-position",
        input.poolId
      );
      input.clmmCanonical = JSON.stringify(wrongPositionBundle);
      input.rawObservations.get(1)!.payloadCanonical = JSON.stringify(wrongPositionBundle);

      const result = verifyEvidenceLineage({
        request: input.request,
        slots: input.slots,
        rawObservations: input.rawObservations,
        normalizedObservations: input.normalizedObservations,
        derivedFeatures: input.derivedFeatures,
        clmmCanonical: input.clmmCanonical,
        walletId: input.walletId,
        positionId: input.positionId,
        poolId: input.poolId
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("POSITION_MISMATCH");
      }
    });

    it("returns error when clmm bundle pool does not match requested pool", () => {
      const input = makeInput();
      const wrongPoolBundle = makeClmmBundlePayload(input.walletId, input.positionId, "wrong-pool");
      input.clmmCanonical = JSON.stringify(wrongPoolBundle);
      input.rawObservations.get(1)!.payloadCanonical = JSON.stringify(wrongPoolBundle);

      const result = verifyEvidenceLineage({
        request: input.request,
        slots: input.slots,
        rawObservations: input.rawObservations,
        normalizedObservations: input.normalizedObservations,
        derivedFeatures: input.derivedFeatures,
        clmmCanonical: input.clmmCanonical,
        walletId: input.walletId,
        positionId: input.positionId,
        poolId: input.poolId
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("POOL_MISMATCH");
      }
    });

    it("returns error when clmm bundle pair does not match SOL/USDC", () => {
      const input = makeInput();
      const wrongPairBundle = {
        ...makeClmmBundlePayload(input.walletId, input.positionId, input.poolId),
        pair: "SOL/SOL" as unknown
      };
      input.clmmCanonical = JSON.stringify(wrongPairBundle);
      input.rawObservations.get(1)!.payloadCanonical = JSON.stringify(wrongPairBundle);

      const result = verifyEvidenceLineage({
        request: input.request,
        slots: input.slots,
        rawObservations: input.rawObservations,
        normalizedObservations: input.normalizedObservations,
        derivedFeatures: input.derivedFeatures,
        clmmCanonical: input.clmmCanonical,
        walletId: input.walletId,
        positionId: input.positionId,
        poolId: input.poolId
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_CLMM_PAYLOAD");
      }
    });
  });

  describe("rejects invalid clmm-v2 canonical payload", () => {
    it("returns error when raw canonical text is not valid JSON", () => {
      const input = makeInput();
      input.clmmCanonical = "not json";
      input.rawObservations.get(1)!.payloadCanonical = "not json";

      const result = verifyEvidenceLineage({
        request: input.request,
        slots: input.slots,
        rawObservations: input.rawObservations,
        normalizedObservations: input.normalizedObservations,
        derivedFeatures: input.derivedFeatures,
        clmmCanonical: input.clmmCanonical,
        walletId: input.walletId,
        positionId: input.positionId,
        poolId: input.poolId
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_CLMM_PAYLOAD");
      }
    });

    it("returns error when clmm bundle fails schema validation", () => {
      const input = makeInput();
      const invalidBundle = {
        ...makeClmmBundlePayload(input.walletId, input.positionId, input.poolId),
        source: "invalid-source"
      };
      input.clmmCanonical = JSON.stringify(invalidBundle);
      input.rawObservations.get(1)!.payloadCanonical = JSON.stringify(invalidBundle);

      const result = verifyEvidenceLineage({
        request: input.request,
        slots: input.slots,
        rawObservations: input.rawObservations,
        normalizedObservations: input.normalizedObservations,
        derivedFeatures: input.derivedFeatures,
        clmmCanonical: input.clmmCanonical,
        walletId: input.walletId,
        positionId: input.positionId,
        poolId: input.poolId
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_CLMM_PAYLOAD");
      }
    });
  });

  describe("combines pair pool and position lineage in stable order", () => {
    it("de-duplicates and sorts raw observation ids", () => {
      const input = makeInput();

      const rawObs2 = makeRawObservationRow({
        id: 2,
        payloadCanonical: JSON.stringify(
          makeClmmBundlePayload(input.walletId, input.positionId, input.poolId)
        )
      });
      const normObs2 = makeNormalizedRow({
        id: 20,
        rawObservationId: 2,
        provenance: {
          ...DEFAULT_PROVENANCE,
          rawObservationRefs: [
            makeProvenanceRef("raw_observation", 2, "clmm-v2-bundle", rawObs2.payloadHash)
          ]
        }
      });
      const derivedRow2 = makeDerivedRow({
        id: 200,
        featureKind: "distance_to_lower",
        derivationKey: `pool=${input.poolId},position=${input.positionId}`,
        asOfUnixMs: 1000,
        receivedAtUnixMs: 1000,
        status: "AVAILABLE",
        value: 3000,
        poolId: input.poolId,
        positionId: input.positionId,
        inputObservationIds: [20],
        provenance: {
          ...DEFAULT_PROVENANCE,
          rawObservationRefs: [
            makeProvenanceRef("normalized_observation", 20, "clmm-v2-bundle", normObs2.payloadHash)
          ]
        }
      });

      input.derivedFeatures.set(200, derivedRow2);
      input.normalizedObservations.set(20, normObs2);
      input.rawObservations.set(2, rawObs2);

      input.slots.push({
        featureKind: "distance_to_lower",
        outcome: "selected_available",
        rowId: 200,
        provenance: derivedRow2.provenance,
        reasons: []
      });

      const result = verifyEvidenceLineage({
        request: input.request,
        slots: input.slots,
        rawObservations: input.rawObservations,
        normalizedObservations: input.normalizedObservations,
        derivedFeatures: input.derivedFeatures,
        clmmCanonical: input.clmmCanonical,
        walletId: input.walletId,
        positionId: input.positionId,
        poolId: input.poolId
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.lineage.rawObservationIds).toEqual([1, 2]);
        expect(result.lineage.normalizedObservationIds).toEqual([10, 20]);
      }
    });
  });

  describe("does not require numeric lineage for an explicit no-input unavailable slot", () => {
    it("returns verified lineage when unavailable slot has no inputs but has valid reasons", () => {
      const input = makeInput();
      input.slots = [
        {
          featureKind: "realized_volatility_1h",
          outcome: "selected_unavailable",
          rowId: 100,
          provenance: { ...DEFAULT_PROVENANCE, rawObservationRefs: [] },
          reasons: ["insufficient_data"]
        }
      ];

      const result = verifyEvidenceLineage({
        request: input.request,
        slots: input.slots,
        rawObservations: input.rawObservations,
        normalizedObservations: input.normalizedObservations,
        derivedFeatures: input.derivedFeatures,
        clmmCanonical: input.clmmCanonical,
        walletId: input.walletId,
        positionId: input.positionId,
        poolId: input.poolId
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.lineage.rawObservationIds).toEqual([]);
        expect(result.lineage.normalizedObservationIds).toEqual([]);
      }
    });
  });
});
