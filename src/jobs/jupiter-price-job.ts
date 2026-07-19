import {
  collectJupiterPrice,
  type CollectJupiterPriceDeps
} from "../application/collect-jupiter-price.js";
import type { PriceSourceResult } from "../application/price-source-result.js";

export function jupiterPriceJob(deps: CollectJupiterPriceDeps): () => Promise<PriceSourceResult> {
  return async () => {
    const resolvedDeps = { ...deps };
    if (!resolvedDeps.rawObservationRepo || !resolvedDeps.normalizedObservationRepo) {
      const rootPath = "../adapters/node/composition-root.js";
      const { createNodeRuntime } = await import(rootPath);
      const runtime = createNodeRuntime();
      const persistence = await runtime.getPersistence();
      resolvedDeps.rawObservationRepo =
        resolvedDeps.rawObservationRepo ?? persistence.rawObservationRepo;
      resolvedDeps.normalizedObservationRepo =
        resolvedDeps.normalizedObservationRepo ?? persistence.normalizedObservationRepo;
    }
    return collectJupiterPrice(resolvedDeps);
  };
}
