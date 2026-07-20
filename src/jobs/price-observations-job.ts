import {
  collectPriceObservations,
  type CollectPriceObservationsDeps,
  type CollectPriceObservationsResult
} from "../application/collect-price-observations.js";

import type { RunIdFactory } from "../ports/run-id.js";
import { createCollectionRunContext } from "../application/create-collection-run-context.js";

export interface PriceObservationsJobDeps extends CollectPriceObservationsDeps {
  runIdFactory: RunIdFactory;
}

export function priceObservationsJob(
  deps: PriceObservationsJobDeps
): () => Promise<CollectPriceObservationsResult> {
  return async () => {
    return runPriceObservationsJob(deps);
  };
}

export async function runPriceObservationsJob(
  deps: PriceObservationsJobDeps
): Promise<CollectPriceObservationsResult> {
  const context = createCollectionRunContext({
    env: deps.env,
    clock: deps.clock,
    runIdFactory: deps.runIdFactory
  });
  return collectPriceObservations(deps, context);
}
