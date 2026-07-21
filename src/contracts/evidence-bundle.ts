import type { EvidenceBundleV1 } from "./generated/evidence-bundle-v1.js";

export interface CanonicalEvidenceBundle {
  readonly payload: EvidenceBundleV1;
  readonly payloadCanonical: string;
  readonly payloadHash: string;
  readonly idempotencyKey: string;
  readonly schemaVersion: "evidence-bundle.v1";
}

export type EvidenceBundleContractError =
  | { readonly code: "UNSUPPORTED_SCHEMA_VERSION"; readonly schemaVersion: string }
  | { readonly code: "VALIDATION_ERROR"; readonly errors: unknown[] }
  | { readonly code: "CANONICALIZATION_ERROR"; readonly message: string }
  | {
      readonly code: "ASSET_HASH_MISMATCH";
      readonly assetPath: string;
      readonly expectedHash: string;
      readonly actualHash: string;
    };

export interface EvidenceBundleContract {
  validateCanonicalizeAndHash(candidate: unknown): Promise<CanonicalEvidenceBundle>;
}

export function isEvidenceBundleContractError(
  value: unknown
): value is EvidenceBundleContractError {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    obj.code === "UNSUPPORTED_SCHEMA_VERSION" ||
    obj.code === "VALIDATION_ERROR" ||
    obj.code === "CANONICALIZATION_ERROR" ||
    obj.code === "ASSET_HASH_MISMATCH"
  );
}
