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
  readonly evidenceBundlePayload: EvidenceBundleV1;
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
      readonly brief: PersistedResearchBrief;
      readonly reusedRow: ResearchBriefRow;
      readonly priorBriefRowId?: number;
    }
  | {
      readonly outcome: "generated_complete";
      readonly brief: PersistedResearchBrief;
      readonly priorBriefRowId?: number;
    }
  | {
      readonly outcome: "generated_degraded";
      readonly brief: PersistedResearchBrief;
      readonly priorBriefRowId?: number;
    };

export interface PersistResearchBriefDeps {
  readonly briefRepo: ResearchBriefRepo;
}

export interface PersistResearchBriefParams {
  readonly bundleId: number;
  readonly bundleHash: string;
  readonly brief: PersistedResearchBrief;
  readonly pair: "SOL/USDC";
  readonly evaluationTimeUnixMs: number;
  readonly codeVersion: string;
  readonly runId?: string | null;
  readonly expiresAtUnixMs: number;
  readonly priorBriefRowId?: number;
}

export interface GenerateAndPersistResearchBriefParams {
  readonly evidenceBundleId: number;
  readonly pair: "SOL/USDC";
  readonly evaluationTimeUnixMs: number;
  readonly codeVersion: string;
  readonly runId?: string | null;
  readonly currentRegimeEvidence?: CurrentRegimeEvidenceInput;
}

export type GenerateAndPersistResearchBriefOutcome =
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

function extractFallbackEvidenceIds(
  projectedContext: ResearchBriefContext | null,
  payload: EvidenceBundleV1
): string[] {
  const ids: string[] = [];
  if (projectedContext) {
    for (const f of projectedContext.features) {
      ids.push(f.featureId);
    }
    const claimFamilies = [
      projectedContext.contextualClaims.supportResistance,
      projectedContext.contextualClaims.flows,
      projectedContext.contextualClaims.derivatives,
      projectedContext.contextualClaims.events,
      projectedContext.contextualClaims.newsRegulatory
    ];
    for (const family of claimFamilies) {
      for (const claim of family) {
        ids.push(claim.evidenceId);
      }
    }
  } else {
    for (const f of payload.deterministicFeatures) {
      ids.push(f.featureId);
    }
    const claimFamilies = [
      payload.contextualEvidence.supportResistance || [],
      payload.contextualEvidence.flows || [],
      payload.contextualEvidence.derivatives || [],
      payload.contextualEvidence.events || [],
      payload.contextualEvidence.newsRegulatory || []
    ];
    for (const family of claimFamilies) {
      for (const claim of family) {
        ids.push(claim.evidenceId);
      }
    }
  }
  return ids.slice(0, 256);
}

