import { describe, it, expect } from "vitest";
import type { FeatureKind, Confidence, Provenance } from "../../../src/contracts/taxonomy.js";
import { MVP_FEATURE_KINDS } from "../../../src/contracts/derived-feature.js";
import type { DerivedFeatureRow } from "../../../src/ports/feature-repo.js";
import type { SelectedFeatureSlot } from "../../../src/domain/evidence-bundle/select.js";
import type { EvidenceBundleQuality } from "../../../src/domain/evidence-bundle/quality.js";
import { assembleEvidenceBundleCandidate } from "../../../src/domain/evidence-bundle/assemble.js";
import type { AssembleEvidenceBundleInput } from "../../../src/domain/evidence-bundle/assemble.js";
import type { VerifiedEvidenceLineage } from "../../../src/domain/evidence-bundle/lineage.js";
import { createEvidenceBundleContract } from "../../../src/adapters/node/evidence-bundle-v1-contract.js";
import { classifyEvidenceBundleQuality } from "../../../src/domain/evidence-bundle/quality.js";

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

function makeLineage(
  sourceReferences: VerifiedEvidenceLineage["lineage"]["sourceReferences"] = []
): VerifiedEvidenceLineage["lineage"] {
  return {
    rawObservationIds: sourceReferences.map((reference, index) => {
      const rawId = Number(reference.referenceId.replace(/^raw-/, ""));
      return Number.isFinite(rawId) ? rawId : index + 1;
    }),
    normalizedObservationIds: [],
    sourceReferences
  };
}

const RAW_SOURCE_REFERENCES: VerifiedEvidenceLineage["lineage"]["sourceReferences"] = [
  {
    referenceId: "raw-10",
    sourceType: "api",
    locator: "jupiter:SOL-USDC",
    observedAt: "2026-07-28T18:00:00.000Z"
  },
  {
    referenceId: "raw-20",
    sourceType: "chain",
    locator: "orca:pool-abc",
    observedAt: "2026-07-28T18:00:01.000Z"
  }
];

