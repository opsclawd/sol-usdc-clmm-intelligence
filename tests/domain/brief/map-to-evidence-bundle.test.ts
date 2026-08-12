import { describe, expect, test } from "vitest";
import calmFixture from "../../fixtures/research-brief/calm.json" with { type: "json" };
import type { EvidenceBundleV1 } from "../../../src/contracts/generated/evidence-bundle-v1.js";
import type { PersistedResearchBrief } from "../../../src/contracts/research-brief.js";
import {
  mapPersistedBriefToCanonicalBrief,
  mapPersistedBriefToCanonicalBundle,
  BUNDLE_IDENTIFIER_FIELDS
} from "../../../src/domain/brief/map-to-evidence-bundle.js";

const calmBundle = calmFixture as unknown as EvidenceBundleV1;

const validPersistedBrief: PersistedResearchBrief = {
  briefId: "brief-complete-1",
  pair: "SOL/USDC",
  generationStatus: "complete",
  llmOutput: {
    summary: "SOL market remains stable within narrow band.",
    keyTakeaways: ["Takeaway 1: Support holds at 140", "Takeaway 2: Fee APR active"],
    supportsCurrentRegime: "supports",
    regimeAssessmentReasoning: "Market indicators align with calm regime.",
    confidenceScore: 0.9,
    confidenceReasoning: "All key data points available and verified.",
    sourceEvidenceIds: ["feat-sol-price", "feat-fee-apr", "sr-calm-1"],
    unsupportedOrMissingInputs: []
  },
  sourceRefs: [
    {
      refType: "derived_feature",
      id: 1,
      source: "jupiter-price",
      payloadHash: "hash123"
    }
  ],
  providerMetadata: {
    provider: "openai",
    model: "gpt-4o-mini"
  },
  sourceBundleRef: {
    bundleId: "run-calm-001",
    bundleHash: "calmbundlehash"
  },
  inputContextHash: "inputctxhash",
  priorBriefRef: null,
  generatedAt: "2026-05-10T12:05:00.000Z",
  promptVersion: "research-brief/v1"
};

const degradedPersistedBrief: PersistedResearchBrief = {
  ...validPersistedBrief,
  briefId: "brief-degraded-1",
  generationStatus: "degraded",
  llmOutput: {
    ...validPersistedBrief.llmOutput,
    degradationReason: "model_error"
  }
};

