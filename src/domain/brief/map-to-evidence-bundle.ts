import type {
  EvidenceBundleV1,
  ResearchBrief
} from "../../contracts/generated/evidence-bundle-v1.js";
import type { PersistedResearchBrief } from "../../contracts/research-brief.js";

export function mapPersistedBriefToCanonicalBrief(
  base: EvidenceBundleV1,
  artifact: PersistedResearchBrief,
  briefId: string
): ResearchBrief {
  // Validate that sourceEvidenceIds reference features/claims present in the base bundle
  const availableEvidenceIds = new Set<string>();
  for (const f of base.deterministicFeatures) {
    availableEvidenceIds.add(f.featureId);
    if (Array.isArray(f.inputLineage)) {
      for (const lineageId of f.inputLineage) {
        availableEvidenceIds.add(lineageId);
      }
    }
  }

  const claimFamilies = [
    base.contextualEvidence.supportResistance || [],
    base.contextualEvidence.flows || [],
    base.contextualEvidence.derivatives || [],
    base.contextualEvidence.events || [],
    base.contextualEvidence.newsRegulatory || []
  ];

  for (const family of claimFamilies) {
    for (const c of family) {
      availableEvidenceIds.add(c.evidenceId);
    }
  }

  if (Array.isArray(base.sourceReferences)) {
    for (const sr of base.sourceReferences) {
      if (sr && sr.referenceId) {
        availableEvidenceIds.add(sr.referenceId);
      }
    }
  }

  if (artifact.priorBriefRef && artifact.priorBriefRef.briefId) {
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
  } else {
    bundleCopy.assessment.coverage.researchBrief = "available";

    // Remove only RESEARCH_BRIEF_UNAVAILABLE warning if present
    bundleCopy.assessment.warnings = bundleCopy.assessment.warnings.filter(
      (w) => w.code !== "RESEARCH_BRIEF_UNAVAILABLE"
    );
  }

  return bundleCopy;
}
