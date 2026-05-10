import { createNodeRuntime } from '../../src/adapters/node/composition-root.js';
import { coingeckoJob } from '../../src/jobs/coingecko-job.js';

async function main(): Promise<void> {
  const runtime = createNodeRuntime();
  await coingeckoJob({
    http: runtime.http,
    jsonStore: runtime.jsonStore,
    env: runtime.env,
    clock: runtime.clock
  })();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});