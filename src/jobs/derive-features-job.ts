import {
  deriveMvpFeatures,
  type DeriveMvpFeaturesDeps,
  type DeriveMvpFeaturesRequest,
  type DeriveMvpFeaturesResult
} from "../application/derive-mvp-features.js";

export interface DeriveFeaturesJobDeps extends DeriveMvpFeaturesDeps {
  readonly poolId: string;
  readonly positionIds: readonly string[];
  readonly pipelineRunId: string;
  readonly codeVersion: string;
}

export interface DeriveFeaturesJobResult {
  readonly rows: DeriveMvpFeaturesResult["rows"];
  readonly counts: Readonly<Record<string, number>>;
  readonly warnings: readonly string[];
}

export function deriveFeaturesJob(
  deps: DeriveFeaturesJobDeps
): () => Promise<DeriveFeaturesJobResult> {
  return async () => {
    try {
      const request: DeriveMvpFeaturesRequest = {
        pair: "SOL/USDC",
        poolId: deps.poolId,
        positionIds: deps.positionIds,
        pipelineRunId: deps.pipelineRunId,
        codeVersion: deps.codeVersion
      };
      const result = await deriveMvpFeatures(deps, request);
      return result;
    } catch (err) {
      throw new Error(`Feature derivation failed: ${err}`);
    }
  };
}
