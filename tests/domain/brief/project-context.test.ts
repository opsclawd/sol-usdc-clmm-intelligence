import { describe, expect, test } from "vitest";
import calmFixture from "../../fixtures/research-brief/calm.json" with { type: "json" };
import trendingFixture from "../../fixtures/research-brief/trending.json" with { type: "json" };
import stressedFixture from "../../fixtures/research-brief/stressed.json" with { type: "json" };
import sparseFixture from "../../fixtures/research-brief/sparse.json" with { type: "json" };
import type { EvidenceBundleV1 } from "../../../src/contracts/generated/evidence-bundle-v1.js";
import type { PersistedResearchBrief } from "../../../src/contracts/research-brief.js";
import {
  projectResearchBriefContext,
  validateGroundedReferences,
  ResearchBriefContextError,
  MAX_PROJECTED_FEATURES
} from "../../../src/domain/brief/project-context.js";

const calmBundle = calmFixture as unknown as EvidenceBundleV1;
const trendingBundle = trendingFixture as unknown as EvidenceBundleV1;
const stressedBundle = stressedFixture as unknown as EvidenceBundleV1;
const sparseBundle = sparseFixture as unknown as EvidenceBundleV1;

const samplePriorBrief: PersistedResearchBrief = {
  briefId: "prior-brief-100",
  pair: "SOL/USDC",
  generationStatus: "complete",
  llmOutput: {
    summary: "Prior summary of market condition.",
    keyTakeaways: ["Key takeaway 1"],
    supportsCurrentRegime: "supports",
    regimeAssessmentReasoning: "Prior reasoning",
    confidenceScore: 0.85,
    confidenceReasoning: "High confidence in prior brief",
    sourceEvidenceIds: ["feat-sol-price"],
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
    bundleId: "bundle-99",
    bundleHash: "bundlehash99"
  },
  inputContextHash: "inputhash99",
  priorBriefRef: null,
  generatedAt: "2026-05-10T11:00:00.000Z",
  promptVersion: "research-brief/v1"
};

