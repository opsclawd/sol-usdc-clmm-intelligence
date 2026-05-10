import { createNodeRuntime } from "../../src/adapters/node/composition-root.js";
import { jupiterPriceJob } from "../../src/jobs/jupiter-price-job.js";

async function main(): Promise<void> {
  const runtime = createNodeRuntime();
  await jupiterPriceJob({
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