export async function generateResearchBrief(
  deps: GenerateResearchBriefDeps,
  params: GenerateResearchBriefParams
): Promise<GenerateResearchBriefOutcome> {
  const { evidenceBundlePayload: bundlePayload } = params;

  if (bundlePayload.pair !== params.pair) {
    return { outcome: "no_brief", reason: "no_bundle" };
  }

  const expiresAtMs = new Date(bundlePayload.expiresAt).getTime();
  if (expiresAtMs <= params.evaluationTimeUnixMs) {
    return { outcome: "no_brief", reason: "expired_source" };
  }

  const targetAsOfMs = new Date(bundlePayload.asOf).getTime();

  // Find bounded prior brief context (max 10 bundles from previous 7 days)
  const sevenDaysAgoMs = params.evaluationTimeUnixMs - 7 * 24 * 60 * 60 * 1000;
  const recentBundles = await deps.bundleRepo.findByPair(params.pair, sevenDaysAgoMs);

  const candidateBundles = recentBundles
    .filter(
      (candidate) => candidate.pair === bundlePayload.pair && candidate.asOfUnixMs < targetAsOfMs
    )
    .sort((a, b) => b.asOfUnixMs - a.asOfUnixMs || b.id - a.id)
    .slice(0, 10);

  const recentBundleIds = recentBundles.map((b) => b.id);
  const recentBriefRows: ResearchBriefRow[] =
    recentBundleIds.length > 0
      ? deps.briefRepo.findByBundleIds
        ? await deps.briefRepo.findByBundleIds(recentBundleIds)
        : (await Promise.all(recentBundleIds.map((id) => deps.briefRepo.findByBundleId(id)))).flat()
      : [];

  let priorBrief: PersistedResearchBrief | null = null;
  let priorBriefRow: ResearchBriefRow | null = null;

  if (candidateBundles.length > 0) {
    for (const cand of candidateBundles) {
      const briefsForCand = recentBriefRows
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
      bundle: bundlePayload,
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

  // Early idempotency check: reuse existing COMPLETE brief for matching context hash
  const existingMatch = recentBriefRows.find((r) => {
    const artifact = r.structuredOutput as PersistedResearchBrief;
    return (
      artifact &&
      artifact.inputContextHash === inputContextHash &&
      artifact.generationStatus === "complete"
    );
  });
  if (existingMatch) {
    const priorBriefRefId = existingMatch.provenance?.derivedFromRefs?.find(
      (r) => r.refType === "research_brief"
    )?.id;
    return {
      outcome: "reused",
      brief: existingMatch.structuredOutput as PersistedResearchBrief,
      reusedRow: existingMatch,
      ...(priorBriefRefId !== undefined ? { priorBriefRowId: priorBriefRefId } : {})
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

      const sourceEvidenceIds = outputClean.sourceEvidenceIds
        ? [...outputClean.sourceEvidenceIds]
        : [];

      if (sourceEvidenceIds.length === 0) {
        generationStatus = "degraded";
        degradationReason = "schema_validation_failed";
        warnings.push("Research brief contains no grounded source evidence IDs.");
      } else {
        const groundedCheck = validateGroundedReferences(projectedContext, sourceEvidenceIds, []);

        if (!groundedCheck.valid) {
          generationStatus = "degraded";
          degradationReason = "schema_validation_failed";
          warnings.push(
            `Unsupported or ungrounded evidence IDs: ${groundedCheck.unsupportedIds.join(", ")}`
          );
        }
      }
    } catch (err) {
      generationStatus = "degraded";
      degradationReason = "model_error";
      warnings.push(`LLM generation failed: ${(err as Error).message}`);
    }
  }

  const fallbackEvidenceIds = extractFallbackEvidenceIds(projectedContext, bundlePayload);
  if (fallbackEvidenceIds.length === 0) {
    return { outcome: "no_brief", reason: "no_bundle" };
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
          sourceEvidenceIds: fallbackEvidenceIds,
          unsupportedOrMissingInputs: warnings,
          degradationReason: degradationReason ?? "model_error"
        };

  const candidatePayloadHash = await canonicalHash(bundlePayload);
  const briefId = `brief:candidate:${candidatePayloadHash.slice(0, 12)}:${inputContextHash.slice(0, 12)}`;

  const persistedBrief = PersistedResearchBriefSchema.parse({
    briefId,
    pair: params.pair,
    generationStatus,
    llmOutput: finalLlmOutput,
    sourceRefs: [],
    providerMetadata,
    sourceBundleRef: {
      bundleId: "candidate",
      bundleHash: candidatePayloadHash
    },
    inputContextHash,
    priorBriefRef:
      priorBrief && priorBriefRow
        ? { briefId: priorBrief.briefId, payloadHash: priorBriefRow.payloadHash }
        : null,
    generatedAt: new Date(params.evaluationTimeUnixMs).toISOString(),
    promptVersion: RESEARCH_BRIEF_PROMPT_VERSION
  }) as PersistedResearchBrief;

  return {
    outcome: generationStatus === "complete" ? "generated_complete" : "generated_degraded",
    brief: persistedBrief,
    ...(priorBriefRow ? { priorBriefRowId: priorBriefRow.id } : {})
  };
}

export async function persistResearchBrief(
  deps: PersistResearchBriefDeps,
  params: PersistResearchBriefParams
): Promise<ResearchBriefRow> {
  const briefId = `brief:${params.bundleId}:${params.brief.inputContextHash.slice(0, 12)}`;

  const bundleRef: ProvenanceRef = {
    refType: "evidence_bundle",
    id: params.bundleId,
    source: "clmm-v2-bundle",
    payloadHash: params.bundleHash
  };

  const updatedSourceRefs: ProvenanceRef[] = [
    bundleRef,
    ...params.brief.sourceRefs.filter((ref) => ref.refType !== "evidence_bundle")
  ];

  const updatedBrief = PersistedResearchBriefSchema.parse({
    ...params.brief,
    briefId,
    sourceBundleRef: {
      bundleId: params.bundleId,
      bundleHash: params.bundleHash
    },
    sourceRefs: updatedSourceRefs
  }) as PersistedResearchBrief;

  const payloadHash = await canonicalHash(updatedBrief);

  const confidenceScore =
    updatedBrief.generationStatus === "complete" ? updatedBrief.llmOutput.confidenceScore : 0;
  const confidenceLevel =
    updatedBrief.generationStatus === "complete" && confidenceScore >= 0.7
      ? "high"
      : updatedBrief.generationStatus === "complete" && confidenceScore >= 0.4
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

  const derivedFromRefs: ProvenanceRef[] = [bundleRef];
  if (updatedBrief.priorBriefRef) {
    const priorMatchId = params.priorBriefRowId ?? 1;
    const priorSource: Source = "clmm-v2-bundle";

    derivedFromRefs.push({
      refType: "research_brief",
      id: priorMatchId,
      source: priorSource,
      payloadHash: updatedBrief.priorBriefRef.payloadHash
    });
  }

  const insertData: ResearchBriefInsert = {
    evidenceBundleId: params.bundleId,
    promptVersion: updatedBrief.promptVersion,
    modelProvider: updatedBrief.providerMetadata.provider,
    structuredOutput: updatedBrief,
    signalClass: "contextual",
    evidenceFamily: "market_regime",
    taxonomySummary: {
      families: { market_regime: 1 },
      dominantClass: "contextual"
    },
    confidence,
    confidenceComposite: confidenceScore,
    confidenceLevel,
    validUntilUnixMs: params.expiresAtUnixMs,
    isStale: false,
    staleBehavior: null,
    provenance: {
      sourceRefs: updatedSourceRefs,
      rawObservationRefs: [],
      derivedFromRefs,
      processRef: {
        collector: "generate_research_brief",
        jobName: "research_brief_generator",
        pipelineRunId: params.runId ?? null,
        codeVersion: params.codeVersion,
        modelVersion: updatedBrief.providerMetadata.model
      },
      codeVersion: params.codeVersion,
      runId: params.runId ?? null
    },
    payloadHash,
    receivedAtUnixMs: params.evaluationTimeUnixMs
  };

  return await deps.briefRepo.insert(insertData);
}

export async function generateAndPersistResearchBrief(
  deps: GenerateResearchBriefDeps,
  params: GenerateAndPersistResearchBriefParams
): Promise<GenerateAndPersistResearchBriefOutcome> {
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

  const candidateOutcome = await generateResearchBrief(deps, {
    evidenceBundlePayload: targetBundleRow.payload as EvidenceBundleV1,
    pair: params.pair,
    evaluationTimeUnixMs: params.evaluationTimeUnixMs,
    codeVersion: params.codeVersion,
    ...(params.runId !== undefined ? { runId: params.runId } : {}),
    ...(params.currentRegimeEvidence !== undefined
      ? { currentRegimeEvidence: params.currentRegimeEvidence }
      : {})
  });

  if (candidateOutcome.outcome === "no_brief") {
    return candidateOutcome;
  }

  if (candidateOutcome.outcome === "reused") {
    const existingBriefs = await deps.briefRepo.findByBundleId(targetBundleRow.id);
    const existingMatch = existingBriefs.find((r) => {
      const artifact = r.structuredOutput as PersistedResearchBrief;
      return (
        artifact &&
        artifact.inputContextHash === candidateOutcome.brief.inputContextHash &&
        artifact.generationStatus === "complete"
      );
    });
    if (existingMatch) {
      return {
        outcome: "reused",
        row: existingMatch,
        brief: candidateOutcome.brief
      };
    }
  }

  const priorBriefRowId =
    candidateOutcome.outcome === "generated_complete" ||
    candidateOutcome.outcome === "generated_degraded" ||
    candidateOutcome.outcome === "reused"
      ? candidateOutcome.priorBriefRowId
      : undefined;

  const row = await persistResearchBrief(deps, {
    bundleId: targetBundleRow.id,
    bundleHash: targetBundleRow.payloadHash,
    brief: candidateOutcome.brief,
    pair: params.pair,
    evaluationTimeUnixMs: params.evaluationTimeUnixMs,
    codeVersion: params.codeVersion,
    ...(params.runId !== undefined ? { runId: params.runId } : {}),
    expiresAtUnixMs: targetBundleRow.expiresAtUnixMs,
    ...(priorBriefRowId !== undefined ? { priorBriefRowId } : {})
  });

  return {
    outcome: candidateOutcome.outcome,
    row,
    brief: candidateOutcome.brief
  };
}
