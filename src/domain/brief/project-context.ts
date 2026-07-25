import { canonicalHash } from "../content-hash.js";
import type {
  EvidenceBundleV1,
  DeterministicFeature,
  SourceReference,
  BundleAssessment
} from "../../contracts/generated/evidence-bundle-v1.js";
import type { PersistedResearchBrief } from "../../contracts/research-brief.js";

export const MAX_PROJECTED_FEATURES = 64;
export const MAX_PROJECTED_CLAIMS_PER_FAMILY = 16;
export const MAX_PROJECTED_SOURCE_REFS = 64;
export const MAX_COPIED_TEXT_LENGTH = 512;
export const MAX_CONTEXT_BYTES = 65536;

export class ResearchBriefContextError extends Error {
  readonly code: "CONTEXT_TOO_LARGE" | "INVALID_INPUT";
  constructor(message: string, code: "CONTEXT_TOO_LARGE" | "INVALID_INPUT") {
    super(message);
    this.name = "ResearchBriefContextError";
    this.code = code;
  }
}

export interface ProjectedFeatureSummary {
  featureId: string;
  family: string;
  featureKind: string;
  status: string;
  value: number | boolean | string | null;
  unit: string | null;
  confidenceBps: number;
  warnings: string[];
}

export interface ProjectedContextualClaimSummary {
  evidenceId: string;
  kind: string;
  claim: string;
  direction: string;
  confidenceBps: number;
  sourceReferenceIds: string[];
}

export interface ProjectedContextualEvidence {
  supportResistance: ProjectedContextualClaimSummary[];
  flows: ProjectedContextualClaimSummary[];
  derivatives: ProjectedContextualClaimSummary[];
  events: ProjectedContextualClaimSummary[];
  newsRegulatory: ProjectedContextualClaimSummary[];
}

export interface ProjectedSourceReference {
  referenceId: string;
  sourceType: string;
  locator: string;
}

export interface MinimizedPriorBrief {
  briefId: string;
  generatedAt: string;
  summary: string;
  keyTakeaways: string[];
  supportsCurrentRegime: string;
  confidenceScore: number;
}

export interface CurrentRegimeEvidenceInput {
  regimeLabel: string;
  confidenceBps: number;
  supportingReasoning: string;
}

export interface ResearchBriefContext {
  pair: "SOL/USDC";
  asOf: string;
  features: ProjectedFeatureSummary[];
  contextualClaims: ProjectedContextualEvidence;
  sourceReferences: ProjectedSourceReference[];
  assessment: {
    overallConfidenceBps: number;
    quality: string;
    coverage: BundleAssessment["coverage"];
    warnings: string[];
  };
  priorBrief: MinimizedPriorBrief | null;
  currentRegimeEvidence?: CurrentRegimeEvidenceInput | undefined;
  projectionWarnings: string[];
  inputContextHash: string;
}

function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength);
}

export interface ProjectContextParams {
  bundle: EvidenceBundleV1;
  priorBrief?: PersistedResearchBrief | null;
  currentRegimeEvidence?: CurrentRegimeEvidenceInput;
}

