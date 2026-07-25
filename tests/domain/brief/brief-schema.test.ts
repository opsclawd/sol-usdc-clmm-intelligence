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
    sourceRefs: [
      {
        refType: "raw_observation",
        id: 1,
        source: "clmm-v2-bundle",
        payloadHash: "abc123hash"
      }
    ],
    unsupportedOrMissingInputs: []
  };

  const validPersistedBrief = {
    briefId: "brief-123",
    pair: "SOL/USDC" as const,
    generationStatus: "complete" as ResearchBriefGenerationStatus,
    llmOutput: validLlmOutput,
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

    it("rejects empty sourceEvidenceIds or sourceRefs", () => {
      const emptyIds = { ...validLlmOutput, sourceEvidenceIds: [] };
      const emptyRefs = { ...validLlmOutput, sourceRefs: [] };
      expect(LlmResearchBriefOutputSchema.safeParse(emptyIds).success).toBe(false);
      expect(LlmResearchBriefOutputSchema.safeParse(emptyRefs).success).toBe(false);
    });

    it("rejects overlong arrays and strings", () => {
      const overlongSummary = {
        ...validLlmOutput,
        summary: "a".repeat(5001)
      };
      const tooManyTakeaways = {
        ...validLlmOutput,
        keyTakeaways: Array(25).fill("Takeaway text")
      };
      expect(LlmResearchBriefOutputSchema.safeParse(overlongSummary).success).toBe(false);
      expect(LlmResearchBriefOutputSchema.safeParse(tooManyTakeaways).success).toBe(false);
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
