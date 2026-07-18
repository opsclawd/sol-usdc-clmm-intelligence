import { createNodeRuntime, type NodeRuntime } from "../../src/adapters/node/composition-root.js";
import { clmmBundleJob } from "../../src/jobs/clmm-bundle-job.js";
import type { CollectClmmBundleDeps } from "../../src/application/collect-clmm-bundle.js";
import type { CollectClmmBundleResult } from "../../src/application/collect-clmm-bundle.js";

export async function runClmmBundleCollector(
  runtime: NodeRuntime
): Promise<CollectClmmBundleResult> {
  const { connection, rawObservationRepo, normalizedObservationRepo } =
    await runtime.getPersistence();
  const deps: CollectClmmBundleDeps = {
    http: runtime.http,
    jsonStore: runtime.jsonStore,
    env: runtime.env,
    clock: runtime.clock,
    rawObservationRepo,
    normalizedObservationRepo
  };
  let collectionError: unknown;
  let result: CollectClmmBundleResult | undefined;
  try {
    result = await clmmBundleJob(deps)();
  } catch (err) {
    collectionError = err;
  } finally {
    try {
      await connection.close();
    } catch (closeError) {
      console.error("Failed to close database connection:", closeError);
      if (result !== undefined) {
        console.error("Collection result before close failure:", result);
      }
    }
  }
  if (collectionError !== undefined) {
    throw collectionError;
  }
  return result!;
}

async function main(): Promise<void> {
  const runtime = createNodeRuntime();
  await runClmmBundleCollector(runtime);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
