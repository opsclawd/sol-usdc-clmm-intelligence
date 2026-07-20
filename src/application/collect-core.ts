import type {
  CollectionRunContext,
  CoreCollectionResult,
  SourceCollectionOutcome,
  CoreSourceKey
} from "../contracts/collection-run.js";
import type { Source } from "../contracts/taxonomy.js";
import { mapSourceError } from "./source-outcome.js";
import {
  reduceCoreCollectionStatus,
  countCoreCollectionOutcomes,
  orderCoreWarnings
} from "../domain/core-collection/reduce.js";

export type CoreLeaf = (context: CollectionRunContext) => Promise<SourceCollectionOutcome>;

export interface CollectCoreDeps {
  readonly clmmV2: CoreLeaf;
  readonly pyth: CoreLeaf;
  readonly jupiter: CoreLeaf;
  readonly orca: CoreLeaf;
}

const PROVENANCE_SOURCES: Record<CoreSourceKey, Source> = {
  "clmm-v2": "clmm-v2-bundle",
  pyth: "pyth-hermes",
  jupiter: "jupiter-quote",
  orca: "orca-public-api"
};

export async function collectCore(
  deps: CollectCoreDeps,
  context: CollectionRunContext
): Promise<CoreCollectionResult> {
  // Start all four promises before awaiting any, and guard each rejection independently
  const clmmV2Promise = deps
    .clmmV2(context)
    .catch((err) => mapSourceError("clmm-v2", PROVENANCE_SOURCES["clmm-v2"], err));

  const pythPromise = deps
    .pyth(context)
    .catch((err) => mapSourceError("pyth", PROVENANCE_SOURCES.pyth, err));

  const jupiterPromise = deps
    .jupiter(context)
    .catch((err) => mapSourceError("jupiter", PROVENANCE_SOURCES.jupiter, err));

  const orcaPromise = deps
    .orca(context)
    .catch((err) => mapSourceError("orca", PROVENANCE_SOURCES.orca, err));

  // Await the guarded promises together
  const [clmmV2, pyth, jupiter, orca] = await Promise.all([
    clmmV2Promise,
    pythPromise,
    jupiterPromise,
    orcaPromise
  ]);

  const outcomes = [clmmV2, pyth, jupiter, orca];

  // Pass fixed outcomes to the pure helpers
  const status = reduceCoreCollectionStatus(outcomes);
  const counts = countCoreCollectionOutcomes(outcomes);

  // Extract all warnings and order them
  const allWarnings = outcomes.flatMap((o) => o.warnings);
  const orderedWarnings = orderCoreWarnings(allWarnings);

  // Derive shouldFailCommand from overall status
  const shouldFailCommand = status === "FAILED" || status === "UNAVAILABLE";

  return {
    context,
    clmmV2,
    pyth,
    jupiter,
    orca,
    warnings: orderedWarnings,
    counts,
    status,
    shouldFailCommand
  };
}
