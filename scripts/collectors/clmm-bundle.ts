import { createNodeRuntime } from "../../src/adapters/node/composition-root.js";
import { clmmBundleJob } from "../../src/jobs/clmm-bundle-job.js";

async function main(): Promise<void> {
  const runtime = createNodeRuntime();
  await clmmBundleJob({
    http: runtime.http,
    jsonStore: runtime.jsonStore,
    env: runtime.env
  })();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
