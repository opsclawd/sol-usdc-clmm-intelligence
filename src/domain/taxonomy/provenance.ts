import type {
  ObservationKind,
  FeatureKind,
  ProvenanceRef,
  ProcessRef,
  ProvenanceRequirements,
  ProvenanceValidationError,
  ProvenanceValidationResult,
  Source
} from "../../contracts/taxonomy.js";

export type ArtifactKind = ObservationKind | FeatureKind | "evidence_bundle" | "research_brief";

export function validateProvenance(
  provenance: {
    sourceRefs: readonly ProvenanceRef[];
    rawObservationRefs: readonly ProvenanceRef[];
    derivedFromRefs: readonly ProvenanceRef[];
    processRef: ProcessRef;
    codeVersion: string;
    runId: string | null;
  },
  requirements: ProvenanceRequirements,
  _artifactKind: ArtifactKind
): ProvenanceValidationResult {
  void _artifactKind;
  const errors: ProvenanceValidationError[] = [];

  const totalRefs =
    provenance.sourceRefs.length +
    provenance.rawObservationRefs.length +
    provenance.derivedFromRefs.length;
  if (totalRefs === 0) {
    errors.push("empty_provenance");
  }

  if (provenance.rawObservationRefs.length < requirements.minRawObservationRefs) {
    errors.push("insufficient_raw_observation_refs");
  }

  if (provenance.derivedFromRefs.length < requirements.minDerivedFromRefs) {
    errors.push("insufficient_derived_from_refs");
  }

  if (provenance.sourceRefs.length < requirements.minSourceRefs) {
    errors.push("insufficient_source_refs");
  }

  if (requirements.requireProcessRef) {
    if (provenance.processRef.collector === "" || provenance.processRef.jobName === "") {
      errors.push("missing_process_ref");
    }
  }

  if (
    requirements.requireCodeVersion &&
    (!provenance.codeVersion || provenance.codeVersion === "")
  ) {
    errors.push("missing_code_version");
  }

  if (requirements.requireRunId && provenance.runId === null) {
    errors.push("missing_run_id");
  }

  if (requirements.allowedSourceRefs.length > 0) {
    const allRefs = [
      ...provenance.sourceRefs,
      ...provenance.rawObservationRefs,
      ...provenance.derivedFromRefs
    ];
    for (const ref of allRefs) {
      if (!isAllowedSource(ref.source, requirements.allowedSourceRefs)) {
        errors.push("disallowed_source");
        break;
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, reasons: errors };
  }

  return { valid: true };
}

function isAllowedSource(source: Source, allowed: readonly Source[]): boolean {
  return allowed.includes(source);
}
