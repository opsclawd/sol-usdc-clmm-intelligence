import { describe, it, expect } from "vitest";
import type { FeatureKind, Confidence, Provenance } from "../../../src/contracts/taxonomy.js";
import { MVP_FEATURE_KINDS } from "../../../src/contracts/derived-feature.js";
import type { DerivedFeatureRow } from "../../../src/ports/feature-repo.js";
import type { SelectedFeatureSlot } from "../../../src/domain/evidence-bundle/select.js";
import type { EvidenceBundleQuality } from "../../../src/domain/evidence-bundle/quality.js";
import { assembleEvidenceBundleCandidate } from "../../../src/domain/evidence-bundle/assemble.js";
import type { AssembleEvidenceBundleInput } from "../../../src/domain/evidence-bundle/assemble.js";
import type { VerifiedEvidenceLineage } from "../../../src/domain/evidence-bundle/lineage.js";

const DEFAULT_CONFIDENCE: Confidence = {
  components: {
    sourceReliability: 1,
    dataCompleteness: 1,
    derivationConfidence: 1,
    llmConfidence: null
  },
  compositeScore: 10000,
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
    signalClass: (overrides.signalClass ??
      "deterministic") as import("../../../src/contracts/taxonomy.js").SignalClass,
    evidenceFamily: (overrides.evidenceFamily ??
      "clmm_state") as import("../../../src/contracts/taxonomy.js").EvidenceFamily,
    value: overrides.value ?? null,
    structuredPayload: overrides.structuredPayload ?? {},
    asOfUnixMs: overrides.asOfUnixMs,
    confidence: overrides.confidence ?? DEFAULT_CONFIDENCE,
    confidenceComposite: overrides.confidenceComposite ?? null,
    confidenceLevel: overrides.confidenceLevel ?? null,
    validUntilUnixMs: overrides.validUntilUnixMs ?? null,
    isStale: overrides.isStale ?? false,
    staleBehavior: (overrides.staleBehavior ?? null) as
      | import("../../../src/contracts/taxonomy.js").StaleBehavior
      | null,
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

function makeSlotsAllAvailable(candidates: DerivedFeatureRow[]): SelectedFeatureSlot[] {
  return MVP_FEATURE_KINDS.map((featureKind) => {
    const candidate = candidates.find((c) => c.featureKind === featureKind);
    if (!candidate) {
      return { featureKind, outcome: "missing" as const };
    }
    return {
      featureKind,
      outcome:
        candidate.status === "AVAILABLE"
          ? ("selected_available" as const)
          : candidate.status === "PARTIAL"
            ? ("selected_partial" as const)
            : ("selected_unavailable" as const),
      rowId: candidate.id,
      value: candidate.value ?? 0,
      confidence: candidate.confidence,
      provenance: candidate.provenance,
      warnings: candidate.warnings,
      reasons: candidate.reasons,
      asOfUnixMs: candidate.asOfUnixMs,
      validUntilUnixMs: candidate.validUntilUnixMs
    };
  });
}

function makeQuality(): EvidenceBundleQuality {
  return {
    version: "mvp-evidence-bundle-quality/v1",
    quality: "complete",
    coverage: {
      deterministic: "available",
      supportResistance: "not_applicable",
      flows: "not_applicable",
      derivatives: "not_applicable",
      events: "not_applicable",
      newsRegulatory: "not_applicable",
      researchBrief: "not_applicable"
    },
    overallConfidenceBps: 10000,
    slotQualitySummaries: MVP_FEATURE_KINDS.map((fk) => ({
      featureKind: fk,
      status: "available" as const,
      confidenceBps: 10000,
      hasValue: true,
      warnings: []
    })),
    warnings: [],
    createdAt: 5000000000000,
    asOf: 5000000000000,
    freshUntil: 50000003600000,
    expiresAt: 50000864000000
  };
}

function makeLineage(): VerifiedEvidenceLineage["lineage"] {
  return {
    rawObservationIds: [],
    normalizedObservationIds: [],
    sourceReferences: []
  };
}

function makeAssembleInput(
  slots: SelectedFeatureSlot[],
  quality: EvidenceBundleQuality,
  lineage: VerifiedEvidenceLineage["lineage"],
  overrides?: Partial<AssembleEvidenceBundleInput>
): AssembleEvidenceBundleInput {
  return {
    slots,
    quality,
    lineage,
    runId: overrides?.runId ?? "run-123",
    correlationId: overrides?.correlationId ?? "corr-456",
    poolId: overrides?.poolId ?? "pool-abc",
    positionId: overrides?.positionId ?? "position-1",
    walletId: overrides?.walletId ?? "wallet-xyz",
    createdAt: overrides?.createdAt ?? 5000000000000,
    asOf: overrides?.asOf ?? 5000000000000,
    freshUntil: overrides?.freshUntil ?? 50000003600000,
    expiresAt: overrides?.expiresAt ?? 50000864000000,
    contextPresent: overrides?.contextPresent ?? false,
    briefPresent: overrides?.briefPresent ?? false,
    pipelineVersion: overrides?.pipelineVersion ?? "1.0.0",
    gitCommit: overrides?.gitCommit ?? "abc123def456",
    environment: overrides?.environment ?? "test"
  };
}

describe("assembleEvidenceBundleCandidate", () => {
  describe("produces EvidenceBundleV1-compatible structure", () => {
    it("returns object with all required EvidenceBundleV1 fields", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 5000,
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const slots = makeSlotsAllAvailable(candidates);
      const quality = makeQuality();
      const lineage = makeLineage();

      const result = assembleEvidenceBundleCandidate(makeAssembleInput(slots, quality, lineage));

      expect(result).toHaveProperty("schemaVersion");
      expect(result).toHaveProperty("pair");
      expect(result).toHaveProperty("scope");
      expect(result).toHaveProperty("source");
      expect(result).toHaveProperty("runId");
      expect(result).toHaveProperty("correlationId");
      expect(result).toHaveProperty("createdAt");
      expect(result).toHaveProperty("asOf");
      expect(result).toHaveProperty("freshUntil");
      expect(result).toHaveProperty("expiresAt");
      expect(result).toHaveProperty("deterministicFeatures");
      expect(result).toHaveProperty("contextualEvidence");
      expect(result).toHaveProperty("researchBrief");
      expect(result).toHaveProperty("sourceReferences");
      expect(result).toHaveProperty("assessment");
      expect(result).toHaveProperty("provenance");
    });

    it("schemaVersion is evidence-bundle.v1", () => {
      const slots = makeSlotsAllAvailable([]);
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, makeQuality(), makeLineage())
      );

      expect(result.schemaVersion).toBe("evidence-bundle.v1");
    });

    it("pair is SOL/USDC", () => {
      const slots = makeSlotsAllAvailable([]);
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, makeQuality(), makeLineage())
      );

      expect(result.pair).toBe("SOL/USDC");
    });

    it("scope contains position kind with correct addresses", () => {
      const slots = makeSlotsAllAvailable([]);
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, makeQuality(), makeLineage(), {
          poolId: "pool-xyz",
          positionId: "pos-123",
          walletId: "wallet-abc"
        })
      );

      expect(result.scope).toEqual({
        kind: "position",
        network: "solana-mainnet",
        walletAddress: "wallet-abc",
        whirlpoolAddress: "pool-xyz",
        positionId: "pos-123"
      });
    });

    it("source publisher is sol-usdc-clmm-intelligence", () => {
      const slots = makeSlotsAllAvailable([]);
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, makeQuality(), makeLineage())
      );

      expect(result.source.publisher).toBe("sol-usdc-clmm-intelligence");
    });
  });

  describe("maps exactly seven feature summaries in canonical order", () => {
    it("deterministicFeatures array has exactly seven elements", () => {
      const slots = makeSlotsAllAvailable([]);
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, makeQuality(), makeLineage())
      );

      expect(result.deterministicFeatures).toHaveLength(7);
    });

    it("deterministicFeatures are in canonical MVP_FEATURE_KINDS order", () => {
      const slots = makeSlotsAllAvailable([]);
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, makeQuality(), makeLineage())
      );

      const featureKinds = result.deterministicFeatures.map((f) => f.featureKind);
      expect(featureKinds).toHaveLength(7);
    });

    it("each feature uses upstream field names exactly", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 5000,
          poolId: "pool-abc",
          positionId: "position-1",
          warnings: ["warning1"],
          reasons: ["reason1"]
        })
      ];
      const slots = makeSlotsAllAvailable(candidates);
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, makeQuality(), makeLineage())
      );

      const feature = result.deterministicFeatures[0];
      expect(feature).toHaveProperty("featureId");
      expect(feature).toHaveProperty("family");
      expect(feature).toHaveProperty("featureKind");
      expect(feature).toHaveProperty("status");
      expect(feature).toHaveProperty("calculator");
      expect(feature).toHaveProperty("inputLineage");
      expect(feature).toHaveProperty("warnings");
      expect((feature as unknown as Record<string, unknown>).localExtraField).toBeUndefined();
    });
  });

  describe("maps deterministic-only context and brief absence exactly", () => {
    it("context absent uses schema-authorized empty representation", () => {
      const slots = makeSlotsAllAvailable([]);
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, makeQuality(), makeLineage(), {
          contextPresent: false,
          briefPresent: false
        })
      );

      expect(result.contextualEvidence.supportResistance).toHaveLength(0);
      expect(result.contextualEvidence.flows).toHaveLength(0);
      expect(result.contextualEvidence.derivatives).toHaveLength(0);
      expect(result.contextualEvidence.events).toHaveLength(0);
      expect(result.contextualEvidence.newsRegulatory).toHaveLength(0);
      expect(result.researchBrief).toBeNull();
    });

    it("researchBrief is null when briefPresent is false", () => {
      const slots = makeSlotsAllAvailable([]);
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, makeQuality(), makeLineage(), {
          contextPresent: false,
          briefPresent: false
        })
      );

      expect(result.researchBrief).toBeNull();
    });
  });

  describe("derives timestamps deterministically from run context", () => {
    it("createdAt comes from run context, not ambient clock", () => {
      const slots = makeSlotsAllAvailable([]);
      const createdAt = 5000000000000;
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, makeQuality(), makeLineage(), { createdAt })
      );

      expect(result.createdAt).toBe(String(createdAt));
    });

    it("asOf equals the pinned asOf timestamp", () => {
      const slots = makeSlotsAllAvailable([]);
      const asOf = 5000000000000;
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, makeQuality(), makeLineage(), { asOf })
      );

      expect(result.asOf).toBe(String(asOf));
    });

    it("freshUntil and expiresAt follow pinned rules", () => {
      const slots = makeSlotsAllAvailable([]);
      const freshUntil = 50000003600000;
      const expiresAt = 50000864000000;
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, makeQuality(), makeLineage(), { freshUntil, expiresAt })
      );

      expect(result.freshUntil).toBe(String(freshUntil));
      expect(result.expiresAt).toBe(String(expiresAt));
    });
  });

  describe("normalizes warnings and references before mapping", () => {
    it("input permutations produce structurally identical candidates", () => {
      const candidates1: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 5000,
          poolId: "pool-abc",
          positionId: "position-1",
          warnings: ["z_warning", "a_warning"]
        })
      ];
      const candidates2: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 5000,
          poolId: "pool-abc",
          positionId: "position-1",
          warnings: ["a_warning", "z_warning"]
        })
      ];

      const slots1 = makeSlotsAllAvailable(candidates1);
      const slots2 = makeSlotsAllAvailable(candidates2);

      const quality1 = makeQuality();
      const quality2 = makeQuality();

      const result1 = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots1, quality1, makeLineage())
      );
      const result2 = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots2, quality2, makeLineage())
      );

      expect(result1.deterministicFeatures[0]?.warnings).toEqual(
        result2.deterministicFeatures[0]?.warnings
      );
    });
  });

  describe("does not include payload hash recursively", () => {
    it("candidate structure has no payloadHash field at root", () => {
      const slots = makeSlotsAllAvailable([]);
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, makeQuality(), makeLineage())
      );

      expect((result as unknown as Record<string, unknown>).payloadHash).toBeUndefined();
      expect((result as unknown as Record<string, unknown>).payloadCanonical).toBeUndefined();
      expect((result as unknown as Record<string, unknown>).idempotencyKey).toBeUndefined();
    });

    it("deterministicFeatures have no payloadHash recursively", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 5000,
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const slots = makeSlotsAllAvailable(candidates);
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, makeQuality(), makeLineage())
      );

      result.deterministicFeatures.forEach((feature) => {
        expect((feature as unknown as Record<string, unknown>).payloadHash).toBeUndefined();
      });
    });
  });

  describe("assessment reflects quality result", () => {
    it("assessment.quality matches quality result", () => {
      const slots = makeSlotsAllAvailable([]);
      const quality = makeQuality();
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, makeLineage())
      );

      expect(result.assessment.quality).toBe(quality.quality);
    });

    it("assessment.overallConfidenceBps matches quality result", () => {
      const slots = makeSlotsAllAvailable([]);
      const quality = makeQuality();
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, makeLineage())
      );

      expect(result.assessment.overallConfidenceBps).toBe(quality.overallConfidenceBps);
    });

    it("assessment.coverage matches quality coverage", () => {
      const slots = makeSlotsAllAvailable([]);
      const quality = makeQuality();
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, makeLineage())
      );

      expect(result.assessment.coverage.deterministic).toBe(quality.coverage.deterministic);
    });

    it("assessment.warnings match quality warnings", () => {
      const slots = makeSlotsAllAvailable([]);
      const baseQuality = makeQuality();
      const quality: EvidenceBundleQuality = {
        ...baseQuality,
        warnings: [
          ...baseQuality.warnings,
          {
            code: "test_warning",
            message: "Test warning",
            affectedFamilies: ["clmm_state"]
          }
        ]
      };
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, makeLineage())
      );

      expect(result.assessment.warnings).toHaveLength(1);
      expect(result.assessment.warnings[0]?.code).toBe("test_warning");
    });
  });

  describe("handles missing slots correctly", () => {
    it("missing slot maps to unavailable feature", () => {
      const slots: SelectedFeatureSlot[] = MVP_FEATURE_KINDS.map((fk) => ({
        featureKind: fk,
        outcome: "missing" as const
      }));
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, makeQuality(), makeLineage())
      );

      const rangeLocationFeature = result.deterministicFeatures[0];
      expect(rangeLocationFeature?.status).toBe("unavailable");
    });

    it("expired_only slot maps correctly", () => {
      const slots: SelectedFeatureSlot[] = MVP_FEATURE_KINDS.map((fk, i) =>
        fk === "range_location"
          ? { featureKind: fk as FeatureKind, outcome: "expired_only" as const, rowId: 1 }
          : {
              featureKind: fk,
              outcome: "selected_available" as const,
              rowId: i + 1,
              value: 1000,
              confidence: DEFAULT_CONFIDENCE,
              provenance: DEFAULT_PROVENANCE,
              warnings: [] as readonly string[],
              reasons: [] as readonly string[],
              asOfUnixMs: 1000,
              validUntilUnixMs: null
            }
      );
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, makeQuality(), makeLineage())
      );

      const rangeLocationFeature = result.deterministicFeatures[0];
      expect(rangeLocationFeature?.status).toBe("unavailable");
    });
  });

  describe("provenance fields are set correctly", () => {
    it("provenance.pipelineVersion matches input", () => {
      const slots = makeSlotsAllAvailable([]);
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, makeQuality(), makeLineage(), {
          pipelineVersion: "2.0.0"
        })
      );

      expect(result.provenance.pipelineVersion).toBe("2.0.0");
    });

    it("provenance.gitCommit is set", () => {
      const slots = makeSlotsAllAvailable([]);
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, makeQuality(), makeLineage(), {
          gitCommit: "abc123"
        })
      );

      expect(result.provenance.gitCommit).toBe("abc123");
    });

    it("provenance.environment matches input", () => {
      const slots = makeSlotsAllAvailable([]);
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, makeQuality(), makeLineage(), {
          environment: "production"
        })
      );

      expect(result.provenance.environment).toBe("production");
    });
  });
});
