export {
  acceptSupportResistanceSnapshot,
  SupportResistanceValidationError,
  type BoundedSupportResistanceSnapshot,
  type BoundedSupportResistanceClaim
} from "./validate.js";

export {
  normalizeSupportResistanceClaims,
  type ClaimRejection,
  type NormalizationResult
} from "./normalize.js";

export {
  deriveSupportResistanceSourceObservationKey,
  deriveSupportResistanceEquivalenceKey,
  type SupportResistanceSourceObservationIdentity,
  type SupportResistanceEquivalenceIdentity
} from "./identity.js";

export {
  enrichSupportResistanceClaim,
  type SupportResistanceEnrichmentInput,
  type EnrichedSupportResistanceObservation,
  COMPLETENESS_WEIGHTING_VERSION
} from "./enrich.js";
