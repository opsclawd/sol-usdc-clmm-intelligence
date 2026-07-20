import { createNodeRuntime, type NodeRuntime } from "../../src/adapters/node/composition-root.js";
import {
  deriveMvpFeaturesJob,
  type DeriveMvpFeaturesJobResult
} from "../../src/jobs/derive-mvp-features-job.js";

export async function runDeriveMvpFeaturesScript(
  runtime: NodeRuntime
): Promise<DeriveMvpFeaturesJobResult> {
  const poolId = runtime.env.get("WHIRLPOOL_ADDRESS");

  const rawPositionIds = runtime.env.getOptional("INTELLIGENCE_POSITION_IDS") ?? "";
  const positionIds = rawPositionIds
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  if (positionIds.length === 0) {
    throw new Error("INTELLIGENCE_POSITION_IDS cannot be empty");
  }

  const uniquePositionIds = [...new Set(positionIds)];

  const codeVersion = runtime.env.getOptional("INTELLIGENCE_CODE_VERSION") ?? "development";

  const { connection, normalizedObservationRepo, featureRepo } = await runtime.getPersistence();

  const job = deriveMvpFeaturesJob({
    clock: runtime.clock,
    normalizedObservationRepo,
    featureRepo,
    runIdFactory: runtime.runIdFactory
  });

  let derivationError: unknown;
  let result: DeriveMvpFeaturesJobResult | undefined;
  let closeError: unknown;

  try {
    result = await job({
      poolId,
      positionIds: uniquePositionIds,
      codeVersion
    });
  } catch (err) {
    derivationError = err;
  } finally {
    try {
      await connection.close();
    } catch (err) {
      closeError = err;
    }
  }

  if (derivationError !== undefined) {
    throw derivationError;
  }

  if (closeError !== undefined) {
    throw closeError;
  }

  const output = {
    counts: result!.counts,
    warnings: [...(result!.warnings ?? [])].sort()
  };

  console.log(JSON.stringify(output, null, 2));

  return result!;
}

async function main(): Promise<void> {
  const runtime = createNodeRuntime();

  try {
    await runDeriveMvpFeaturesScript(runtime);
  } catch (error) {
    console.error("MVP feature derivation failed:", error);
    process.exitCode = 1;
  }
}

main();
