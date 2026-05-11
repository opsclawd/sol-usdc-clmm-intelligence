import {
  collectClmmBundle,
  type CollectClmmBundleDeps
} from "../application/collect-clmm-bundle.js";

export function clmmBundleJob(deps: CollectClmmBundleDeps): () => Promise<void> {
  return () => collectClmmBundle(deps);
}
