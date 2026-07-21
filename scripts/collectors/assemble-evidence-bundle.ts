import { createNodeRuntime, type NodeRuntime } from "../../src/adapters/node/composition-root.js";
import {
  assembleEvidenceBundleJob,
  type AssembleEvidenceBundleJobResult
} from "../../src/jobs/assemble-evidence-bundle-job.js";
import type { AssembleEvidenceBundleJobRequest } from "../../src/jobs/assemble-evidence-bundle-job.js";

export interface RedactedOutcome {
  outcome: string;
  rowId?: number;
  payloadHash?: string;
  slotCount?: number;
  warnings: readonly string[];
  incomingPayloadHash?: string;
}

function redactedOutcomeFromResult(result: AssembleEvidenceBundleJobResult): RedactedOutcome {
  if ("code" in result) {
    return {
      outcome: "error",
      warnings: [result.code]
    };
  }
  switch (result.outcome) {
    case "persisted":
      return {
        outcome: result.outcome,
        rowId: result.rowId,
        payloadHash: result.payloadHash,
        slotCount: result.slotCount,
        warnings: result.warnings
      };
    case "identical_replay":
      return {
        outcome: result.outcome,
        rowId: result.rowId,
        payloadHash: result.payloadHash,
        slotCount: result.slotCount,
        warnings: result.warnings
      };
    case "conflict":
      return {
        outcome: result.outcome,
        rowId: result.rowId,
        incomingPayloadHash: result.incomingPayloadHash,
        warnings: []
      };
    case "no_bundle":
      return {
        outcome: result.outcome,
        warnings: []
      };
    default:
      return {
        outcome: "error",
        warnings: ["unknown error"]
      };
  }
}

export async function runAssembleEvidenceBundleScript(
  runtime: NodeRuntime,
  requestPath: string
): Promise<RedactedOutcome> {
  let parsedRequest: AssembleEvidenceBundleJobRequest;
  try {
    parsedRequest = (await runtime.jsonStore.readJson(
      requestPath
    )) as AssembleEvidenceBundleJobRequest;
  } catch (err) {
    console.error(
      "Failed to parse request JSON:",
      err instanceof Error ? err.message : String(err)
    );
    process.exitCode = 1;
    process.exit(1);
    return {
      outcome: "error",
      warnings: ["request_parse_failed"]
    };
  }

  if (!parsedRequest.pair || parsedRequest.pair !== "SOL/USDC") {
    console.error("Invalid request: pair must be SOL/USDC");
    process.exitCode = 1;
    process.exit(1);
    return {
      outcome: "error",
      warnings: ["wrong_pair"]
    };
  }

  if (!parsedRequest.pipelineRunId || !parsedRequest.schemaVersion) {
    console.error("Invalid request: missing required identity or version fields");
    process.exitCode = 1;
    process.exit(1);
    return {
      outcome: "error",
      warnings: ["missing_required_fields"]
    };
  }

  if (parsedRequest.schemaVersion !== "evidence-bundle.v1") {
    console.error("Invalid request: unsupported schema version");
    process.exitCode = 1;
    process.exit(1);
    return {
      outcome: "error",
      warnings: ["unsupported_schema_version"]
    };
  }

  const persistence = await runtime.getPersistence();
  const contract = await runtime.getContract();

  const { connection, rawObservationRepo, normalizedObservationRepo, featureRepo, bundleRepo } =
    persistence;

  const job = assembleEvidenceBundleJob({
    clock: runtime.clock,
    rawRepo: rawObservationRepo,
    normalizedRepo: normalizedObservationRepo,
    featureRepo,
    bundleRepo,
    contract
  });

  let assemblyError: unknown;
  let result: AssembleEvidenceBundleJobResult | undefined;

  try {
    result = await job(parsedRequest);
  } catch (err) {
    assemblyError = err;
  } finally {
    try {
      await connection.close();
    } catch (err) {
      console.error("Failed to close database connection:", err);
    }
  }

  if (assemblyError !== undefined) {
    process.exitCode = 1;
    console.error("Evidence bundle assembly failed:", assemblyError);
    return {
      outcome: "error",
      warnings: [assemblyError instanceof Error ? assemblyError.message : String(assemblyError)]
    };
  }

  const redacted = redactedOutcomeFromResult(result!);

  console.log(JSON.stringify(redacted, null, 2));

  if ("code" in result!) {
    process.exitCode = 1;
  } else if (result!.outcome === "conflict") {
    process.exitCode = 1;
  }

  return redacted;
}

async function main(): Promise<void> {
  const runtime = createNodeRuntime();

  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: pnpm assemble:bundle <path-to-request-json>");
    process.exitCode = 1;
    return;
  }

  const requestPath = args[0] as string;

  try {
    await runAssembleEvidenceBundleScript(runtime, requestPath);
  } catch (error) {
    console.error("Evidence bundle assembly failed:", error);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