describe("map-to-evidence-bundle", () => {
  describe("canonical-mapping-resolves-lineage", () => {
    test("canonical-mapping-resolves-lineage: mapped brief references only evidence IDs in source bundle", () => {
      const mappedBundle = mapPersistedBriefToCanonicalBundle(
        calmBundle,
        validPersistedBrief,
        "brief-complete-1"
      );

      expect(mappedBundle.researchBrief).not.toBeNull();
      expect(mappedBundle.researchBrief?.briefId).toBe("brief-complete-1");
      expect(mappedBundle.researchBrief?.summary).toBe(
        "SOL market remains stable within narrow band."
      );
      expect(mappedBundle.researchBrief?.keyFindings).toEqual([
        "Takeaway 1: Support holds at 140",
        "Takeaway 2: Fee APR active"
      ]);
      expect(mappedBundle.researchBrief?.sourceEvidenceIds).toEqual([
        "feat-sol-price",
        "feat-fee-apr",
        "sr-calm-1"
      ]);

      const sourceFeatureIds = calmBundle.deterministicFeatures.map((f) => f.featureId);
      const sourceClaimIds = calmBundle.contextualEvidence.supportResistance.map(
        (c) => c.evidenceId
      );
      const allSourceIds = new Set([...sourceFeatureIds, ...sourceClaimIds]);

      for (const id of mappedBundle.researchBrief?.sourceEvidenceIds ?? []) {
        expect(allSourceIds.has(id)).toBe(true);
      }
    });

    test("unresolved brief evidence is rejected for every generation status", () => {
      const ungroundedComplete: PersistedResearchBrief = {
        ...validPersistedBrief,
        generationStatus: "complete",
        llmOutput: {
          ...validPersistedBrief.llmOutput,
          sourceEvidenceIds: ["feat-sol-price", "non-existent-feature"]
        }
      };

      const ungroundedDegraded: PersistedResearchBrief = {
        ...degradedPersistedBrief,
        generationStatus: "degraded",
        llmOutput: {
          ...degradedPersistedBrief.llmOutput,
          sourceEvidenceIds: ["feat-sol-price", "non-existent-feature"]
        }
      };

      expect(() =>
        mapPersistedBriefToCanonicalBundle(calmBundle, ungroundedComplete, "brief-complete-1")
      ).toThrowError(/unresolved evidence IDs/i);

      expect(() =>
        mapPersistedBriefToCanonicalBundle(calmBundle, ungroundedDegraded, "brief-degraded-1")
      ).toThrowError(/unresolved evidence IDs/i);
    });

    test("accepts prior brief ID as valid source evidence reference", () => {
      const briefWithPriorRef: PersistedResearchBrief = {
        ...validPersistedBrief,
        priorBriefRef: {
          briefId: "brief-prior-999",
          payloadHash: "priorhash"
        },
        llmOutput: {
          ...validPersistedBrief.llmOutput,
          sourceEvidenceIds: ["feat-sol-price", "brief-prior-999"]
        }
      };

      const mappedBundle = mapPersistedBriefToCanonicalBundle(
        calmBundle,
        briefWithPriorRef,
        "brief-complete-2"
      );

      expect(mappedBundle.researchBrief?.sourceEvidenceIds).toEqual([
        "feat-sol-price",
        "brief-prior-999"
      ]);
    });

    test("accepts raw reference IDs from sourceReferences in brief citation", () => {
      const bundleWithRawSourceRef: EvidenceBundleV1 = {
        ...calmBundle,
        sourceReferences: [
          ...calmBundle.sourceReferences,
          {
            referenceId: "raw-obs-123",
            sourceType: "api",
            locator: "https://api.example.com/raw",
            publishedAt: "2026-05-10T11:55:00.000Z",
            observedAt: "2026-05-10T12:00:00.000Z",
            contentHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
          }
        ]
      };

      const briefWithRawRef: PersistedResearchBrief = {
        ...validPersistedBrief,
        llmOutput: {
          ...validPersistedBrief.llmOutput,
          sourceEvidenceIds: ["raw-obs-123"]
        }
      };

      const mappedBrief = mapPersistedBriefToCanonicalBrief(
        bundleWithRawSourceRef,
        briefWithRawRef,
        "brief-raw-ref-1"
      );

      expect(mappedBrief.sourceEvidenceIds).toEqual(["raw-obs-123"]);
    });

    test("accepts raw reference IDs from deterministicFeatures inputLineage in brief citation", () => {
      const bundleWithRawLineage: EvidenceBundleV1 = {
        ...calmBundle,
        deterministicFeatures: calmBundle.deterministicFeatures.map((f, i) =>
          i === 0 ? { ...f, inputLineage: ["raw-obs-456"] } : f
        ) as EvidenceBundleV1["deterministicFeatures"]
      };

      const briefWithRawLineage: PersistedResearchBrief = {
        ...validPersistedBrief,
        llmOutput: {
          ...validPersistedBrief.llmOutput,
          sourceEvidenceIds: ["raw-obs-456"]
        }
      };

      const mappedBrief = mapPersistedBriefToCanonicalBrief(
        bundleWithRawLineage,
        briefWithRawLineage,
        "brief-raw-lineage-1"
      );

      expect(mappedBrief.sourceEvidenceIds).toEqual(["raw-obs-456"]);
    });

    test("accepts raw reference IDs from contextualEvidence sourceReferenceIds in brief citation", () => {
      const bundleWithClaimSourceRef: EvidenceBundleV1 = {
        ...calmBundle,
        contextualEvidence: {
          ...calmBundle.contextualEvidence,
          supportResistance: [
            {
              evidenceId: "sr-calm-1",
              kind: "support_zone",
              claim: "Support zone",
              direction: "bullish",
              confidenceBps: 8000,
              observedAt: "2026-05-10T12:00:00.000Z",
              expiresAt: null,
              sourceReferenceIds: ["raw-claim-ref-789"],
              provenanceMethod: "derived"
            }
          ]
        }
      };

      const briefWithClaimRef: PersistedResearchBrief = {
        ...validPersistedBrief,
        llmOutput: {
          ...validPersistedBrief.llmOutput,
          sourceEvidenceIds: ["raw-claim-ref-789"]
        }
      };

      const mappedBrief = mapPersistedBriefToCanonicalBrief(
        bundleWithClaimSourceRef,
        briefWithClaimRef,
        "brief-claim-ref-1"
      );

      expect(mappedBrief.sourceEvidenceIds).toEqual(["raw-claim-ref-789"]);
    });

    // Drift is caught at compile time by BUNDLE_IDENTIFIER_FIELDS, which is
    // typed `Record<keyof EvidenceBundleV1, boolean>` — adding a field to the
    // contract without classifying it fails `tsc`.
    test("classifies every field of EvidenceBundleV1", () => {
      for (const key of Object.keys(calmBundle)) {
        expect(BUNDLE_IDENTIFIER_FIELDS).toHaveProperty(key);
      }
    });
  });

  test("leaves source bundle object untouched (non-mutating)", () => {
    const originalJson = JSON.stringify(calmBundle);
    mapPersistedBriefToCanonicalBundle(calmBundle, validPersistedBrief, "brief-complete-1");
    expect(JSON.stringify(calmBundle)).toBe(originalJson);
  });

  test("sets coverage to unavailable when brief is degraded", () => {
    const bundleWithAvailableCoverage: EvidenceBundleV1 = {
      ...calmBundle,
      assessment: {
        ...calmBundle.assessment,
        coverage: {
          ...calmBundle.assessment.coverage,
          researchBrief: "available"
        },
        warnings: calmBundle.assessment.warnings.filter(
          (w) => w.code !== "RESEARCH_BRIEF_UNAVAILABLE"
        )
      }
    };

    const mappedBundle = mapPersistedBriefToCanonicalBundle(
      bundleWithAvailableCoverage,
      degradedPersistedBrief,
      "brief-degraded-1"
    );

    expect(mappedBundle.researchBrief).not.toBeNull();
    expect(mappedBundle.researchBrief?.briefId).toBe("brief-degraded-1");
    expect(mappedBundle.assessment.coverage.researchBrief).toBe("unavailable");
    expect(
      mappedBundle.assessment.warnings.some((w) => w.code === "RESEARCH_BRIEF_UNAVAILABLE")
    ).toBe(true);
  });

  test("mapPersistedBriefToCanonicalBrief maps persisted brief to ResearchBrief struct", () => {
    const brief = mapPersistedBriefToCanonicalBrief(
      calmBundle,
      degradedPersistedBrief,
      "brief-degraded-1"
    );
    expect(brief.briefId).toBe("brief-degraded-1");
    expect(brief.model).toEqual({
      provider: "openai",
      modelId: "gpt-4o-mini",
      modelVersion: "research-brief/v1"
    });
  });

  test("updates coverage to available and removes RESEARCH_BRIEF_UNAVAILABLE warning", () => {
    const bundleWithWarning: EvidenceBundleV1 = {
      ...calmBundle,
      assessment: {
        ...calmBundle.assessment,
        coverage: {
          ...calmBundle.assessment.coverage,
          researchBrief: "unavailable"
        },
        warnings: [
          {
            code: "RESEARCH_BRIEF_UNAVAILABLE",
            message: "No research brief available",
            affectedFamilies: ["researchBrief"]
          },
          {
            code: "OTHER_WARNING",
            message: "Other warning",
            affectedFamilies: ["market_state"]
          }
        ]
      }
    };

    const mapped = mapPersistedBriefToCanonicalBundle(
      bundleWithWarning,
      validPersistedBrief,
      "brief-complete-1"
    );

    expect(mapped.assessment.coverage.researchBrief).toBe("available");
    expect(mapped.assessment.warnings).toEqual([
      {
        code: "OTHER_WARNING",
        message: "Other warning",
        affectedFamilies: ["market_state"]
      }
    ]);
  });
});
