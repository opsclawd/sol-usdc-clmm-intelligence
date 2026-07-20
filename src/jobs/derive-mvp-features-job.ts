import {
  deriveMvpFeatures,
  type DeriveMvpFeaturesDeps,
  type DeriveMvpFeaturesRequest,
  type DeriveMvpFeaturesResult
} from "../application/derive-mvp-features.js";
import type { RunIdFactory } from "../ports/run-id.js";

export interface DeriveMvpFeaturesJobDeps extends DeriveMvpFeaturesDeps {
  readonly runIdFactory: RunIdFactory;
}

export interface DeriveMvpFeaturesJobRequest {
  readonly poolId: string;
  readonly positionIds: readonly string[];
  readonly codeVersion?: string;
}

export interface DeriveMvpFeaturesJobResult {
  readonly rows: DeriveMvpFeaturesResult["rows"];
  readonly counts: Readonly<Record<string, number>>;
  readonly warnings: readonly string[];
}

export function deriveMvpFeaturesJob(
  deps: DeriveMvpFeaturesJobDeps
): (request: DeriveMvpFeaturesJobRequest) => Promise<DeriveMvpFeaturesJobResult> {
  return async (request) => {
    const pipelineRunId = deps.runIdFactory.nextRunId();
    try {
      const deriveRequest: DeriveMvpFeaturesRequest = {
        pair: "SOL/USDC",
        poolId: request.poolId,
        positionIds: request.positionIds,
        pipelineRunId,
        codeVersion: request.codeVersion ?? "development"
      };
      const result = await deriveMvpFeatures(deps, deriveRequest);
      return result;
    } catch (err) {
      throw new Error(`MVP feature derivation failed: ${err}`);
    }
  };
}
