import type {
  CanonicalEvidenceBundle,
  EvidenceBundleContractError
} from "../contracts/evidence-bundle.js";

export interface EvidenceBundleContract {
  validateCanonicalizeAndHash(candidate: unknown): Promise<CanonicalEvidenceBundle>;
}

export type { CanonicalEvidenceBundle, EvidenceBundleContractError };
