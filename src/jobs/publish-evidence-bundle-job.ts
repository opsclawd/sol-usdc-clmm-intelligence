import {
  publishEvidenceBundle,
  type PublishEvidenceBundleDeps,
  type PublishEvidenceBundleResult,
  type PublishEvidenceBundleRequest
} from "../application/publish-evidence-bundle.js";

export interface PublishEvidenceBundleJobDeps extends Omit<PublishEvidenceBundleDeps, "clock"> {
  readonly clock: PublishEvidenceBundleDeps["clock"];
}

export type PublishEvidenceBundleJobResult = PublishEvidenceBundleResult;

export function publishEvidenceBundleJob(
  deps: PublishEvidenceBundleJobDeps
): (request: PublishEvidenceBundleRequest) => Promise<PublishEvidenceBundleJobResult> {
  return async (request: PublishEvidenceBundleRequest) => {
    try {
      const result = await publishEvidenceBundle(deps, request);
      return result;
    } catch (err) {
      throw new Error(
        `Evidence bundle publishing failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };
}
