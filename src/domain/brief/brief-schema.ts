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

/**
 * Clamp over-long model output instead of rejecting the whole brief.
 *
 * The length caps are visible to the model — zodToJsonSchema emits maxLength
 * and maxItems into the prompt — but models exceed them anyway. Losing an
 * entire analysis because one advisory caveat ran past 1000 characters is
 * disproportionate: production run 1e347864 discarded a position bundle
 * entirely over `unsupportedOrMissingInputs[0]` being too long, and nothing
 * was published for that scope.
 *
 * Applied as a preprocess so the declared schema — and therefore the prompt the
 * model sees — still states the real limits. Prose is truncated with a visible
 * marker rather than silently; identifiers are never touched, because a
 * truncated evidence id would corrupt provenance and fail grounding anyway.
 */
const TRUNCATION_MARKER = "… [truncated]";

function clampText(value: unknown, max: number): unknown {
  if (typeof value !== "string" || value.length <= max) return value;
  return value.slice(0, max - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

function clampTextArray(value: unknown, maxItems: number, maxLen: number): unknown {
  if (!Array.isArray(value)) return value;
  return value.slice(0, maxItems).map((v) => clampText(v, maxLen));
}

export function clampLlmBriefOutput(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const v = { ...(value as Record<string, unknown>) };
  v.summary = clampText(v.summary, 5000);
  v.regimeAssessmentReasoning = clampText(v.regimeAssessmentReasoning, 5000);
  v.confidenceReasoning = clampText(v.confidenceReasoning, 5000);
  v.keyTakeaways = clampTextArray(v.keyTakeaways, 20, 1000);
  v.unsupportedOrMissingInputs = clampTextArray(v.unsupportedOrMissingInputs, 50, 1000);
  // sourceEvidenceIds deliberately untouched — identifiers must stay exact.
  return v;
}

export const LlmResearchBriefOutputBaseSchema = z
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
    // nullish, not optional: a model asked for "the reason this degraded" on a
    // brief that did not degrade will emit `null` rather than omit the key.
    // `.optional()` rejects null, so that reply failed schema validation and
    // produced a degraded brief — the field describing degradation causing it.
    // Downstream reads it with a truthy check, so null and undefined are
    // equivalent there. Especially likely on the hermes transport, where the
    // schema is stated in the prompt rather than enforced by the provider.
    // `.nullish()` alone emitted no type or enum into the generated JSON schema,
    // so the model saw a bare field name with no allowed values. Union with null
    // keeps null acceptable (see #186) while restoring the enum in the prompt.
    degradationReason: z.union([ResearchBriefDegradationReasonSchema, z.null()]).optional()
  })
  .strict();

export const LlmResearchBriefOutputSchema: z.ZodType<
  z.infer<typeof LlmResearchBriefOutputBaseSchema>,
  z.ZodTypeDef,
  unknown
> = z.preprocess(clampLlmBriefOutput, LlmResearchBriefOutputBaseSchema);

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
