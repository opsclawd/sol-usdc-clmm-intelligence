import {
  collectBackendSnapshot,
  type CollectBackendSnapshotDeps,
  type CollectBackendSnapshotResult
} from "../application/collect-backend-snapshot.js";

export function backendSnapshotJob(
  deps: CollectBackendSnapshotDeps
): () => Promise<CollectBackendSnapshotResult> {
  return () => collectBackendSnapshot(deps);
}
