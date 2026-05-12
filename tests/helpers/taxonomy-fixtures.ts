import type {
  Confidence,
  Provenance,
  SignalClass,
  EvidenceFamily
} from "../../src/contracts/taxonomy.js";

export const DEFAULT_CONFIDENCE: Confidence = {
  components: {
    sourceReliability: 1,
    dataCompleteness: 1,
    derivationConfidence: 1,
    llmConfidence: null
  },
  compositeScore: 1,
  level: "high",
  weightingVersion: "v1",
  reasons: []
};

export const DEFAULT_PROVENANCE: Provenance = {
  sourceRefs: [],
  rawObservationRefs: [],
  derivedFromRefs: [],
  processRef: {
    collector: "test",
    jobName: "test",
    pipelineRunId: null,
    codeVersion: null,
    modelVersion: null
  },
  codeVersion: "test",
  runId: null
};

export const DEFAULT_SIGNAL_CLASS: SignalClass = "deterministic";
export const DEFAULT_EVIDENCE_FAMILY: EvidenceFamily = "clmm_state";
