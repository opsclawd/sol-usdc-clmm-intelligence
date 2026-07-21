import { createNodeRuntime, type NodeRuntime } from "../../src/adapters/node/composition-root.js";
import {
  publishEvidenceBundleJob,
  type PublishEvidenceBundleJobResult
} from "../../src/jobs/publish-evidence-bundle-job.js";

export interface RedactedOutcome {
  outcome: string;
  bundleId?: number;
  attemptCount?: 1 | 2 | 3;
  httpStatus?: number;
  reason?: string;
}

function isTerminalSuccess(result: PublishEvidenceBundleJobResult): boolean {
  return result.outcome === "created" || result.outcome === "idempotent_replay";
}

function redactedOutcomeFromResult(result: PublishEvidenceBundleJobResult): RedactedOutcome {
  switch (result.outcome) {
    case "created":
      return {
        outcome: "created",
        bundleId: result.bundleId,
        attemptCount: result.attemptCount
      };
    case "idempotent_replay":
      return {
        outcome: "idempotent_replay",
        bundleId: result.bundleId,
        attemptCount: result.attemptCount
      };
    case "bundle_not_found":
      return {
        outcome: "bundle_not_found"
      };
    case "local_validation_failed":
      return {
        outcome: "local_validation_failed",
        reason: result.reason
      };
    case "validation_failed":
      return {
        outcome: "validation_failed",
        bundleId: result.bundleId,
        httpStatus: result.httpStatus
      };
    case "auth_failed":
      return {
        outcome: "auth_failed",
        bundleId: result.bundleId,
        httpStatus: result.httpStatus
      };
    case "conflict":
      return {
        outcome: "conflict",
        bundleId: result.bundleId,
        httpStatus: result.httpStatus
      };
    case "unknown_failed":
      return {
        outcome: "unknown_failed",
        bundleId: result.bundleId,
        httpStatus: result.httpStatus
      };
    case "permanent_http_failed":
      return {
        outcome: "permanent_http_failed",
        bundleId: result.bundleId,
        httpStatus: result.httpStatus
      };
    case "audit_store_failed":
      return {
        outcome: "audit_store_failed",
        reason: result.reason
      };
    case "transient_failure_exhausted":
      return {
        outcome: "transient_failure_exhausted",
        bundleId: result.bundleId,
        httpStatus: result.httpStatus
      };
    default:
      return {
        outcome: "unknown",
        reason: "Unrecognized outcome"
      };
  }
}

export async function runPublishEvidenceBundleScript(
  runtime: NodeRuntime
): Promise<RedactedOutcome> {
  const persistence = await runtime.getPersistence();
  const contract = await runtime.getContract();

  const { connection, bundleRepo, publishAttemptRepo } = persistence;

  const job = publishEvidenceBundleJob({
    clock: runtime.clock,
    http: runtime.http,
    env: runtime.env,
    bundleRepo,
    publishAttemptRepo,
    contract,
    retry: runtime.retryControl
  });

  let publishError: unknown;
  let result: PublishEvidenceBundleJobResult | undefined;

  try {
    result = await job();
  } catch (err) {
    publishError = err;
  } finally {
    try {
      await connection.close();
    } catch (err) {
      console.error("Failed to close database connection:", err);
    }
  }

  if (publishError !== undefined) {
    process.exitCode = 1;
    const errorReason = publishError instanceof Error ? publishError.message : String(publishError);
    console.error("Evidence bundle publishing failed:", publishError);
    process.exit(1);
    return {
      outcome: "error",
      reason: errorReason
    };
  }

  const redacted = redactedOutcomeFromResult(result!);

  console.log(JSON.stringify(redacted));

  if (!isTerminalSuccess(result!)) {
    process.exitCode = 1;
    if (result!.outcome === "audit_store_failed") {
      console.error("Audit store failed:", (result as { reason?: string }).reason);
    }
    process.exit(1);
  }

  return redacted;
}

async function main(): Promise<void> {
  const runtime = createNodeRuntime();

  try {
    await runPublishEvidenceBundleScript(runtime);
  } catch (error) {
    console.error("Evidence bundle publishing failed:", error);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
