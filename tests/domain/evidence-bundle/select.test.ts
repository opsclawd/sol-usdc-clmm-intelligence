import { describe, it, expect } from "vitest";
import type {
  FeatureKind,
  SignalClass,
  EvidenceFamily,
  Confidence,
  Provenance,
  StaleBehavior
} from "../../../src/contracts/taxonomy.js";
import { MVP_FEATURE_KINDS } from "../../../src/contracts/derived-feature.js";
import type { DerivedFeatureRow } from "../../../src/ports/feature-repo.js";
import { selectEvidenceFeatureSlots } from "../../../src/domain/evidence-bundle/select.js";
import type { BundleSelectionRequest } from "../../../src/domain/evidence-bundle/select.js";

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
    staleBehavior: (overrides.staleBehavior ?? null) as StaleBehavior | null,
    provenance: overrides.provenance ?? DEFAULT_PROVENANCE,
    payloadHash: overrides.payloadHash ?? `hash-${overrides.id}`,
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

function makeRequest(
  candidates: readonly DerivedFeatureRow[],
  overrides?: Partial<BundleSelectionRequest>
): BundleSelectionRequest {
  const defaultCalculatorVersions: Readonly<Record<FeatureKind, string>> = {
    range_location: "1.0",
    distance_to_lower: "1.0",
    distance_to_upper: "1.0",
    oracle_dex_divergence: "1.0",
    oracle_confidence_width: "1.0",
    realized_volatility_1h: "1.0",
    volume_liquidity_ratio_24h: "1.0"
  };

  const calculatorVersions: Readonly<Record<FeatureKind, string>> = overrides?.calculatorVersions
    ? { ...defaultCalculatorVersions, ...overrides.calculatorVersions }
    : defaultCalculatorVersions;

  const { calculatorVersions: _cv, ...restOverrides } = overrides ?? {};
  void _cv;

  return {
    evaluationTimeUnixMs: overrides?.evaluationTimeUnixMs ?? 5000000000,
    selectionVersion: overrides?.selectionVersion ?? "1.0",
    calculatorVersions,
    candidates,
    poolId: overrides?.poolId ?? "pool-abc",
    positionId: overrides?.positionId ?? "position-1",
    ...(restOverrides as Partial<BundleSelectionRequest>)
  };
}

