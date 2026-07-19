import type { HttpClient } from "../ports/http.js";
import type { JsonStore } from "../ports/json-store.js";
import type { EnvReader } from "../ports/env.js";
import type { Clock } from "../ports/clock.js";
import type { RawObservationRepo } from "../ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../ports/normalized-observation-repo.js";
import { collectJupiterQuote, type CollectJupiterQuoteDeps } from "./collect-jupiter-quote.js";
import type { PriceSourceResult } from "./price-source-result.js";

/** @deprecated Use collectJupiterQuote instead */
export interface CollectJupiterPriceDeps {
  http: HttpClient;
  jsonStore: JsonStore;
  env: EnvReader;
  clock: Clock;
  rawObservationRepo?: RawObservationRepo;
  normalizedObservationRepo?: NormalizedObservationRepo;
}

export const PRICE_SNAPSHOT_PATH = "data/latest-price-snapshot.json";

/** @deprecated Use collectJupiterQuote instead */
export async function collectJupiterPrice(
  deps: CollectJupiterPriceDeps
): Promise<PriceSourceResult> {
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
  return collectJupiterQuote(resolvedDeps as CollectJupiterQuoteDeps);
}
