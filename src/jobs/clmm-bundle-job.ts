import {
  collectClmmBundle,
  type CollectClmmBundleDeps
} from "../application/collect-clmm-bundle.js";

import type { RunIdFactory } from "../ports/run-id.js";
import { createCollectionRunContext } from "../application/create-collection-run-context.js";
import { mapClmmSourceOutcome, mapSourceError } from "../application/source-outcome.js";
import type { SourceCollectionOutcome } from "../contracts/collection-run.js";

export interface ClmmBundleJobDeps extends CollectClmmBundleDeps {
  runIdFactory: RunIdFactory;
}

export function clmmBundleJob(deps: ClmmBundleJobDeps): () => Promise<SourceCollectionOutcome> {
  return async () => {
    const context = createCollectionRunContext({
      env: deps.env,
      clock: deps.clock,
      runIdFactory: deps.runIdFactory
    });
    try {
      const result = await collectClmmBundle(deps, context);
      return mapClmmSourceOutcome(result);
    } catch (err) {
      return mapSourceError("clmm-v2", "clmm-v2-bundle", err);
    }
  };
}
