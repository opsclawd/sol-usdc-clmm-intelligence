import { createNodeRuntime } from '../../src/adapters/node/composition-root.js';
import { backendSnapshotJob } from '../../src/jobs/backend-snapshot-job.js';

async function main(): Promise<void> {
  const runtime = createNodeRuntime();
  const result = await backendSnapshotJob({
    http: runtime.http,
    jsonStore: runtime.jsonStore,
    env: runtime.env
  })();
  if (result.failures.length > 0) {
    for (const failure of result.failures) {
      console.error(failure);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});