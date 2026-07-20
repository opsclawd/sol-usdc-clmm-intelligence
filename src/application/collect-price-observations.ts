import type { PriceSourceResult } from "./price-source-result.js";
import type { SourceCollectionOutcome } from "../contracts/collection-run.js";
import { mapPriceSourceOutcome } from "./source-outcome.js";
import { PostPersistenceOutputError } from "./ingest-raw-observation.js";
import type { HttpClient } from "../ports/http.js";
import type { JsonStore } from "../ports/json-store.js";
import type { EnvReader } from "../ports/env.js";
import type { Clock } from "../ports/clock.js";
import type { RawObservationRepo } from "../ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../ports/normalized-observation-repo.js";
import { collectPythPrice, type CollectPythPriceDeps } from "./collect-pyth-price.js";
import { collectJupiterQuote, type CollectJupiterQuoteDeps } from "./collect-jupiter-quote.js";

export interface CollectPriceObservationsDeps {
  http: HttpClient;
  jsonStore: JsonStore;
  env: EnvReader;
  clock: Clock;
  rawObservationRepo: RawObservationRepo;
  normalizedObservationRepo: NormalizedObservationRepo;
}

export interface CollectPriceObservationsResult {
  readonly pyth: SourceCollectionOutcome;
  readonly jupiter: SourceCollectionOutcome;
  readonly warnings: readonly string[];
  readonly isPartial: boolean;
  readonly usableSourceCount: number;
  readonly shouldFailCommand: boolean;
}

function isUsable(result: PriceSourceResult): boolean {
  return result.status === "accepted" || result.status === "identical_replay";
}

import type { CollectionRunContext } from "./create-collection-run-context.js";

export async function collectPriceObservations(
  deps: CollectPriceObservationsDeps,
  context: CollectionRunContext
): Promise<CollectPriceObservationsResult> {
  const fullDeps = deps as CollectPythPriceDeps & CollectJupiterQuoteDeps;

  // Starts both independent source pipelines before awaiting either result
  const pythPromise = collectPythPrice(fullDeps, context).catch((err): PriceSourceResult => {
    if (err instanceof Error && err.name === "PostPersistenceOutputError") {
      const ppe = err as PostPersistenceOutputError;
      return {
        status: "failed",
        summary: ppe.message,
        durableEvidence: {
          rawObservationId: ppe.rawObservationId,
          normalizedCount: ppe.normalizedCount
        },
        hasUsableEvidence: true
      };
    }
    return { status: "failed", summary: err instanceof Error ? err.message : String(err) };
  });

  const jupiterPromise = collectJupiterQuote(fullDeps, context).catch((err): PriceSourceResult => {
    if (err instanceof Error && err.name === "PostPersistenceOutputError") {
      const ppe = err as PostPersistenceOutputError;
      return {
        status: "failed",
        summary: ppe.message,
        durableEvidence: {
          rawObservationId: ppe.rawObservationId,
          normalizedCount: ppe.normalizedCount
        },
        hasUsableEvidence: true
      };
    }
    return { status: "failed", summary: err instanceof Error ? err.message : String(err) };
  });

  const [pythResult, jupiterResult] = await Promise.all([pythPromise, jupiterPromise]);

  const usablePyth = isUsable(pythResult);
  const usableJupiter = isUsable(jupiterResult);

  let usableSourceCount = 0;
  if (usablePyth) usableSourceCount++;
  if (usableJupiter) usableSourceCount++;

  const isPartial = !usablePyth || !usableJupiter;
  const hasConflict = pythResult.status === "conflict" || jupiterResult.status === "conflict";
  const shouldFailCommand = usableSourceCount === 0 || hasConflict;

  // Build aggregate warnings
  const warningsList: string[] = [];

  // Pyth warnings
  if (
    pythResult.status === "accepted" ||
    pythResult.status === "identical_replay" ||
    pythResult.status === "stale" ||
    pythResult.status === "degraded"
  ) {
    if (pythResult.warnings && pythResult.warnings.length > 0) {
      for (const w of pythResult.warnings) {
        warningsList.push(`pyth: ${w}`);
      }
    }
    if (pythResult.status === "degraded") {
      warningsList.push(`pyth: degraded - ${pythResult.reason}`);
    }
    if (pythResult.status === "stale") {
      warningsList.push(`pyth: stale - ${pythResult.freshness.reasons.join(", ")}`);
    }
  } else {
    // failure statuses
    warningsList.push(`pyth: Hermes ${pythResult.summary}`);
  }

  // Jupiter warnings
  if (
    jupiterResult.status === "accepted" ||
    jupiterResult.status === "identical_replay" ||
    jupiterResult.status === "stale" ||
    jupiterResult.status === "degraded"
  ) {
    if (jupiterResult.warnings && jupiterResult.warnings.length > 0) {
      for (const w of jupiterResult.warnings) {
        warningsList.push(`jupiter: ${w}`);
      }
    }
    if (jupiterResult.status === "degraded") {
      warningsList.push(`jupiter: degraded - ${jupiterResult.reason}`);
    }
    if (jupiterResult.status === "stale") {
      warningsList.push(`jupiter: stale - ${jupiterResult.freshness.reasons.join(", ")}`);
    }
  } else {
    // failure statuses
    warningsList.push(`jupiter: quote ${jupiterResult.summary}`);
  }

  // Deterministic warning ordering (alphabetical)
  warningsList.sort();

  const pythOutcome = mapPriceSourceOutcome("pyth", "pyth-hermes", pythResult);
  const jupiterOutcome = mapPriceSourceOutcome("jupiter", "jupiter-quote", jupiterResult);

  return {
    pyth: pythOutcome,
    jupiter: jupiterOutcome,
    warnings: warningsList,
    isPartial,
    usableSourceCount,
    shouldFailCommand
  };
}
