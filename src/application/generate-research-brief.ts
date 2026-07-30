import type { EvidenceBundleRepo } from "../ports/bundle-repo.js";
import type {
  ResearchBriefRepo,
  ResearchBriefRow,
  ResearchBriefInsert
} from "../ports/brief-repo.js";
import type { LlmProvider } from "../ports/llm-provider.js";
import type {
  LlmResearchBriefOutput,
  PersistedResearchBrief,
  ResearchBriefDegradationReason,
  ResearchBriefGenerationStatus,
  ResearchBriefProviderMetadata
} from "../contracts/research-brief.js";
import {
  PersistedResearchBriefSchema,
  LlmResearchBriefOutputSchema
} from "../domain/brief/brief-schema.js";
import {
  projectResearchBriefContext,
  validateGroundedReferences,
  ResearchBriefContextError
} from "../domain/brief/project-context.js";
import type {
  CurrentRegimeEvidenceInput,
  ResearchBriefContext,
  ProjectContextParams
} from "../domain/brief/project-context.js";
import {
  RESEARCH_BRIEF_PROMPT_V1,
  RESEARCH_BRIEF_PROMPT_VERSION
} from "../domain/brief/prompts.js";
import { canonicalHash } from "../domain/content-hash.js";
import type { Confidence, ProvenanceRef, Source } from "../contracts/taxonomy.js";
import type { EvidenceBundleV1 } from "../contracts/generated/evidence-bundle-v1.js";

export interface GenerateResearchBriefDeps {
  readonly bundleRepo: EvidenceBundleRepo;
  readonly briefRepo: ResearchBriefRepo;
  readonly llmProvider: LlmProvider;
}

export interface GenerateResearchBriefParams {
  readonly evidenceBundleId: number;
  readonly pair: "SOL/USDC";
  readonly evaluationTimeUnixMs: number;
  readonly codeVersion: string;
  readonly runId?: string | null;
  readonly currentRegimeEvidence?: CurrentRegimeEvidenceInput;
}

export type GenerateResearchBriefOutcome =
  | {
      readonly outcome: "no_brief";
      readonly reason: "no_bundle" | "expired_source" | "stale_source";
    }
  | {
      readonly outcome: "reused";
      readonly row: ResearchBriefRow;
      readonly brief: PersistedResearchBrief;
    }
  | {
      readonly outcome: "generated_complete";
      readonly row: ResearchBriefRow;
      readonly brief: PersistedResearchBrief;
    }
  | {
      readonly outcome: "generated_degraded";
      readonly row: ResearchBriefRow;
      readonly brief: PersistedResearchBrief;
    };

