import { createNodeRuntime, type NodeRuntime } from "../../src/adapters/node/composition-root.js";
import {
  deriveFeaturesJob,
  type DeriveFeaturesJobDeps
} from "../../src/jobs/derive-features-job.js";

export async function runDeriveFeaturesJob(
  runtime: NodeRuntime,
  poolId: string,
  positionIds: readonly string[],
  codeVersion: string
): Promise<void> {
  const { connection, normalizedObservationRepo, featureRepo } = await runtime.getPersistence();

  const pipelineRunId = crypto.randomUUID();

  const deps: DeriveFeaturesJobDeps = {
    clock: runtime.clock,
    normalizedObservationRepo,
    featureRepo,
    pipelineRunId,
    codeVersion,
    poolId,
    positionIds
  };

  const job = deriveFeaturesJob(deps);
  const result = await job();

  console.log(`Feature derivation complete:`);
  console.log(`  Available: ${result.counts["AVAILABLE"] ?? 0}`);
  console.log(`  Partial: ${result.counts["PARTIAL"] ?? 0}`);
  console.log(`  Unavailable: ${result.counts["UNAVAILABLE"] ?? 0}`);
  console.log(`  Total rows: ${result.rows.length}`);

  await connection.close();
}

async function main(): Promise<void> {
  const runtime = createNodeRuntime();

  const poolId = process.argv[2] ?? "SOL/USDC";
  const positionIds = process.argv[3]?.split(",") ?? [];
  const codeVersion = process.argv[4] ?? "1.0.0";

  if (positionIds.length === 0) {
    console.error(
      "Usage: tsx scripts/collectors/derive-features.ts <poolId> <positionIds> <codeVersion>"
    );
    console.error("  poolId: Pool ID (default: SOL/USDC)");
    console.error("  positionIds: Comma-separated list of position IDs (default: none)");
    console.error("  codeVersion: Version string (default: 1.0.0)");
    process.exitCode = 1;
    return;
  }

  try {
    await runDeriveFeaturesJob(runtime, poolId, positionIds, codeVersion);
  } catch (error) {
    console.error("Feature derivation failed:", error);
    process.exitCode = 1;
  }
}

main();
