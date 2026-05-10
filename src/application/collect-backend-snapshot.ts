import type { HttpClient } from '../ports/http.js';
import type { JsonStore } from '../ports/json-store.js';
import type { EnvReader } from '../ports/env.js';

export interface CollectBackendSnapshotDeps {
  http: HttpClient;
  jsonStore: JsonStore;
  env: EnvReader;
}

export interface CollectBackendSnapshotResult {
  failures: Error[];
}

interface SnapshotTarget {
  path: string;
  url: string;
}

export async function collectBackendSnapshot(
  deps: CollectBackendSnapshotDeps
): Promise<CollectBackendSnapshotResult> {
  const { http, jsonStore, env } = deps;
  const base = env.get('CLMM_DATA_API_BASE');
  const normalized = base.replace(/\/$/, '');

  const targets: SnapshotTarget[] = [
    { path: 'data/latest-pool-snapshot.json', url: `${normalized}/api/clmm/sol-usdc/pool-snapshot` },
    { path: 'data/latest-position-snapshot.json', url: `${normalized}/api/clmm/sol-usdc/position-snapshot` },
    { path: 'data/latest-performance-snapshot.json', url: `${normalized}/api/clmm/sol-usdc/performance-snapshot` }
  ];

  const settled = await Promise.allSettled(
    targets.map(async (target) => {
      const value = await http.getJson<unknown>(target.url);
      await jsonStore.writeJson(target.path, value);
    })
  );

  const failures = settled
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) =>
      result.reason instanceof Error ? result.reason : new Error(String(result.reason))
    );

  return { failures };
}