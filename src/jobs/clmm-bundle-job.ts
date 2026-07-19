import {
  collectClmmBundle,
  type CollectClmmBundleDeps,
  type CollectClmmBundleResult
} from "../application/collect-clmm-bundle.js";

import type { RunIdFactory } from "../ports/run-id.js";
import { createCollectionRunContext } from "../application/create-collection-run-context.js";

export interface ClmmBundleJobDeps extends CollectClmmBundleDeps {
  runIdFactory: RunIdFactory;
}

export function clmmBundleJob(deps: ClmmBundleJobDeps): () => Promise<CollectClmmBundleResult> {
  return () => {
    const context = createCollectionRunContext({
      env: deps.env,
      clock: deps.clock,
      runIdFactory: deps.runIdFactory
    });
    return collectClmmBundle(deps, context);
  };
}