describe("selectEvidenceFeatureSlots", () => {
  describe("selects independently into exactly seven canonical slots", () => {
    it("output contains every MVP_FEATURE_KINDS member once in canonical order", () => {
      const candidates: DerivedFeatureRow[] = [];
      const request = makeRequest(candidates);

      const result = selectEvidenceFeatureSlots(request);

      expect(result.slots).toHaveLength(7);
      expect(result.slots.map((s) => s.featureKind)).toEqual([...MVP_FEATURE_KINDS]);
    });

    it("returns missing slot when no candidate exists", () => {
      const candidates: DerivedFeatureRow[] = [];
      const request = makeRequest(candidates);

      const result = selectEvidenceFeatureSlots(request);

      const rangeLocationSlot = result.slots.find((s) => s.featureKind === "range_location")!;
      expect(rangeLocationSlot.outcome).toBe("missing");
    });
  });

  describe("selects the latest eligible row with a total tie break", () => {
    it("greatest asOfUnixMs wins", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.5,
          calculatorVersion: "1.0",
          poolId: "pool-abc",
          positionId: "position-1"
        }),
        makeFeatureRow({
          id: 2,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 2000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.6,
          calculatorVersion: "1.0",
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const request = makeRequest(candidates);

      const result = selectEvidenceFeatureSlots(request);

      const slot = result.slots.find((s) => s.featureKind === "range_location")!;
      expect(slot.outcome).toBe("selected_available");
      expect((slot as { rowId: number }).rowId).toBe(2);
    });

    it("greatest receivedAtUnixMs wins on tie", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.5,
          calculatorVersion: "1.0",
          poolId: "pool-abc",
          positionId: "position-1"
        }),
        makeFeatureRow({
          id: 2,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 2000,
          status: "AVAILABLE",
          value: 0.6,
          calculatorVersion: "1.0",
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const request = makeRequest(candidates);

      const result = selectEvidenceFeatureSlots(request);

      const slot = result.slots.find((s) => s.featureKind === "range_location")!;
      expect(slot.outcome).toBe("selected_available");
      expect((slot as { rowId: number }).rowId).toBe(2);
    });

    it("greatest database id wins on tie", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 2,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.5,
          calculatorVersion: "1.0",
          poolId: "pool-abc",
          positionId: "position-1"
        }),
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.6,
          calculatorVersion: "1.0",
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const request = makeRequest(candidates);

      const result = selectEvidenceFeatureSlots(request);

      const slot = result.slots.find((s) => s.featureKind === "range_location")!;
      expect(slot.outcome).toBe("selected_available");
      expect((slot as { rowId: number }).rowId).toBe(2);
    });

    it("winner is independent of repository return order", () => {
      const candidatesA: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 3,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.5,
          calculatorVersion: "1.0",
          poolId: "pool-abc",
          positionId: "position-1"
        }),
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 2000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.6,
          calculatorVersion: "1.0",
          poolId: "pool-abc",
          positionId: "position-1"
        }),
        makeFeatureRow({
          id: 2,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1500,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.7,
          calculatorVersion: "1.0",
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];

      const candidatesB = [...candidatesA].reverse();

      const resultA = selectEvidenceFeatureSlots(makeRequest(candidatesA));
      const resultB = selectEvidenceFeatureSlots(makeRequest(candidatesB));

      const slotA = resultA.slots.find((s) => s.featureKind === "range_location")!;
      const slotB = resultB.slots.find((s) => s.featureKind === "range_location")!;

      expect((slotA as { rowId: number }).rowId).toBe((slotB as { rowId: number }).rowId);
    });
  });

  describe("rejects future and boundary-expired rows", () => {
    it("asOfUnixMs > evaluationTimeUnixMs is future and rejected", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 6000000000,
          receivedAtUnixMs: 6000000000,
          status: "AVAILABLE",
          value: 0.5,
          calculatorVersion: "1.0",
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const request = makeRequest(candidates, { evaluationTimeUnixMs: 5000000000 });

      const result = selectEvidenceFeatureSlots(request);

      const slot = result.slots.find((s) => s.featureKind === "range_location")!;
      expect(slot.outcome).toBe("expired_only");
    });

    it("validUntilUnixMs at exact boundary is expired", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.5,
          calculatorVersion: "1.0",
          poolId: "pool-abc",
          positionId: "position-1",
          validUntilUnixMs: 5000000000
        })
      ];
      const request = makeRequest(candidates, { evaluationTimeUnixMs: 5000000000 });

      const result = selectEvidenceFeatureSlots(request);

      const slot = result.slots.find((s) => s.featureKind === "range_location")!;
      expect(slot.outcome).toBe("expired_only");
    });

    it("validUntilUnixMs after evaluation time is eligible", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.5,
          calculatorVersion: "1.0",
          poolId: "pool-abc",
          positionId: "position-1",
          validUntilUnixMs: 5000000001
        })
      ];
      const request = makeRequest(candidates, { evaluationTimeUnixMs: 5000000000 });

      const result = selectEvidenceFeatureSlots(request);

      const slot = result.slots.find((s) => s.featureKind === "range_location")!;
      expect(slot.outcome).toBe("selected_available");
    });
  });

  describe("enforces pair pool and position scope by kind", () => {
    it("position features match pair+pool+position", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.5,
          calculatorVersion: "1.0",
          pair: "SOL/USDC",
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const request = makeRequest(candidates, {
        poolId: "pool-abc",
        positionId: "position-1"
      });

      const result = selectEvidenceFeatureSlots(request);

      const slot = result.slots.find((s) => s.featureKind === "range_location")!;
      expect(slot.outcome).toBe("selected_available");
    });

    it("position features with wrong pool are rejected", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=xyz,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.5,
          calculatorVersion: "1.0",
          pair: "SOL/USDC",
          poolId: "pool-xyz",
          positionId: "position-1"
        })
      ];
      const request = makeRequest(candidates, {
        poolId: "pool-abc",
        positionId: "position-1"
      });

      const result = selectEvidenceFeatureSlots(request);

      const slot = result.slots.find((s) => s.featureKind === "range_location")!;
      expect(slot.outcome).toBe("missing");
    });

    it("volume/liquidity matches pair+pool with no position", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "volume_liquidity_ratio_24h",
          derivationKey: "pool=abc",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.8,
          calculatorVersion: "1.0",
          pair: "SOL/USDC",
          poolId: "pool-abc",
          positionId: null
        })
      ];
      const request = makeRequest(candidates, {
        poolId: "pool-abc",
        positionId: "position-1"
      });

      const result = selectEvidenceFeatureSlots(request);

      const slot = result.slots.find((s) => s.featureKind === "volume_liquidity_ratio_24h")!;
      expect(slot.outcome).toBe("selected_available");
    });

    it("pair features match pair with neither pool nor position", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "oracle_dex_divergence",
          derivationKey: "pair=SOL/USDC",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 10,
          calculatorVersion: "1.0",
          pair: "SOL/USDC",
          poolId: null,
          positionId: null
        })
      ];
      const request = makeRequest(candidates, {
        poolId: "pool-abc",
        positionId: "position-1"
      });

      const result = selectEvidenceFeatureSlots(request);

      const slot = result.slots.find((s) => s.featureKind === "oracle_dex_divergence")!;
      expect(slot.outcome).toBe("selected_available");
    });
  });

  describe("rejects unsupported calculator versions per feature kind", () => {
    it("only the request's exact version for that slot is eligible", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.5,
          calculatorVersion: "2.0",
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const request = makeRequest(candidates, {
        calculatorVersions: { range_location: "1.0" }
      } as Partial<BundleSelectionRequest>);

      const result = selectEvidenceFeatureSlots(request);

      const slot = result.slots.find((s) => s.featureKind === "range_location")!;
      expect(slot.outcome).toBe("unsupported_version_only");
    });

    it("unsupported-only is distinguishable from missing", () => {
      const candidatesVersionMismatch: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.5,
          calculatorVersion: "2.0",
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const candidatesMissing: DerivedFeatureRow[] = [];

      const requestMismatch = makeRequest(candidatesVersionMismatch, {
        calculatorVersions: { range_location: "1.0" }
      } as Partial<BundleSelectionRequest>);
      const requestMissing = makeRequest(candidatesMissing);

      const resultMismatch = selectEvidenceFeatureSlots(requestMismatch);
      const resultMissing = selectEvidenceFeatureSlots(requestMissing);

      const slotMismatch = resultMismatch.slots.find((s) => s.featureKind === "range_location")!;
      const slotMissing = resultMissing.slots.find((s) => s.featureKind === "range_location")!;

      expect(slotMismatch.outcome).toBe("unsupported_version_only");
      expect(slotMissing.outcome).toBe("missing");
    });
  });

  describe("preserves partial and unavailable states without fabricating values", () => {
    it("PARTIAL keeps its legitimate numeric value", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "PARTIAL",
          value: 0.5,
          calculatorVersion: "1.0",
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const request = makeRequest(candidates);

      const result = selectEvidenceFeatureSlots(request);

      const slot = result.slots.find((s) => s.featureKind === "range_location")!;
      expect(slot.outcome).toBe("selected_partial");
      expect((slot as { value: number }).value).toBe(0.5);
    });

    it("UNAVAILABLE has no numeric value", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "UNAVAILABLE",
          value: null,
          calculatorVersion: "1.0",
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const request = makeRequest(candidates);

      const result = selectEvidenceFeatureSlots(request);

      const slot = result.slots.find((s) => s.featureKind === "range_location")!;
      expect(slot.outcome).toBe("selected_unavailable");
    });

    it("missing has no numeric value", () => {
      const candidates: DerivedFeatureRow[] = [];
      const request = makeRequest(candidates);

      const result = selectEvidenceFeatureSlots(request);

      const slot = result.slots.find((s) => s.featureKind === "range_location")!;
      expect(slot.outcome).toBe("missing");
    });

    it("expired_only has no numeric value", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 6000000000,
          receivedAtUnixMs: 6000000000,
          status: "AVAILABLE",
          value: 0.5,
          calculatorVersion: "1.0",
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const request = makeRequest(candidates, { evaluationTimeUnixMs: 5000000000 });

      const result = selectEvidenceFeatureSlots(request);

      const slot = result.slots.find((s) => s.featureKind === "range_location")!;
      expect(slot.outcome).toBe("expired_only");
    });

    it("unsupported_version_only has no numeric value", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.5,
          calculatorVersion: "2.0",
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const request = makeRequest(candidates, {
        calculatorVersions: { range_location: "1.0" }
      } as Partial<BundleSelectionRequest>);

      const result = selectEvidenceFeatureSlots(request);

      const slot = result.slots.find((s) => s.featureKind === "range_location")!;
      expect(slot.outcome).toBe("unsupported_version_only");
    });
  });

  describe("preserves a legitimate numeric zero", () => {
    it("AVAILABLE value of 0 is preserved", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0,
          calculatorVersion: "1.0",
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const request = makeRequest(candidates);

      const result = selectEvidenceFeatureSlots(request);

      const slot = result.slots.find((s) => s.featureKind === "range_location")!;
      expect(slot.outcome).toBe("selected_available");
      expect((slot as { value: number }).value).toBe(0);
    });

    it("PARTIAL value of 0 is preserved", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "PARTIAL",
          value: 0,
          calculatorVersion: "1.0",
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const request = makeRequest(candidates);

      const result = selectEvidenceFeatureSlots(request);

      const slot = result.slots.find((s) => s.featureKind === "range_location")!;
      expect(slot.outcome).toBe("selected_partial");
      expect((slot as { value: number }).value).toBe(0);
    });
  });

  describe("produces stable rejection ids warnings and reasons", () => {
    it("candidate input permutations yield identical selected IDs", () => {
      const candidatesA: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 3,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.5,
          calculatorVersion: "1.0",
          poolId: "pool-abc",
          positionId: "position-1"
        }),
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 2000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.6,
          calculatorVersion: "1.0",
          poolId: "pool-abc",
          positionId: "position-1"
        }),
        makeFeatureRow({
          id: 2,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1500,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.7,
          calculatorVersion: "1.0",
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];

      const candidatesB = [...candidatesA].reverse();

      const resultA = selectEvidenceFeatureSlots(makeRequest(candidatesA));
      const resultB = selectEvidenceFeatureSlots(makeRequest(candidatesB));

      const slotA = resultA.slots.find((s) => s.featureKind === "range_location")!;
      const slotB = resultB.slots.find((s) => s.featureKind === "range_location")!;

      expect((slotA as { rowId: number }).rowId).toBe((slotB as { rowId: number }).rowId);
    });

    it("rejection ids are sorted and de-duplicated", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 5,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.5,
          calculatorVersion: "2.0",
          poolId: "pool-abc",
          positionId: "position-1"
        }),
        makeFeatureRow({
          id: 3,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.5,
          calculatorVersion: "2.0",
          poolId: "pool-abc",
          positionId: "position-1"
        }),
        makeFeatureRow({
          id: 7,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.5,
          calculatorVersion: "2.0",
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const request = makeRequest(candidates, {
        calculatorVersions: { range_location: "1.0" }
      } as Partial<BundleSelectionRequest>);

      const result = selectEvidenceFeatureSlots(request);

      expect(result.rejectedIds).toEqual([3, 5]);
    });

    it("rejection warnings are sorted and de-duplicated", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.5,
          calculatorVersion: "1.0",
          poolId: "pool-abc",
          positionId: "position-1"
        }),
        makeFeatureRow({
          id: 2,
          featureKind: "range_location",
          derivationKey: "pool=xyz,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.5,
          calculatorVersion: "1.0",
          poolId: "pool-xyz",
          positionId: "position-1"
        })
      ];
      const request = makeRequest(candidates, {
        poolId: "pool-abc",
        positionId: "position-1"
      });

      const result = selectEvidenceFeatureSlots(request);

      expect(result.warnings).toEqual([...result.warnings].sort());
      const uniqueWarnings = [...new Set(result.warnings)];
      expect(result.warnings).toEqual(uniqueWarnings);
    });

    it("rejection reasons are sorted and de-duplicated", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.5,
          calculatorVersion: "1.0",
          poolId: "pool-abc",
          positionId: "position-1"
        }),
        makeFeatureRow({
          id: 2,
          featureKind: "range_location",
          derivationKey: "pool=xyz,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 0.5,
          calculatorVersion: "1.0",
          poolId: "pool-xyz",
          positionId: "position-1"
        })
      ];
      const request = makeRequest(candidates, {
        poolId: "pool-abc",
        positionId: "position-1"
      });

      const result = selectEvidenceFeatureSlots(request);

      expect(result.reasons).toEqual([...result.reasons].sort());
      const uniqueReasons = [...new Set(result.reasons)];
      expect(result.reasons).toEqual(uniqueReasons);
    });
  });
});