export async function projectResearchBriefContext(
  params: ProjectContextParams
): Promise<ResearchBriefContext> {
  const { bundle, priorBrief, currentRegimeEvidence } = params;
  const projectionWarnings: string[] = [];

  // 1. Features
  let featuresSource = [...bundle.deterministicFeatures];
  if (featuresSource.length > MAX_PROJECTED_FEATURES) {
    featuresSource = featuresSource.slice(0, MAX_PROJECTED_FEATURES);
    projectionWarnings.push(
      `Truncated deterministic features to max limit of ${MAX_PROJECTED_FEATURES}`
    );
  }

  const features: ProjectedFeatureSummary[] = featuresSource
    .map((f: DeterministicFeature) => ({
      featureId: f.featureId,
      family: f.family,
      featureKind: f.featureKind,
      status: f.status,
      value: f.value,
      unit: f.unit,
      confidenceBps: f.confidenceBps,
      warnings: [...(f.warnings || [])].sort()
    }))
    .sort((a, b) => a.featureId.localeCompare(b.featureId));

  // 2. Contextual evidence claims
  const processClaims = <
    T extends {
      evidenceId: string;
      kind: string;
      claim: string;
      direction: string;
      confidenceBps: number;
      sourceReferenceIds: string[];
    }
  >(
    claims: T[],
    familyName: string
  ): ProjectedContextualClaimSummary[] => {
    let source = [...claims];
    if (source.length > MAX_PROJECTED_CLAIMS_PER_FAMILY) {
      source = source.slice(0, MAX_PROJECTED_CLAIMS_PER_FAMILY);
      projectionWarnings.push(
        `Truncated ${familyName} claims to max limit of ${MAX_PROJECTED_CLAIMS_PER_FAMILY}`
      );
    }
    return source
      .map((c) => ({
        evidenceId: c.evidenceId,
        kind: c.kind,
        claim: truncateString(c.claim, MAX_COPIED_TEXT_LENGTH),
        direction: c.direction,
        confidenceBps: c.confidenceBps,
        sourceReferenceIds: [...c.sourceReferenceIds].sort()
      }))
      .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
  };

  const contextualClaims: ProjectedContextualEvidence = {
    supportResistance: processClaims(
      bundle.contextualEvidence.supportResistance || [],
      "supportResistance"
    ),
    flows: processClaims(bundle.contextualEvidence.flows || [], "flows"),
    derivatives: processClaims(bundle.contextualEvidence.derivatives || [], "derivatives"),
    events: processClaims(bundle.contextualEvidence.events || [], "events"),
    newsRegulatory: processClaims(bundle.contextualEvidence.newsRegulatory || [], "newsRegulatory")
  };

  // 3. Source references
  let sourceRefsSource = [...(bundle.sourceReferences || [])];
  if (sourceRefsSource.length > MAX_PROJECTED_SOURCE_REFS) {
    sourceRefsSource = sourceRefsSource.slice(0, MAX_PROJECTED_SOURCE_REFS);
    projectionWarnings.push(
      `Truncated source references to max limit of ${MAX_PROJECTED_SOURCE_REFS}`
    );
  }

  const sourceReferences: ProjectedSourceReference[] = sourceRefsSource
    .map((r: SourceReference) => ({
      referenceId: r.referenceId,
      sourceType: r.sourceType,
      locator: truncateString(r.locator, MAX_COPIED_TEXT_LENGTH)
    }))
    .sort((a, b) => a.referenceId.localeCompare(b.referenceId));

  // 4. Assessment
  const assessment = {
    overallConfidenceBps: bundle.assessment.overallConfidenceBps,
    quality: bundle.assessment.quality,
    coverage: bundle.assessment.coverage,
    warnings: (bundle.assessment.warnings || []).map((w) => w.code).sort()
  };

  // 5. Minimized prior brief
  let minimizedPrior: MinimizedPriorBrief | null = null;
  if (priorBrief && priorBrief.generationStatus === "complete") {
    minimizedPrior = {
      briefId: String(priorBrief.briefId),
      generatedAt: priorBrief.generatedAt,
      summary: truncateString(priorBrief.llmOutput.summary, MAX_COPIED_TEXT_LENGTH),
      keyTakeaways: priorBrief.llmOutput.keyTakeaways.map((t) =>
        truncateString(t, MAX_COPIED_TEXT_LENGTH)
      ),
      supportsCurrentRegime: priorBrief.llmOutput.supportsCurrentRegime,
      confidenceScore: priorBrief.llmOutput.confidenceScore
    };
  }

  // 6. Optional current regime
  let regimeInput: CurrentRegimeEvidenceInput | undefined = undefined;
  if (currentRegimeEvidence) {
    regimeInput = {
      regimeLabel: currentRegimeEvidence.regimeLabel,
      confidenceBps: currentRegimeEvidence.confidenceBps,
      supportingReasoning: truncateString(
        currentRegimeEvidence.supportingReasoning,
        MAX_COPIED_TEXT_LENGTH
      )
    };
  }

  projectionWarnings.sort();

  // Pre-hash payload object for inputContextHash
  const hashPayload: Record<string, unknown> = {
    pair: bundle.pair,
    asOf: bundle.asOf,
    features,
    contextualClaims,
    sourceReferences,
    assessment,
    priorBrief: minimizedPrior,
    projectionWarnings
  };

  if (regimeInput !== undefined) {
    hashPayload.currentRegimeEvidence = regimeInput;
  }

  const inputContextHash = await canonicalHash(hashPayload);

  const context: ResearchBriefContext = {
    pair: bundle.pair,
    asOf: bundle.asOf,
    features,
    contextualClaims,
    sourceReferences,
    assessment,
    priorBrief: minimizedPrior,
    currentRegimeEvidence: regimeInput,
    projectionWarnings,
    inputContextHash
  };

  // Enforce UTF-8 byte limit
  const serialized = JSON.stringify(context);
  const utf8Bytes = Buffer.byteLength(serialized, "utf8");
  if (utf8Bytes > MAX_CONTEXT_BYTES) {
    throw new ResearchBriefContextError(
      `Projected context size (${utf8Bytes} bytes) exceeds maximum cap of ${MAX_CONTEXT_BYTES} bytes.`,
      "CONTEXT_TOO_LARGE"
    );
  }

  return context;
}

export interface ValidationResult {
  valid: boolean;
  unsupportedIds: string[];
}

export function validateGroundedReferences(
  context: ResearchBriefContext,
  sourceEvidenceIds: string[],
  sourceRefs: string[]
): ValidationResult {
  const availableEvidenceIds = new Set<string>();

  for (const f of context.features) {
    availableEvidenceIds.add(f.featureId);
  }

  const claimFamilies = [
    context.contextualClaims.supportResistance,
    context.contextualClaims.flows,
    context.contextualClaims.derivatives,
    context.contextualClaims.events,
    context.contextualClaims.newsRegulatory
  ];

  for (const family of claimFamilies) {
    for (const claim of family) {
      availableEvidenceIds.add(claim.evidenceId);
    }
  }

  const availableSourceRefIds = new Set<string>(context.sourceReferences.map((r) => r.referenceId));

  const unsupportedIds: string[] = [];

  for (const evId of sourceEvidenceIds) {
    if (!availableEvidenceIds.has(evId)) {
      unsupportedIds.push(evId);
    }
  }

  for (const refId of sourceRefs) {
    if (!availableSourceRefIds.has(refId)) {
      unsupportedIds.push(refId);
    }
  }

  return {
    valid: unsupportedIds.length === 0,
    unsupportedIds: Array.from(new Set(unsupportedIds))
  };
}
