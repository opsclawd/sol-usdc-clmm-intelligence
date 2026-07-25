import { z } from "zod";

const POLICY_LANGUAGE_REGEX =
  /\b(rebalance|rebalancing|execute\s+swap|withdraw\s+liquidity|buy\s+sol|sell\s+usdc)\b/i;

function validateNoPolicyLanguage(val: string, ctx: z.RefinementCtx): void {
  if (POLICY_LANGUAGE_REGEX.test(val)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Text contains prohibited policy synthesis or transaction instructions."
    });
  }
}

export const ProvenanceRefSchema = z
  .object({
    refType: z.enum([
      "raw_observation",
      "normalized_observation",
      "derived_feature",
      "evidence_bundle",
      "research_brief"
    ]),
    id: z.number().int().positive(),
    source: z.string().min(1).max(64),
    payloadHash: z.string().min(1).max(128)
  })
  .strict();

export const ResearchBriefDegradationReasonSchema = z.enum([
  "missing_inputs",
  "stale_data",
  "low_confidence_inputs",
  "conflicting_evidence",
  "model_error",
  "schema_validation_failed"
]);

export const SupportsCurrentRegimeSchema = z.enum([
  "supports",
  "contradicts",
  "unclear",
  "not_applicable"
]);

export const ResearchBriefGenerationStatusSchema = z.enum(["complete", "degraded"]);

export const LlmResearchBriefOutputSchema = z
  .object({
    summary: z.string().min(1).max(5000).superRefine(validateNoPolicyLanguage),
    keyTakeaways: z
      .array(z.string().min(1).max(1000).superRefine(validateNoPolicyLanguage))
      .min(1)
      .max(20),
    supportsCurrentRegime: SupportsCurrentRegimeSchema,
    regimeAssessmentReasoning: z.string().min(1).max(5000).superRefine(validateNoPolicyLanguage),
    confidenceScore: z.number().min(0).max(1),
    confidenceReasoning: z.string().min(1).max(5000).superRefine(validateNoPolicyLanguage),
    sourceEvidenceIds: z.array(z.string().min(1).max(128)).min(0).max(100),
    unsupportedOrMissingInputs: z.array(z.string().min(1).max(1000)).max(50),
    degradationReason: ResearchBriefDegradationReasonSchema.optional()
  })
  .strict();

export const ResearchBriefProviderMetadataSchema = z
  .object({
    provider: z.string().min(1).max(64),
    model: z.string().min(1).max(64),
    temperature: z.number().min(0).max(2).optional()
  })
  .strict();

export const ResearchBriefSourceBundleRefSchema = z
  .object({
    bundleId: z.union([z.string().min(1).max(128), z.number().int().positive()]),
    bundleHash: z.string().min(1).max(128)
  })
  .strict();

export const ResearchBriefPriorBriefRefSchema = z
  .object({
    briefId: z.union([z.string().min(1).max(128), z.number().int().positive()]),
    payloadHash: z.string().min(1).max(128)
  })
  .strict();

export const PersistedResearchBriefSchema = z
  .object({
    briefId: z.string().min(1).max(128),
    pair: z.literal("SOL/USDC"),
    generationStatus: ResearchBriefGenerationStatusSchema,
    llmOutput: LlmResearchBriefOutputSchema,
    sourceRefs: z.array(ProvenanceRefSchema).min(0).max(100),
    providerMetadata: ResearchBriefProviderMetadataSchema,
    sourceBundleRef: ResearchBriefSourceBundleRefSchema,
    inputContextHash: z.string().min(1).max(128),
    priorBriefRef: ResearchBriefPriorBriefRefSchema.nullable(),
    generatedAt: z.string().datetime(),
    promptVersion: z.string().min(1).max(64)
  })
  .strict();

export type LlmResearchBriefOutputFromSchema = z.infer<typeof LlmResearchBriefOutputSchema>;
export type PersistedResearchBriefFromSchema = z.infer<typeof PersistedResearchBriefSchema>;
