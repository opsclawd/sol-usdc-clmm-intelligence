import {
  collectPriceObservations,
  type CollectPriceObservationsDeps,
  type CollectPriceObservationsResult
} from "../application/collect-price-observations.js";

export function priceObservationsJob(
  deps: CollectPriceObservationsDeps
): () => Promise<CollectPriceObservationsResult> {
  return async () => {
    return runPriceObservationsJob(deps);
  };
}

export async function runPriceObservationsJob(
  deps: CollectPriceObservationsDeps
): Promise<CollectPriceObservationsResult> {
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
  return collectPriceObservations(resolvedDeps);
}
