import {
  prepareEvidenceBundle,
  finalizeEvidenceBundle,
  type AssembleEvidenceBundleDeps,
  type AssembleEvidenceBundleRequest,
  type AssembleEvidenceBundleResult
} from "../application/assemble-evidence-bundle.js";
import type { Clock } from "../ports/clock.js";

export interface AssembleEvidenceBundleJobDeps extends Omit<AssembleEvidenceBundleDeps, "clock"> {
  readonly clock: Clock;
}

export interface AssembleEvidenceBundleJobRequest extends AssembleEvidenceBundleRequest {}

export type AssembleEvidenceBundleJobResult = AssembleEvidenceBundleResult;

export function assembleEvidenceBundleJob(
  deps: AssembleEvidenceBundleJobDeps
): (request: AssembleEvidenceBundleJobRequest) => Promise<AssembleEvidenceBundleJobResult> {
  return async (request) => {
    try {
      const preparedResult = await prepareEvidenceBundle(deps, request);
      if ("code" in preparedResult) {
        return preparedResult;
      }
      if (preparedResult.outcome === "prepared") {
        return await finalizeEvidenceBundle(deps, preparedResult.prepared);
      }
      return preparedResult;
    } catch (err) {
      throw new Error(`Evidence bundle assembly failed: ${err}`);
    }
  };
}
