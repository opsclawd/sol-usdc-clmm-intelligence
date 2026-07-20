export { EVIDENCE_BUNDLE_SELECTION_VERSION, selectEvidenceFeatureSlots } from "./select.js";

export type {
  SlotOutcome,
  SelectedAvailableSlot,
  SelectedPartialSlot,
  SelectedUnavailableSlot,
  MissingSlot,
  ExpiredOnlySlot,
  UnsupportedVersionOnlySlot,
  SelectedFeatureSlot,
  BundleSelectionRequest,
  BundleSelectionResult
} from "./select.js";

export { verifyEvidenceLineage } from "./lineage.js";

export type {
  VerifyEvidenceLineageInput,
  VerifiedEvidenceLineage,
  VerifiedLineageSourceRef,
  LineageVerificationError,
  LineageVerificationErrorCode
} from "./lineage.js";
