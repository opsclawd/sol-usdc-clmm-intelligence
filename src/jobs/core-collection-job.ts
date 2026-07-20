import type { HttpClient } from "../ports/http.js";
import type { JsonStore } from "../ports/json-store.js";
import type { EnvReader } from "../ports/env.js";
import type { Clock } from "../ports/clock.js";
import type { RawObservationRepo } from "../ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../ports/normalized-observation-repo.js";
import type { RunIdFactory } from "../ports/run-id.js";
import { createCollectionRunContext } from "../application/create-collection-run-context.js";
import { collectCore } from "../application/collect-core.js";
import { collectClmmBundle } from "../application/collect-clmm-bundle.js";
import { collectPythPrice } from "../application/collect-pyth-price.js";
import { collectJupiterQuote } from "../application/collect-jupiter-quote.js";
import { collectOrcaPoolStatistics } from "../application/collect-orca-pool-statistics.js";
import {
  mapClmmSourceOutcome,
  mapPriceSourceOutcome,
  mapSourceError
} from "../application/source-outcome.js";
import type { CoreCollectionResult } from "../contracts/collection-run.js";

export interface CoreCollectionJobDeps {
  http: HttpClient;
  jsonStore: JsonStore;
  env: EnvReader;
  clock: Clock;
  rawObservationRepo: RawObservationRepo;
  normalizedObservationRepo: NormalizedObservationRepo;
  runIdFactory: RunIdFactory;
}

export function coreCollectionJob(
  deps: CoreCollectionJobDeps
): () => Promise<CoreCollectionResult> {
  return async () => {
    return runCoreCollectionJob(deps);
  };
}

export async function runCoreCollectionJob(
  deps: CoreCollectionJobDeps
): Promise<CoreCollectionResult> {
  const context = createCollectionRunContext({
    env: deps.env,
    clock: deps.clock,
    runIdFactory: deps.runIdFactory
  });

  return collectCore(
    {
      clmmV2: async (ctx) => {
        try {
          const result = await collectClmmBundle(deps, ctx);
          return mapClmmSourceOutcome(result);
        } catch (err) {
          return mapSourceError("clmm-v2", "clmm-v2-bundle", err);
        }
      },
      pyth: async (ctx) => {
        try {
          const result = await collectPythPrice(deps, ctx);
          return mapPriceSourceOutcome("pyth", "pyth-hermes", result);
        } catch (err) {
          return mapSourceError("pyth", "pyth-hermes", err);
        }
      },
      jupiter: async (ctx) => {
        try {
          const result = await collectJupiterQuote(deps, ctx);
          return mapPriceSourceOutcome("jupiter", "jupiter-quote", result);
        } catch (err) {
          return mapSourceError("jupiter", "jupiter-quote", err);
        }
      },
      orca: async (ctx) => {
        try {
          return await collectOrcaPoolStatistics(deps, ctx);
        } catch (err) {
          return mapSourceError("orca", "orca-public-api", err);
        }
      }
    },
    context
  );
}
