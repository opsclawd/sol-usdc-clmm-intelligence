import { createNodeRuntime } from "../../src/adapters/node/composition-root.js";
import { clmmBundleJob } from "../../src/jobs/clmm-bundle-job.js";
import type { CollectClmmBundleDeps } from "../../src/application/collect-clmm-bundle.js";

async function main(): Promise<void> {
  const runtime = createNodeRuntime();
  const deps: CollectClmmBundleDeps = {
    http: runtime.http,
    jsonStore: runtime.jsonStore,
    env: runtime.env,
    clock: runtime.clock,
    rawObservationRepo: null as unknown as CollectClmmBundleDeps["rawObservationRepo"],
    normalizedObservationRepo: null as unknown as CollectClmmBundleDeps["normalizedObservationRepo"]
  };
  await clmmBundleJob(deps)();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
