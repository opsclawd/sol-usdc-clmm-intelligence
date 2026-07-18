import {
  collectClmmBundle,
  type CollectClmmBundleDeps,
  type CollectClmmBundleResult
} from "../application/collect-clmm-bundle.js";

export function clmmBundleJob(deps: CollectClmmBundleDeps): () => Promise<CollectClmmBundleResult> {
  return () => collectClmmBundle(deps);
}
