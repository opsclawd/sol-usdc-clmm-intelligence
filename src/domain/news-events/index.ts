export {
  acceptBoundedNewsRecord,
  type BoundedNewsSourceRecord,
  NewsValidationError
} from "./validate.js";

export { normalizeNewsRecord, type UnclusteredNewsEvidencePayload } from "./normalize.js";

export { deriveNewsObservationKey, type NewsObservationKeyInput } from "./identity.js";

export {
  enrichNewsEvidence,
  type NewsEnrichmentInput,
  type EnrichedNewsEvidenceObservation,
  NEWS_CONFIDENCE_WEIGHTING_VERSION
} from "./enrich.js";

export { clusterNewsEvidence, type ClusterNewsEvidenceInput } from "./cluster.js";
