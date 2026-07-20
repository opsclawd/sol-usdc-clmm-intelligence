import { createNodeRuntime, type NodeRuntime } from "../../src/adapters/node/composition-root.js";
import { clmmBundleJob, type ClmmBundleJobDeps } from "../../src/jobs/clmm-bundle-job.js";
import type { SourceCollectionOutcome } from "../../src/contracts/collection-run.js";

export async function runClmmBundleCollector(
  runtime: NodeRuntime
): Promise<SourceCollectionOutcome> {
  const { connection, rawObservationRepo, normalizedObservationRepo } =
    await runtime.getPersistence();
  const deps: ClmmBundleJobDeps = {
    http: runtime.http,
    jsonStore: runtime.jsonStore,
    env: runtime.env,
    clock: runtime.clock,
    rawObservationRepo,
    normalizedObservationRepo,
    runIdFactory: runtime.runIdFactory
  };
  let collectionError: unknown;
  let result: SourceCollectionOutcome | undefined;
  let closeError: unknown;
  try {
    result = await clmmBundleJob(deps)();
    if (result.status === "failed" || result.status === "conflict") {
      collectionError = new Error(result.diagnostic ?? "CLMM Bundle Collection failed");
    }
  } catch (err) {
    collectionError = err;
  } finally {
    try {
      await connection.close();
    } catch (err) {
      closeError = err;
      console.error("Failed to close database connection:", closeError);
      if (result !== undefined) {
        console.error("Collection result before close failure:", result);
      }
    }
  }
  if (collectionError !== undefined) {
    throw collectionError;
  }
  if (closeError !== undefined) {
    throw closeError;
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
