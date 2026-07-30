import { createNodeRuntime } from "../../src/adapters/node/composition-root.js";
import { cronRenderJob } from "../../src/jobs/cron-render-job.js";

async function main(): Promise<void> {
  const runtime = createNodeRuntime();
  const lines = await cronRenderJob({
    textReader: runtime.textReader,
    env: runtime.env
  })();
  for (const line of lines) {
    console.log(line);
    console.log("");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