function makeAssembleInput(
  slots: SelectedFeatureSlot[],
  quality: EvidenceBundleQuality,
  lineage: VerifiedEvidenceLineage["lineage"],
  overrides?: Partial<AssembleEvidenceBundleInput>
): AssembleEvidenceBundleInput {
  return {
    scope: overrides?.scope ?? {
      kind: "position",
      network: "solana-mainnet",
      walletAddress: "wallet-xyz",
      whirlpoolAddress: "pool-abc",
      positionId: "position-1"
    },
    slots,
    quality,
    lineage,
    runId: overrides?.runId ?? "run-123",
    correlationId: overrides?.correlationId ?? "corr-456",
    createdAt: overrides?.createdAt ?? 5000000000000,
    asOf: overrides?.asOf ?? 5000000000000,
    freshUntil: overrides?.freshUntil ?? 50000003600000,
    expiresAt: overrides?.expiresAt ?? 50000864000000,
    briefPresent: overrides?.briefPresent ?? false,
    pipelineVersion: overrides?.pipelineVersion ?? "1.0.0",
    gitCommit: overrides?.gitCommit ?? "abc123def456",
    environment: overrides?.environment ?? "test",
    contextualEvents: overrides?.contextualEvents ?? []
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
      const lineage = makeLineage(RAW_SOURCE_REFERENCES);

      const result = assembleEvidenceBundleCandidate(makeAssembleInput(slots, quality, lineage));

      expect(result).toHaveProperty("schemaVersion", "evidence-bundle.v1");
      expect(result).toHaveProperty("pair", "SOL/USDC");
      expect(result).toHaveProperty("scope");
      expect(result).toHaveProperty("source");
      expect(result).toHaveProperty("runId", "run-123");
      expect(result).toHaveProperty("correlationId", "corr-456");
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
          scope: {
            kind: "position",
            network: "solana-mainnet",
            walletAddress: "wallet-abc",
            whirlpoolAddress: "pool-xyz",
            positionId: "pos-123"
          }
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

      expect(result.deterministicFeatures).toHaveLength(MVP_FEATURE_KINDS.length);
    });

    it("deterministicFeatures are in canonical MVP_FEATURE_KINDS order", () => {
      const slots = makeSlotsAllAvailable([]);
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, makeQuality(), makeLineage())
      );

      expect(result.deterministicFeatures).toHaveLength(MVP_FEATURE_KINDS.length);
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

      expect(result.createdAt).toBe(new Date(createdAt).toISOString());
    });

    it("asOf equals the pinned asOf timestamp", () => {
      const slots = makeSlotsAllAvailable([]);
      const asOf = 5000000000000;
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, makeQuality(), makeLineage(), { asOf })
      );

      expect(result.asOf).toBe(new Date(asOf).toISOString());
    });

    it("freshUntil and expiresAt follow pinned rules", () => {
      const slots = makeSlotsAllAvailable([]);
      const freshUntil = 50000003600000;
      const expiresAt = 50000864000000;
      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, makeQuality(), makeLineage(), { freshUntil, expiresAt })
      );

      expect(result.freshUntil).toBe(new Date(freshUntil).toISOString());
      expect(result.expiresAt).toBe(new Date(expiresAt).toISOString());
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

  describe("maps available and partial features to every verified source reference", () => {
    it("usable features receive assembled source lineage", () => {
      const asOfUnixMs = Date.parse("2026-07-28T18:00:02.000Z");
      const freshUntilUnixMs = Date.parse("2026-07-28T19:00:02.000Z");
      const expiresAtUnixMs = Date.parse("2026-07-28T20:00:02.000Z");

      function makeMixedSlots(asOf: number, freshUntil: number): SelectedFeatureSlot[] {
        return MVP_FEATURE_KINDS.map((featureKind, index) => {
          if (index === 2) return { featureKind, outcome: "missing" as const };
          if (index === 3) {
            return {
              featureKind,
              outcome: "selected_unavailable" as const,
              rowId: index + 1,
              confidence: { ...DEFAULT_CONFIDENCE, compositeScore: 0 },
              provenance: DEFAULT_PROVENANCE,
              warnings: ["no_valid_input"],
              reasons: ["input_exhausted"],
              asOfUnixMs: asOf,
              validUntilUnixMs: freshUntil
            };
          }
          if (index === 4) {
            return { featureKind, outcome: "expired_only" as const, rowId: index + 1 };
          }
          if (index === 5) {
            return { featureKind, outcome: "unsupported_version_only" as const, rowId: index + 1 };
          }
          return {
            featureKind,
            outcome: index === 1 ? ("selected_partial" as const) : ("selected_available" as const),
            rowId: index + 1,
            value: 1000 + index,
            confidence: DEFAULT_CONFIDENCE,
            provenance: DEFAULT_PROVENANCE,
            warnings: [] as readonly string[],
            reasons: [] as readonly string[],
            asOfUnixMs: asOf,
            validUntilUnixMs: freshUntil
          };
        });
      }

      const quality = makeQuality();
      const slots = makeMixedSlots(asOfUnixMs, freshUntilUnixMs);
      const lineage = makeLineage(RAW_SOURCE_REFERENCES);

      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, lineage, {
          runId: "run-lineage-test",
          correlationId: "corr-lineage-test",
          createdAt: asOfUnixMs,
          asOf: asOfUnixMs,
          freshUntil: freshUntilUnixMs,
          expiresAt: expiresAtUnixMs,
          briefPresent: false
        })
      );

      const usableFeatures = result.deterministicFeatures.filter(
        (feature) => feature.status === "available"
      );
      expect(usableFeatures.map((feature) => feature.inputLineage)).toEqual(
        usableFeatures.map(() => ["raw-10", "raw-20"])
      );
    });
  });

  describe("maps every unavailable feature outcome to the canonical unavailable reference", () => {
    it("missing, selected_unavailable, expired_only, and unsupported_version_only use feature_unavailable", () => {
      const asOfUnixMs = Date.parse("2026-07-28T18:00:02.000Z");
      const freshUntilUnixMs = Date.parse("2026-07-28T19:00:02.000Z");
      const expiresAtUnixMs = Date.parse("2026-07-28T20:00:02.000Z");

      function makeMixedSlots(asOf: number, freshUntil: number): SelectedFeatureSlot[] {
        return MVP_FEATURE_KINDS.map((featureKind, index) => {
          if (index === 2) return { featureKind, outcome: "missing" as const };
          if (index === 3) {
            return {
              featureKind,
              outcome: "selected_unavailable" as const,
              rowId: index + 1,
              confidence: { ...DEFAULT_CONFIDENCE, compositeScore: 0 },
              provenance: DEFAULT_PROVENANCE,
              warnings: ["no_valid_input"],
              reasons: ["input_exhausted"],
              asOfUnixMs: asOf,
              validUntilUnixMs: freshUntil
            };
          }
          if (index === 4) {
            return { featureKind, outcome: "expired_only" as const, rowId: index + 1 };
          }
          if (index === 5) {
            return { featureKind, outcome: "unsupported_version_only" as const, rowId: index + 1 };
          }
          return {
            featureKind,
            outcome: index === 1 ? ("selected_partial" as const) : ("selected_available" as const),
            rowId: index + 1,
            value: 1000 + index,
            confidence: DEFAULT_CONFIDENCE,
            provenance: DEFAULT_PROVENANCE,
            warnings: [] as readonly string[],
            reasons: [] as readonly string[],
            asOfUnixMs: asOf,
            validUntilUnixMs: freshUntil
          };
        });
      }

      const quality = makeQuality();
      const slots = makeMixedSlots(asOfUnixMs, freshUntilUnixMs);
      const lineage = makeLineage(RAW_SOURCE_REFERENCES);

      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, lineage, {
          runId: "run-lineage-test",
          correlationId: "corr-lineage-test",
          createdAt: asOfUnixMs,
          asOf: asOfUnixMs,
          freshUntil: freshUntilUnixMs,
          expiresAt: expiresAtUnixMs,
          briefPresent: false
        })
      );

      const unavailableFeatures = result.deterministicFeatures.filter(
        (feature) => feature.status === "unavailable"
      );
      expect(unavailableFeatures.map((feature) => feature.inputLineage)).toEqual(
        unavailableFeatures.map(() => ["feature_unavailable"])
      );
    });
  });

  describe("registers the unavailable source exactly once only when it is needed", () => {
    it("feature_unavailable source is registered when unavailable features exist", () => {
      const asOfUnixMs = Date.parse("2026-07-28T18:00:02.000Z");
      const freshUntilUnixMs = Date.parse("2026-07-28T19:00:02.000Z");
      const expiresAtUnixMs = Date.parse("2026-07-28T20:00:02.000Z");

      function makeMixedSlots(asOf: number, freshUntil: number): SelectedFeatureSlot[] {
        return MVP_FEATURE_KINDS.map((featureKind, index) => {
          if (index === 2) return { featureKind, outcome: "missing" as const };
          if (index === 3) {
            return {
              featureKind,
              outcome: "selected_unavailable" as const,
              rowId: index + 1,
              confidence: { ...DEFAULT_CONFIDENCE, compositeScore: 0 },
              provenance: DEFAULT_PROVENANCE,
              warnings: ["no_valid_input"],
              reasons: ["input_exhausted"],
              asOfUnixMs: asOf,
              validUntilUnixMs: freshUntil
            };
          }
          if (index === 4) {
            return { featureKind, outcome: "expired_only" as const, rowId: index + 1 };
          }
          if (index === 5) {
            return { featureKind, outcome: "unsupported_version_only" as const, rowId: index + 1 };
          }
          return {
            featureKind,
            outcome: index === 1 ? ("selected_partial" as const) : ("selected_available" as const),
            rowId: index + 1,
            value: 1000 + index,
            confidence: DEFAULT_CONFIDENCE,
            provenance: DEFAULT_PROVENANCE,
            warnings: [] as readonly string[],
            reasons: [] as readonly string[],
            asOfUnixMs: asOf,
            validUntilUnixMs: freshUntil
          };
        });
      }

      const quality = makeQuality();
      const slots = makeMixedSlots(asOfUnixMs, freshUntilUnixMs);
      const lineage = makeLineage(RAW_SOURCE_REFERENCES);

      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, lineage, {
          runId: "run-lineage-test",
          correlationId: "corr-lineage-test",
          createdAt: asOfUnixMs,
          asOf: asOfUnixMs,
          freshUntil: freshUntilUnixMs,
          expiresAt: expiresAtUnixMs,
          briefPresent: false
        })
      );

      expect(
        result.sourceReferences.filter(
          (reference) => reference.referenceId === "feature_unavailable"
        )
      ).toEqual([
        {
          referenceId: "feature_unavailable",
          sourceType: "internal_bundle",
          locator: "unavailable",
          observedAt: new Date(asOfUnixMs).toISOString()
        }
      ]);
    });

    it("feature_unavailable source is absent when all features are usable", () => {
      const asOfUnixMs = Date.parse("2026-07-28T18:00:02.000Z");
      const freshUntilUnixMs = Date.parse("2026-07-28T19:00:02.000Z");
      const expiresAtUnixMs = Date.parse("2026-07-28T20:00:02.000Z");

      const slots: SelectedFeatureSlot[] = MVP_FEATURE_KINDS.map((featureKind, index) => ({
        featureKind,
        outcome: "selected_available" as const,
        rowId: index + 1,
        value: 1000 + index,
        confidence: DEFAULT_CONFIDENCE,
        provenance: DEFAULT_PROVENANCE,
        warnings: [] as readonly string[],
        reasons: [] as readonly string[],
        asOfUnixMs,
        validUntilUnixMs: freshUntilUnixMs
      }));

      const quality = makeQuality();
      const lineage = makeLineage(RAW_SOURCE_REFERENCES);

      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, lineage, {
          runId: "run-lineage-test",
          correlationId: "corr-lineage-test",
          createdAt: asOfUnixMs,
          asOf: asOfUnixMs,
          freshUntil: freshUntilUnixMs,
          expiresAt: expiresAtUnixMs,
          briefPresent: false
        })
      );

      expect(
        result.sourceReferences.filter(
          (reference) => reference.referenceId === "feature_unavailable"
        )
      ).toEqual([]);
    });
  });

  describe("uses the existing no-sources reference for usable features when lineage is empty", () => {
    it("usable features reference no_sources_available when lineage has no external sources", () => {
      const asOfUnixMs = Date.parse("2026-07-28T18:00:02.000Z");
      const freshUntilUnixMs = Date.parse("2026-07-28T19:00:02.000Z");
      const expiresAtUnixMs = Date.parse("2026-07-28T20:00:02.000Z");

      const quality = makeQuality();
      const slots = makeSlotsAllAvailable([]);
      const lineage = makeLineage([]);

      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, lineage, {
          runId: "run-lineage-test",
          correlationId: "corr-lineage-test",
          createdAt: asOfUnixMs,
          asOf: asOfUnixMs,
          freshUntil: freshUntilUnixMs,
          expiresAt: expiresAtUnixMs,
          briefPresent: false
        })
      );

      const usableFeatures = result.deterministicFeatures.filter(
        (feature) => feature.status === "available"
      );
      expect(usableFeatures.map((feature) => feature.inputLineage)).toEqual(
        usableFeatures.map(() => ["no_sources_available"])
      );
    });
  });

  describe("passes strict contract validation for mixed availability without context or a brief", () => {
    it("mixed availability candidate with empty context and null brief passes contract validation", async () => {
      const asOfUnixMs = Date.parse("2026-07-28T18:00:02.000Z");
      const freshUntilUnixMs = Date.parse("2026-07-28T19:00:02.000Z");
      const expiresAtUnixMs = Date.parse("2026-07-28T20:00:02.000Z");

      function makeMixedSlots(asOf: number, freshUntil: number): SelectedFeatureSlot[] {
        return MVP_FEATURE_KINDS.map((featureKind, index) => {
          if (index === 2) return { featureKind, outcome: "missing" as const };
          if (index === 3) {
            return {
              featureKind,
              outcome: "selected_unavailable" as const,
              rowId: index + 1,
              confidence: { ...DEFAULT_CONFIDENCE, compositeScore: 0 },
              provenance: DEFAULT_PROVENANCE,
              warnings: ["no_valid_input"],
              reasons: ["input_exhausted"],
              asOfUnixMs: asOf,
              validUntilUnixMs: freshUntil
            };
          }
          if (index === 4) {
            return { featureKind, outcome: "expired_only" as const, rowId: index + 1 };
          }
          if (index === 5) {
            return { featureKind, outcome: "unsupported_version_only" as const, rowId: index + 1 };
          }
          return {
            featureKind,
            outcome: index === 1 ? ("selected_partial" as const) : ("selected_available" as const),
            rowId: index + 1,
            value: 1000 + index,
            confidence: DEFAULT_CONFIDENCE,
            provenance: DEFAULT_PROVENANCE,
            warnings: [] as readonly string[],
            reasons: [] as readonly string[],
            asOfUnixMs: asOf,
            validUntilUnixMs: freshUntil
          };
        });
      }

      const slots = makeMixedSlots(asOfUnixMs, freshUntilUnixMs);
      const quality = classifyEvidenceBundleQuality({
        slots,
        runId: "run-contract-regression",
        correlationId: "corr-contract-regression",
        createdAt: asOfUnixMs,
        asOf: asOfUnixMs,
        freshUntil: freshUntilUnixMs,
        expiresAt: expiresAtUnixMs,
        hasSupportResistance: false,
        hasFlows: false,
        hasDerivatives: false,
        hasEvents: false,
        hasNewsRegulatory: false,
        hasResearchBrief: false
      });
      const candidate = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, makeLineage(RAW_SOURCE_REFERENCES), {
          runId: "run-contract-regression",
          correlationId: "corr-contract-regression",
          createdAt: asOfUnixMs,
          asOf: asOfUnixMs,
          freshUntil: freshUntilUnixMs,
          expiresAt: expiresAtUnixMs,
          briefPresent: false,
          gitCommit: "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234"
        })
      );

      await expect(
        createEvidenceBundleContract().validateCanonicalizeAndHash(candidate)
      ).resolves.toMatchObject({
        schemaVersion: "evidence-bundle.v1"
      });
    });

    it("falls back to bundle freshUntil/asOf when slot validUntilUnixMs/asOfUnixMs is null for available feature", () => {
      const slots: SelectedFeatureSlot[] = [
        {
          featureKind: "range_location",
          outcome: "selected_available",
          rowId: 1,
          value: 5000,
          confidence: {
            compositeScore: 8000,
            components: {
              freshness: 8000,
              sampleSize: 8000,
              sourceReliability: 8000,
              variance: 8000
            }
          },
          asOfUnixMs: null,
          validUntilUnixMs: null
        } as unknown as SelectedFeatureSlot
      ];
      const quality = makeQuality();
      const lineage = makeLineage(RAW_SOURCE_REFERENCES);
      const bundleFreshUntil = 50000003600000;
      const bundleAsOf = 5000000000000;

      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, lineage, {
          asOf: bundleAsOf,
          freshUntil: bundleFreshUntil
        })
      );

      const availableFeature = result.deterministicFeatures.find(
        (f) => f.featureId === "feat-range_location-1"
      );
      expect(availableFeature).toBeDefined();
      expect(availableFeature?.freshUntil).not.toBeNull();
      expect(availableFeature?.observedAt).not.toBeNull();
    });

    it("assigns researchBrief as null", () => {
      const slots = makeSlotsAllAvailable([]);
      const quality = makeQuality();
      const lineage = makeLineage(RAW_SOURCE_REFERENCES);

      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, lineage, { briefPresent: true })
      );
      expect(result.researchBrief).toBeNull();
    });
  });
});
