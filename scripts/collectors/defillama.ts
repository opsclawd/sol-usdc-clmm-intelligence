import { createNodeRuntime } from '../../src/adapters/node/composition-root.js';
import { defillamaJob } from '../../src/jobs/defillama-job.js';

async function main(): Promise<void> {
  const runtime = createNodeRuntime();
  await defillamaJob({
    http: runtime.http,
    jsonStore: runtime.jsonStore,
    clock: runtime.clock
  })();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});