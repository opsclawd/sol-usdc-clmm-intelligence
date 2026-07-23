import { createNodeRuntime } from "../../src/adapters/node/composition-root.js";
import { HttpSupportResistanceSource } from "../../src/adapters/node/http-support-resistance-source.js";
import { runSupportResistanceJob } from "../../src/jobs/support-resistance-job.js";

const ACCEPTED_STATUSES = new Set(["accepted", "identical_replay", "stale", "degraded"]);
const FAILURE_STATUSES = new Set([
  "conflict",
  "malformed",
  "timeout",
  "network",
  "unavailable",
  "failed"
]);

export async function runSupportResistanceCollect(): Promise<void> {
  const runtime = createNodeRuntime();

  const apiUrl = runtime.env.getOptional("SUPPORT_RESISTANCE_API_URL")?.trim();
  const apiKey = runtime.env.getOptional("SUPPORT_RESISTANCE_API_KEY")?.trim();

  if (!apiUrl) {
    console.error(
      JSON.stringify({
        status: "failed",
        diagnostic: "SUPPORT_RESISTANCE_API_URL is not configured"
      })
    );
    process.exitCode = 1;
    return;
  }

  const sourceOptions: { http: typeof runtime.http; url: string; apiKey?: string } = {
    http: runtime.http,
    url: apiUrl
  };
  if (apiKey) {
    sourceOptions.apiKey = apiKey;
  }
  const supportResistanceSource = new HttpSupportResistanceSource(sourceOptions);

  let persistence;
  try {
    persistence = await runtime.getPersistence();
  } catch (err) {
    console.error(
      JSON.stringify({ status: "failed", diagnostic: "Failed to initialize persistence" })
    );
    process.exitCode = 1;
    return;
  }

  let result;
  try {
    result = await runSupportResistanceJob({
      supportResistanceSource,
      rawObservationRepo: persistence.rawObservationRepo,
      normalizedObservationRepo: persistence.normalizedObservationRepo,
      env: runtime.env,
      clock: runtime.clock,
      runIdFactory: runtime.runIdFactory
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        status: "failed",
        diagnostic: err instanceof Error ? err.message : "Unknown error"
      })
    );
    process.exitCode = 1;
    return;
  } finally {
    try {
      await persistence.connection.close();
    } catch {
      // ignore close errors
    }
  }

  const redactedResult = redactResult(result, apiKey);
  console.log(JSON.stringify(redactedResult));

  if (ACCEPTED_STATUSES.has(result.status)) {
    process.exitCode = 0;
  } else if (FAILURE_STATUSES.has(result.status)) {
    process.exitCode = 1;
  } else {
    process.exitCode = 1;
  }
}

function redactResult(result: unknown, apiKey?: string): unknown {
  if (typeof result !== "object" || result === null) {
    return result;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result as Record<string, unknown>)) {
    if (key === "diagnostic" && typeof value === "string") {
      let redactedValue = value;
      redactedValue = redactedValue.replace(/SUPPORT_RESISTANCE_API_KEY/g, "[REDACTED]");
      redactedValue = redactedValue.replace(/Bearer/gi, "[REDACTED]");
      redactedValue = redactedValue.replace(/api[_-]?key/gi, "[REDACTED]");
      if (apiKey) {
        redactedValue = redactedValue.split(apiKey).join("[REDACTED]");
      }
      redacted[key] = redactedValue;
    } else if (typeof value === "object" && value !== null) {
      redacted[key] = redactResult(value, apiKey);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

runSupportResistanceCollect().catch((error) => {
  console.error(JSON.stringify({ status: "failed", diagnostic: error.message }));
  process.exitCode = 1;
});
