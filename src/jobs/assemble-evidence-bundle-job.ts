import {
  assembleEvidenceBundle,
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
      const result = await assembleEvidenceBundle(deps, request);
      return result;
    } catch (err) {
      throw new Error(`Evidence bundle assembly failed: ${err}`);
    }
  };
}