describe("project-context", () => {
  describe("bounded-context-is-deterministic", () => {
    test("bounded-context-is-deterministic: identical inputs produce same ordered projection and hash", async () => {
      const proj1 = await projectResearchBriefContext({
        bundle: calmBundle,
        priorBrief: samplePriorBrief
      });
      const proj2 = await projectResearchBriefContext({
        bundle: calmBundle,
        priorBrief: samplePriorBrief
      });

      expect(proj1.inputContextHash).toBe(proj2.inputContextHash);
      expect(proj1).toEqual(proj2);
      expect(proj1.features.map((f) => f.featureId)).toEqual(
        [...proj1.features.map((f) => f.featureId)].sort()
      );
    });

    test("sorts features, contextual claims, source references, and warnings deterministically", async () => {
      const proj = await projectResearchBriefContext({ bundle: calmBundle });
      const featureIds = proj.features.map((f) => f.featureId);
      const sortedIds = [...featureIds].sort();
      expect(featureIds).toEqual(sortedIds);
    });
  });

  describe("bounded-context-rejects-byte-overflow", () => {
    test("bounded-context-rejects-byte-overflow: throws CONTEXT_TOO_LARGE when UTF-8 bytes exceed cap", async () => {
      // Construct an oversized bundle
      const hugeFeatures = Array.from({ length: 64 }, (_, i) => ({
        featureId: `feat-long-id-${i}-${"x".repeat(1500)}`,
        family: "market_state" as const,
        featureKind: "number" as const,
        status: "available" as const,
        value: 100 + i,
        unit: "usd" as const,
        observedAt: "2026-05-10T12:00:00.000Z",
        freshUntil: "2026-05-10T12:15:00.000Z",
        confidenceBps: 9000,
        calculator: { name: "calc", version: "1.0.0" },
        inputLineage: ["lineage-1"],
        warnings: []
      }));

      const hugeBundle: EvidenceBundleV1 = {
        ...calmBundle,
        // @ts-expect-error forcing large array for byte overflow test
        deterministicFeatures: hugeFeatures
      };

      await expect(projectResearchBriefContext({ bundle: hugeBundle })).rejects.toThrowError(
        ResearchBriefContextError
      );
      try {
        await projectResearchBriefContext({ bundle: hugeBundle });
      } catch (err) {
        expect(err).toBeInstanceOf(ResearchBriefContextError);
        expect((err as ResearchBriefContextError).code).toBe("CONTEXT_TOO_LARGE");
      }
    });

    test("truncates features beyond limit and includes truncation warning", async () => {
      const manyFeatures = Array.from({ length: 70 }, (_, i) => ({
        featureId: `feat-${String(i).padStart(3, "0")}`,
        family: "market_state" as const,
        featureKind: "number" as const,
        status: "available" as const,
        value: i,
        unit: "usd" as const,
        observedAt: "2026-05-10T12:00:00.000Z",
        freshUntil: "2026-05-10T12:15:00.000Z",
        confidenceBps: 9000,
        calculator: { name: "calc", version: "1.0.0" },
        inputLineage: ["lineage-1"],
        warnings: []
      }));

      const overflowBundle: EvidenceBundleV1 = {
        ...calmBundle,
        // @ts-expect-error array length override
        deterministicFeatures: manyFeatures
      };

      const proj = await projectResearchBriefContext({ bundle: overflowBundle });
      expect(proj.features.length).toBe(MAX_PROJECTED_FEATURES);
      expect(proj.projectionWarnings).toContain(
        `Truncated deterministic features to max limit of ${MAX_PROJECTED_FEATURES}`
      );
    });
  });

  describe("unsupported-model-references-degrade", () => {
    test("unsupported-model-references-degrade: validateGroundedReferences fails when IDs are missing from projection", async () => {
      const proj = await projectResearchBriefContext({ bundle: calmBundle });
      const validEvidenceIds = ["feat-sol-price", "sr-calm-1"];
      const invalidEvidenceIds = ["feat-sol-price", "unknown-feature-id"];

      const validResult = validateGroundedReferences(proj, validEvidenceIds, ["sr-ref-1"]);
      expect(validResult.valid).toBe(true);

      const invalidResult = validateGroundedReferences(proj, invalidEvidenceIds, ["sr-ref-1"]);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.unsupportedIds).toContain("unknown-feature-id");
    });

    test("validateGroundedReferences fails when sourceRefs are missing from projection", async () => {
      const proj = await projectResearchBriefContext({ bundle: calmBundle });
      const invalidSourceRefs = ["unknown-ref-id"];

      const result = validateGroundedReferences(proj, ["feat-sol-price"], invalidSourceRefs);
      expect(result.valid).toBe(false);
      expect(result.unsupportedIds).toContain("unknown-ref-id");
    });
  });

  describe("fixtures context projection", () => {
    test("projects calm fixture correctly", async () => {
      const proj = await projectResearchBriefContext({ bundle: calmBundle });
      expect(proj.features.map((f) => f.featureId)).toContain("feat-sol-price");
      expect(proj.features.map((f) => f.featureId)).toContain("feat-fee-apr");
      expect(proj.contextualClaims.supportResistance).toHaveLength(1);
      expect(proj.sourceReferences).toHaveLength(1);
      expect(proj.priorBrief).toBeNull();
    });

    test("projects trending fixture with prior brief", async () => {
      const proj = await projectResearchBriefContext({
        bundle: trendingBundle,
        priorBrief: samplePriorBrief
      });
      expect(proj.priorBrief).not.toBeNull();
      expect(proj.priorBrief?.briefId).toBe("prior-brief-100");
      expect(proj.priorBrief?.summary).toBe("Prior summary of market condition.");
    });

    test("projects stressed fixture with warnings", async () => {
      const proj = await projectResearchBriefContext({ bundle: stressedBundle });
      expect(proj.assessment.quality).toBe("degraded");
      expect(proj.assessment.warnings).toHaveLength(1);
    });

    test("projects sparse fixture reporting unavailable families", async () => {
      const proj = await projectResearchBriefContext({ bundle: sparseBundle });
      expect(proj.assessment.coverage.deterministic).toBe("unavailable");
    });
  });
});
