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
  return collectPriceObservations(deps);
}