export async function generateResearchBrief(
  deps: GenerateResearchBriefDeps,
  params: GenerateResearchBriefParams
): Promise<GenerateResearchBriefOutcome> {
  const targetBundleRow = await deps.bundleRepo.findById(params.evidenceBundleId);
  if (!targetBundleRow || targetBundleRow.pair !== params.pair) {
    return { outcome: "no_brief", reason: "no_bundle" };
  }

  if (targetBundleRow.isStale) {
    return { outcome: "no_brief", reason: "stale_source" };
  }

  if (targetBundleRow.expiresAtUnixMs <= params.evaluationTimeUnixMs) {
    return { outcome: "no_brief", reason: "expired_source" };
  }

  // Find bounded prior brief context (max 10 bundles from previous 7 days)
  const sevenDaysAgoMs = params.evaluationTimeUnixMs - 7 * 24 * 60 * 60 * 1000;
  const recentBundles = await deps.bundleRepo.findByPair(params.pair, sevenDaysAgoMs);

  const candidateBundles = recentBundles
    .filter(
      (candidate) =>
        candidate.pair === targetBundleRow.pair &&
        candidate.id !== targetBundleRow.id &&
        candidate.asOfUnixMs < targetBundleRow.asOfUnixMs
    )
    .sort((a, b) => b.asOfUnixMs - a.asOfUnixMs || b.id - a.id)
    .slice(0, 10);

  let priorBrief: PersistedResearchBrief | null = null;
  let priorBriefRow: ResearchBriefRow | null = null;

  if (candidateBundles.length > 0) {
    const candidateBundleIds = candidateBundles.map((b) => b.id);
    const candidateBriefRows = deps.briefRepo.findByBundleIds
      ? await deps.briefRepo.findByBundleIds(candidateBundleIds)
      : (
          await Promise.all(candidateBundleIds.map((id) => deps.briefRepo.findByBundleId(id)))
        ).flat();

    for (const cand of candidateBundles) {
      const briefsForCand = candidateBriefRows
        .filter((b) => b.evidenceBundleId === cand.id)
        .sort((a, b) => b.receivedAtUnixMs - a.receivedAtUnixMs || b.id - a.id);

      for (const bRow of briefsForCand) {
        const artifact = bRow.structuredOutput as PersistedResearchBrief;
        if (artifact && artifact.generationStatus === "complete") {
          priorBrief = artifact;
          priorBriefRow = bRow;
          break;
        }
      }
      if (priorBrief) break;
    }
  }

  // Project context
  let projectedContext: ResearchBriefContext | null = null;
  let projectionError: Error | null = null;

  try {
    const projectParams: ProjectContextParams = {
      bundle: targetBundleRow.payload as EvidenceBundleV1,
      priorBrief,
      ...(params.currentRegimeEvidence
        ? { currentRegimeEvidence: params.currentRegimeEvidence }
        : {})
    };
    projectedContext = await projectResearchBriefContext(projectParams);
  } catch (err) {
    projectionError = err as Error;
  }

  const initialWarnings: string[] = [];
  if (projectionError || !projectedContext) {
    initialWarnings.push(
      projectionError?.message ?? "Failed to project context from evidence bundle."
    );
  }

  const inputContextHash = projectedContext
    ? projectedContext.inputContextHash
    : await canonicalHash({ pair: params.pair, warnings: initialWarnings });

  // Early idempotency check: reuse existing COMPLETE brief for the same bundle and context hash
  const existingBriefs = await deps.briefRepo.findByBundleId(targetBundleRow.id);
  const existingMatch = existingBriefs.find((r) => {
    const artifact = r.structuredOutput as PersistedResearchBrief;
    return (
      artifact &&
      artifact.inputContextHash === inputContextHash &&
      artifact.generationStatus === "complete"
    );
  });
  if (existingMatch) {
    return {
      outcome: "reused",
      row: existingMatch,
      brief: existingMatch.structuredOutput as PersistedResearchBrief
    };
  }

  let llmOutput: LlmResearchBriefOutput | null = null;
  let providerMetadata: ResearchBriefProviderMetadata = {
    provider: "unknown",
    model: "unknown"
  };
  let generationStatus: ResearchBriefGenerationStatus = "complete";
  let degradationReason: ResearchBriefDegradationReason | undefined = undefined;
  const warnings: string[] = [...initialWarnings];

  if (projectionError || !projectedContext) {
    generationStatus = "degraded";
    if (
      projectionError instanceof ResearchBriefContextError &&
      projectionError.code === "CONTEXT_TOO_LARGE"
    ) {
      degradationReason = "schema_validation_failed";
    } else {
      degradationReason = "missing_inputs";
    }
  } else {
    try {
      const generation = await deps.llmProvider.generateStructured({
        systemPrompt: RESEARCH_BRIEF_PROMPT_V1,
        context: projectedContext,
        schema: LlmResearchBriefOutputSchema,
        schemaName: "LlmResearchBriefOutput"
      });

      const rawOutput = generation.output;
      const outputClean: LlmResearchBriefOutput = {
        summary: rawOutput.summary,
        keyTakeaways: rawOutput.keyTakeaways,
        supportsCurrentRegime: rawOutput.supportsCurrentRegime,
        regimeAssessmentReasoning: rawOutput.regimeAssessmentReasoning,
        confidenceScore: rawOutput.confidenceScore,
        confidenceReasoning: rawOutput.confidenceReasoning,
        sourceEvidenceIds: rawOutput.sourceEvidenceIds,
        unsupportedOrMissingInputs: rawOutput.unsupportedOrMissingInputs,
        ...(rawOutput.degradationReason ? { degradationReason: rawOutput.degradationReason } : {})
      };

      llmOutput = outputClean;
      providerMetadata = {
        provider: generation.provider,
        model: generation.model
      };

      const groundedCheck = validateGroundedReferences(
        projectedContext,
        outputClean.sourceEvidenceIds ? [...outputClean.sourceEvidenceIds] : [],
        []
      );

      if (!groundedCheck.valid) {
        generationStatus = "degraded";
        degradationReason = "schema_validation_failed";
        warnings.push(
          `Unsupported or ungrounded evidence IDs: ${groundedCheck.unsupportedIds.join(", ")}`
        );
      }
    } catch (err) {
      generationStatus = "degraded";
      degradationReason = "model_error";
      warnings.push(`LLM generation failed: ${(err as Error).message}`);
    }
  }

  const finalLlmOutput: LlmResearchBriefOutput =
    generationStatus === "complete" && llmOutput
      ? llmOutput
      : {
          summary: `Degraded research brief generated due to error: ${warnings.join("; ")}`,
          keyTakeaways: ["Research brief generation failed or degraded."],
          supportsCurrentRegime: "not_applicable",
          regimeAssessmentReasoning: "Unable to assess regime support due to brief degradation.",
          confidenceScore: 0,
          confidenceReasoning: "Low confidence due to generation error or invalid grounding.",
          sourceEvidenceIds: [],
          unsupportedOrMissingInputs: warnings,
          degradationReason: degradationReason ?? "model_error"
        };

  const briefId = `brief:${targetBundleRow.id}:${inputContextHash.slice(0, 12)}`;

  const bundleRef: ProvenanceRef = {
    refType: "evidence_bundle",
    id: targetBundleRow.id,
    source: "clmm-v2-bundle",
    payloadHash: targetBundleRow.payloadHash
  };

  const sourceRefs: ProvenanceRef[] = [bundleRef];

  const derivedFromRefs: ProvenanceRef[] = [bundleRef];
  if (priorBriefRow) {
    const priorSource: Source =
      (priorBriefRow.provenance?.sourceRefs?.[0]?.source as Source) ?? "clmm-v2-bundle";
    derivedFromRefs.push({
      refType: "research_brief",
      id: priorBriefRow.id,
      source: priorSource,
      payloadHash: priorBriefRow.payloadHash
    });
  }

  const persistedBrief = PersistedResearchBriefSchema.parse({
    briefId,
    pair: params.pair,
    generationStatus,
    llmOutput: finalLlmOutput,
    sourceRefs,
    providerMetadata,
    sourceBundleRef: {
      bundleId: targetBundleRow.id,
      bundleHash: targetBundleRow.payloadHash
    },
    inputContextHash,
    priorBriefRef:
      priorBrief && priorBriefRow
        ? { briefId: priorBrief.briefId, payloadHash: priorBriefRow.payloadHash }
        : null,
    generatedAt: new Date(params.evaluationTimeUnixMs).toISOString(),
    promptVersion: RESEARCH_BRIEF_PROMPT_VERSION
  }) as PersistedResearchBrief;

  const payloadHash = await canonicalHash(persistedBrief);

  const confidenceScore = generationStatus === "complete" ? finalLlmOutput.confidenceScore : 0;
  const confidenceLevel =
    generationStatus === "complete" && confidenceScore >= 0.7
      ? "high"
      : generationStatus === "complete" && confidenceScore >= 0.4
        ? "medium"
        : "low";

  const confidence: Confidence = {
    components: {
      sourceReliability: 1,
      dataCompleteness: 1,
      derivationConfidence: 1,
      llmConfidence: confidenceScore
    },
    compositeScore: confidenceScore,
    level: confidenceLevel,
    weightingVersion: "v1",
    reasons: []
  };

  const insertData: ResearchBriefInsert = {
    evidenceBundleId: targetBundleRow.id,
    promptVersion: RESEARCH_BRIEF_PROMPT_VERSION,
    modelProvider: providerMetadata.provider,
    structuredOutput: persistedBrief,
    signalClass: "contextual",
    evidenceFamily: "market_regime",
    taxonomySummary: {
      families: { market_regime: 1 },
      dominantClass: "contextual"
    },
    confidence,
    confidenceComposite: confidenceScore,
    confidenceLevel: confidenceLevel,
    validUntilUnixMs: targetBundleRow.expiresAtUnixMs,
    isStale: false,
    staleBehavior: null,
    provenance: {
      sourceRefs,
      rawObservationRefs: [],
      derivedFromRefs,
      processRef: {
        collector: "generate_research_brief",
        jobName: "research_brief_generator",
        pipelineRunId: params.runId ?? null,
        codeVersion: params.codeVersion,
        modelVersion: providerMetadata.model
      },
      codeVersion: params.codeVersion,
      runId: params.runId ?? null
    },
    payloadHash,
    receivedAtUnixMs: params.evaluationTimeUnixMs
  };

  const insertedRow = await deps.briefRepo.insert(insertData);

  return {
    outcome: generationStatus === "complete" ? "generated_complete" : "generated_degraded",
    row: insertedRow,
    brief: persistedBrief
  };
}
