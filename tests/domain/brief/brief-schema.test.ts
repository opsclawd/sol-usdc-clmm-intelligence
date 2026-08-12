import { describe, it, expect } from "vitest";
import {
  LlmResearchBriefOutputSchema,
  PersistedResearchBriefSchema
} from "../../../src/domain/brief/brief-schema.js";
import {
  RESEARCH_BRIEF_PROMPT_V1,
  RESEARCH_BRIEF_PROMPT_VERSION
} from "../../../src/domain/brief/prompts.js";
import {
  ResearchBriefGenerationStatus,
  SupportsCurrentRegime
} from "../../../src/contracts/research-brief.js";

describe("Research Brief Contracts & Schemas", () => {
  const validLlmOutput = {
    summary:
      "SOL/USDC liquidity distribution is balanced around current tick with moderate volume.",
    keyTakeaways: ["Liquidity within 2% band is 1.5M USDC.", "24h fee yield is stable at 18% APR."],
    supportsCurrentRegime: "supports" as SupportsCurrentRegime,
    regimeAssessmentReasoning:
      "Volatility metrics remain within the threshold for concentrated LP range.",
    confidenceScore: 0.85,
    confidenceReasoning: "High completeness across CLMM state and oracle prices.",
    sourceEvidenceIds: ["obs-1", "feat-1"],
    unsupportedOrMissingInputs: []
  };

  const validPersistedBrief = {
    briefId: "brief-123",
    pair: "SOL/USDC" as const,
    generationStatus: "complete" as ResearchBriefGenerationStatus,
    llmOutput: validLlmOutput,
    sourceRefs: [
      {
        refType: "raw_observation",
        id: 1,
        source: "clmm-v2-bundle",
        payloadHash: "abc123hash"
      }
    ],
    providerMetadata: {
      provider: "google",
      model: "gemini-2.5-flash",
      temperature: 0.2
    },
    sourceBundleRef: {
      bundleId: "bundle-456",
      bundleHash: "hash456"
    },
    inputContextHash: "hash789",
    priorBriefRef: null,
    generatedAt: "2026-07-25T12:00:00.000Z",
    promptVersion: RESEARCH_BRIEF_PROMPT_VERSION
  };

  describe("LlmResearchBriefOutputSchema", () => {
    it("clamps an over-long advisory string instead of rejecting the brief", () => {
      // Production run 1e347864 discarded a whole position bundle because
      // unsupportedOrMissingInputs[0] exceeded 1000 chars. Nothing was published
      // for that scope. Losing the analysis over one long caveat is
      // disproportionate, so over-long prose is truncated with a marker.
      const result = LlmResearchBriefOutputSchema.safeParse({
        ...validLlmOutput,
        unsupportedOrMissingInputs: ["x".repeat(1500)]
      });
      expect(result.success).toBe(true);
      if (result.success) {
        const first = result.data.unsupportedOrMissingInputs[0]!;
        expect(first.length).toBeLessThanOrEqual(1000);
        expect(first.endsWith("… [truncated]")).toBe(true);
      }
    });

    it("clamps over-long summary and reasoning prose", () => {
      const result = LlmResearchBriefOutputSchema.safeParse({
        ...validLlmOutput,
        summary: "s".repeat(6000),
        regimeAssessmentReasoning: "r".repeat(6000),
        confidenceReasoning: "c".repeat(6000)
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.summary.length).toBeLessThanOrEqual(5000);
        expect(result.data.regimeAssessmentReasoning.length).toBeLessThanOrEqual(5000);
        expect(result.data.confidenceReasoning.length).toBeLessThanOrEqual(5000);
      }
    });

    it("clamps too many array items rather than rejecting", () => {
      const result = LlmResearchBriefOutputSchema.safeParse({
        ...validLlmOutput,
        keyTakeaways: Array.from({ length: 40 }, (_, i) => `takeaway ${i}`)
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.keyTakeaways.length).toBe(20);
    });

    it("never truncates evidence ids — a clipped id would corrupt provenance", () => {
      const result = LlmResearchBriefOutputSchema.safeParse({
        ...validLlmOutput,
        sourceEvidenceIds: ["e".repeat(200)]
      });
      expect(result.success).toBe(false);
    });

    it("still rejects prohibited policy language after clamping", () => {
      // Clamping must not become a way to smuggle a policy instruction past
      // the refinement by burying it beyond the cap.
      const result = LlmResearchBriefOutputSchema.safeParse({
        ...validLlmOutput,
        summary: "We should rebalance the position now."
      });
      expect(result.success).toBe(false);
    });

    it("accepts degradationReason: null from a model that did not degrade", () => {
      // Observed in production on the hermes transport: the model emitted
      // `"degradationReason": null` for a healthy brief. `.optional()` rejected
      // it, so schema validation failed and produced a degraded brief whose
      // summary was the validation error — the field describing degradation
      // causing the degradation.
      const result = LlmResearchBriefOutputSchema.safeParse({
        ...validLlmOutput,
        degradationReason: null
      });
      expect(result.success).toBe(true);
    });

    it("still accepts an omitted degradationReason", () => {
      const result = LlmResearchBriefOutputSchema.safeParse(validLlmOutput);
      expect(result.success).toBe(true);
    });

    it("still rejects an unrecognised degradationReason", () => {
      const result = LlmResearchBriefOutputSchema.safeParse({
        ...validLlmOutput,
        degradationReason: "not_a_real_reason"
      });
      expect(result.success).toBe(false);
    });

    it("parses a valid complete LLM research brief output", () => {
      const result = LlmResearchBriefOutputSchema.safeParse(validLlmOutput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.supportsCurrentRegime).toBe("supports");
        expect(result.data.confidenceScore).toBe(0.85);
      }
    });

    it("parses a degraded output with missing/unsupported inputs and degradation reason", () => {
      const degradedOutput = {
        ...validLlmOutput,
        confidenceScore: 0.3,
        unsupportedOrMissingInputs: ["Missing 24h volume metrics from DEX oracle"],
        degradationReason: "missing_inputs"
      };
      const result = LlmResearchBriefOutputSchema.safeParse(degradedOutput);
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys due to strict schema", () => {
      const invalid = {
        ...validLlmOutput,
        unknownField: "should cause failure"
      };
      const result = LlmResearchBriefOutputSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("rejects invalid confidence scores outside [0, 1]", () => {
      const invalidLow = { ...validLlmOutput, confidenceScore: -0.1 };
      const invalidHigh = { ...validLlmOutput, confidenceScore: 1.5 };
      expect(LlmResearchBriefOutputSchema.safeParse(invalidLow).success).toBe(false);
      expect(LlmResearchBriefOutputSchema.safeParse(invalidHigh).success).toBe(false);
    });

    it("allows empty sourceEvidenceIds for a fully degraded brief with no usable evidence", () => {
      const emptyIds = {
        ...validLlmOutput,
        sourceEvidenceIds: [],
        degradationReason: "missing_inputs"
      };
      expect(LlmResearchBriefOutputSchema.safeParse(emptyIds).success).toBe(true);
    });

    it("clamps overlong arrays and strings to the declared limits", () => {
      // Behaviour change: these used to be rejected outright, which discarded a
      // whole brief over advisory prose the model could not measure. They are
      // now clamped to the same limits the schema declares. The limits
      // themselves are unchanged and still appear in the generated JSON schema.
      const overlongSummary = {
        ...validLlmOutput,
        summary: "a".repeat(5001)
      };
      const tooManyTakeaways = {
        ...validLlmOutput,
        keyTakeaways: Array(25).fill("Takeaway text")
      };
      const s1 = LlmResearchBriefOutputSchema.safeParse(overlongSummary);
      const s2 = LlmResearchBriefOutputSchema.safeParse(tooManyTakeaways);
      expect(s1.success).toBe(true);
      expect(s2.success).toBe(true);
      if (s1.success) expect(s1.data.summary.length).toBeLessThanOrEqual(5000);
      if (s2.success) expect(s2.data.keyTakeaways.length).toBe(20);
    });

    it("rejects policy language such as direct rebalance/transaction instructions", () => {
      const rebalanceSummary = {
        ...validLlmOutput,
        summary: "We should rebalance the position immediately to tick 100."
      };
      const executeTakeaway = {
        ...validLlmOutput,
        keyTakeaways: ["Execute swap of 10 SOL to USDC now."]
      };
      const withdrawReasoning = {
        ...validLlmOutput,
        regimeAssessmentReasoning: "Withdraw liquidity completely."
      };

      expect(LlmResearchBriefOutputSchema.safeParse(rebalanceSummary).success).toBe(false);
      expect(LlmResearchBriefOutputSchema.safeParse(executeTakeaway).success).toBe(false);
      expect(LlmResearchBriefOutputSchema.safeParse(withdrawReasoning).success).toBe(false);
    });
  });

  describe("PersistedResearchBriefSchema", () => {
    it("parses a valid persisted research brief", () => {
      const result = PersistedResearchBriefSchema.safeParse(validPersistedBrief);
      expect(result.success).toBe(true);
    });

    it("rejects invalid ISO timestamps", () => {
      const invalid = {
        ...validPersistedBrief,
        generatedAt: "invalid-timestamp"
      };
      const result = PersistedResearchBriefSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("rejects unknown keys on the outer persisted envelope", () => {
      const invalid = {
        ...validPersistedBrief,
        extraParam: 123
      };
      const result = PersistedResearchBriefSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("allows an empty sourceRefs array for a fully degraded brief", () => {
      const degraded = {
        ...validPersistedBrief,
        generationStatus: "degraded" as ResearchBriefGenerationStatus,
        llmOutput: {
          ...validLlmOutput,
          sourceEvidenceIds: [],
          degradationReason: "missing_inputs"
        },
        sourceRefs: []
      };
      const result = PersistedResearchBriefSchema.safeParse(degraded);
      expect(result.success).toBe(true);
    });
  });

  describe("RESEARCH_BRIEF_PROMPT_V1", () => {
    it("contains required systemic instructions", () => {
      expect(RESEARCH_BRIEF_PROMPT_VERSION).toBe("research-brief/v1");
      expect(RESEARCH_BRIEF_PROMPT_V1).toContain("supplied evidence");
      expect(RESEARCH_BRIEF_PROMPT_V1).toContain("numeric units");
      expect(RESEARCH_BRIEF_PROMPT_V1).toContain("missing evidence");
      expect(RESEARCH_BRIEF_PROMPT_V1).toContain("policy");
      expect(RESEARCH_BRIEF_PROMPT_V1).toContain("transaction");
    });
  });
});
