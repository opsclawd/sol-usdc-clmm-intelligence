import type {
  ObservationKind,
  FeatureKind,
  ProvenanceRef,
  ProvenanceRefType,
  ProcessRef,
  ProvenanceRequirements,
  ProvenanceValidationError,
  ProvenanceValidationResult,
  Source
} from "../../contracts/taxonomy.js";

export type ArtifactKind = ObservationKind | FeatureKind | "evidence_bundle" | "research_brief";

const VALID_REF_TYPES: readonly ProvenanceRefType[] = [
  "raw_observation",
  "normalized_observation",
  "derived_feature",
  "evidence_bundle",
  "research_brief"
];

export function isValidProvenanceRef(ref: unknown): ref is ProvenanceRef {
  if (typeof ref !== "object" || ref === null) return false;
  const r = ref as Record<string, unknown>;
  return (
    typeof r.refType === "string" &&
    (VALID_REF_TYPES as readonly string[]).includes(r.refType) &&
    typeof r.id === "number" &&
    typeof r.source === "string" &&
    typeof r.payloadHash === "string"
  );
}

export function isValidProvenanceContainer(value: unknown): value is {
  sourceRefs: readonly unknown[];
  rawObservationRefs: readonly unknown[];
  derivedFromRefs: readonly unknown[];
  processRef: Record<string, unknown>;
  codeVersion: string;
  runId: string | null;
} {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.sourceRefs) &&
    Array.isArray(v.rawObservationRefs) &&
    Array.isArray(v.derivedFromRefs) &&
    typeof v.processRef === "object" &&
    v.processRef !== null &&
    typeof v.codeVersion === "string" &&
    (v.runId === null || typeof v.runId === "string")
  );
}

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

  if (!isValidProvenanceContainer(provenance)) {
    return { valid: false, reasons: ["invalid_provenance_shape"] };
  }

  const totalRefs =
    provenance.sourceRefs.length +
    provenance.rawObservationRefs.length +
    provenance.derivedFromRefs.length;
  if (totalRefs === 0) {
    errors.push("empty_provenance");
  }

  let hasMalformedRef = false;
  const allRefs = [
    ...provenance.sourceRefs,
    ...provenance.rawObservationRefs,
    ...provenance.derivedFromRefs
  ];
  for (const ref of allRefs) {
    if (!isValidProvenanceRef(ref)) {
      errors.push("malformed_ref");
      hasMalformedRef = true;
      break;
    }
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
    const { collector, jobName } = provenance.processRef;
    if (
      typeof collector !== "string" ||
      collector === "" ||
      typeof jobName !== "string" ||
      jobName === ""
    ) {
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

  if (requirements.allowedSourceRefs.length > 0 && !hasMalformedRef) {
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
