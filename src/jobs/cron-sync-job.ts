import { syncCron, type SyncCronDeps, type SyncCronResult } from "../application/sync-cron.js";

export function cronSyncJob(deps: SyncCronDeps): () => Promise<SyncCronResult> {
  return () => syncCron(deps);
}
