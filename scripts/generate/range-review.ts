import { createNodeRuntime } from '../../src/adapters/node/composition-root.js';
import { rangeReviewJob } from '../../src/jobs/range-review-job.js';

async function main(): Promise<void> {
  const runtime = createNodeRuntime();
  const output = await rangeReviewJob({
    jsonStore: runtime.jsonStore,
    clock: runtime.clock
  })();
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});