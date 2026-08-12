import type {
  EvidenceBundleV1,
  ResearchBrief
} from "../../contracts/generated/evidence-bundle-v1.js";
import type { PersistedResearchBrief } from "../../contracts/research-brief.js";

/**
 * Compile-time drift guard: every field of `EvidenceBundleV1` is classified as
 * either carrying identifiers a brief may cite (`true`) or not (`false`).
 * Adding a field to the contract without classifying it here fails `tsc`.
 *
 * Compile-time rather than a runtime key scan: both callers of
 * `mapPersistedBriefToCanonicalBundle` wrap it in a catch that drops the brief
 * from the bundle, so a throw here would silently discard briefs in production.
 */
export const BUNDLE_IDENTIFIER_FIELDS: Record<keyof EvidenceBundleV1, boolean> = {
  schemaVersion: false,
  pair: false,
  scope: false,
  source: false,
  runId: false,
  correlationId: false,
  createdAt: false,
  asOf: false,
  freshUntil: false,
  expiresAt: false,
  deterministicFeatures: true,
  contextualEvidence: true,
  researchBrief: false,
  sourceReferences: true,
  assessment: false,
  provenance: false
};

export function mapPersistedBriefToCanonicalBrief(
  base: EvidenceBundleV1,
  artifact: PersistedResearchBrief,
  briefId: string
): ResearchBrief {
  // Validate that sourceEvidenceIds reference features/claims present in the base bundle
  const availableEvidenceIds = new Set<string>();

  const features = base.deterministicFeatures || [];
  for (const f of features) {
    if (f && f.featureId) {
      availableEvidenceIds.add(f.featureId);
    }
    const lineage = f?.inputLineage || [];
    for (const lineageId of lineage) {
      if (lineageId) {
        availableEvidenceIds.add(lineageId);
      }
    }
  }

  const contextualEvidence = base.contextualEvidence || {};
  const claimFamilies = [
    contextualEvidence.supportResistance || [],
    contextualEvidence.flows || [],
    contextualEvidence.derivatives || [],
    contextualEvidence.events || [],
    contextualEvidence.newsRegulatory || []
  ];

  for (const family of claimFamilies) {
    for (const c of family) {
      if (c && c.evidenceId) {
        availableEvidenceIds.add(c.evidenceId);
      }
      const refIds = c?.sourceReferenceIds || [];
      for (const refId of refIds) {
        if (refId) {
          availableEvidenceIds.add(refId);
        }
      }
    }
  }

  const sourceReferences = base.sourceReferences || [];
  for (const sr of sourceReferences) {
    if (sr && sr.referenceId) {
      availableEvidenceIds.add(sr.referenceId);
    }
  }

  if (artifact.priorBriefRef?.briefId) {
    availableEvidenceIds.add(String(artifact.priorBriefRef.briefId));
  }

  const sourceEvidenceIds = artifact.llmOutput.sourceEvidenceIds;
  if (sourceEvidenceIds.length === 0) {
    throw new Error("Research brief must have at least 1 source evidence ID.");
  }

  const unresolvedIds: string[] = [];
  for (const id of sourceEvidenceIds) {
    if (!availableEvidenceIds.has(id)) {
      unresolvedIds.push(id);
    }
  }

  if (unresolvedIds.length > 0) {
    throw new Error(
      `Brief references unresolved evidence IDs not present in source bundle: ${unresolvedIds.join(", ")}`
    );
  }

  // Build canonical ResearchBrief object
  const keyFindings = artifact.llmOutput.keyTakeaways.slice(0, 32);
  const uncertainties = artifact.llmOutput.unsupportedOrMissingInputs.slice(0, 32);

  return {
    briefId,
    generatedAt: artifact.generatedAt,
    summary: artifact.llmOutput.summary,
    keyFindings,
    uncertainties,
    model: {
      provider: artifact.providerMetadata.provider,
      modelId: artifact.providerMetadata.model,
      modelVersion: artifact.promptVersion
    },
    promptVersion: artifact.promptVersion,
    sourceEvidenceIds: sourceEvidenceIds as [string, ...string[]]
  };
}

export function mapPersistedBriefToCanonicalBundle(
  base: EvidenceBundleV1,
  artifact: PersistedResearchBrief,
  briefId: string
): EvidenceBundleV1 {
  const canonicalBrief = mapPersistedBriefToCanonicalBrief(base, artifact, briefId);

  // Deep copy base bundle to ensure no mutation
  const bundleCopy: EvidenceBundleV1 = JSON.parse(JSON.stringify(base));

  bundleCopy.researchBrief = canonicalBrief;

  if (artifact.generationStatus === "degraded") {
    bundleCopy.assessment.coverage.researchBrief = "unavailable";
    if (!bundleCopy.assessment.warnings.some((w) => w.code === "RESEARCH_BRIEF_UNAVAILABLE")) {
      bundleCopy.assessment.warnings.push({
        code: "RESEARCH_BRIEF_UNAVAILABLE",
        message: "No research brief available",
        affectedFamilies: ["researchBrief"]
      });
    }
  } else if (artifact.generationStatus === "complete") {
    bundleCopy.assessment.coverage.researchBrief = "available";

    // Remove only RESEARCH_BRIEF_UNAVAILABLE warning if present
    bundleCopy.assessment.warnings = bundleCopy.assessment.warnings.filter(
      (w) => w.code !== "RESEARCH_BRIEF_UNAVAILABLE"
    );
  }

  return bundleCopy;
}
