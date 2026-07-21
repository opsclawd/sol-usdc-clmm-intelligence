import {
  publishEvidenceBundle,
  type PublishEvidenceBundleDeps,
  type PublishEvidenceBundleResult
} from "../application/publish-evidence-bundle.js";

export interface PublishEvidenceBundleJobDeps extends Omit<PublishEvidenceBundleDeps, "clock"> {
  readonly clock: PublishEvidenceBundleDeps["clock"];
}

export type PublishEvidenceBundleJobResult = PublishEvidenceBundleResult;

export function publishEvidenceBundleJob(
  deps: PublishEvidenceBundleJobDeps
): () => Promise<PublishEvidenceBundleJobResult> {
  return async () => {
    try {
      const result = await publishEvidenceBundle(deps);
      return result;
    } catch (err) {
      throw new Error(
        `Evidence bundle publishing failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };
}
