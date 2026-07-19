import { createNodeRuntime } from "../../src/adapters/node/composition-root.js";
import { runCoreCollectionJob } from "../../src/jobs/core-collection-job.js";

const SECRET_KEY_PATTERN = /(api[_-]?key|bearer|token|auth|secret)/i;

function redactSecretMentions(text: string): string {
  let redacted = text;
  const keys = [
    "api[_-]?key",
    "bearer\\s*token",
    "auth\\s*token",
    "bearer",
    "token",
    "auth",
    "secret"
  ];
  for (const key of keys) {
    const regex = new RegExp(`(${key})\\s*([=:]\\s*|\\s+)(\\S+)`, "gi");
    redacted = redacted.replace(regex, "[REDACTED]");
  }
  for (const key of keys) {
    const regex = new RegExp(key, "gi");
    redacted = redacted.replace(regex, "[REDACTED]");
  }
  return redacted;
}

function secretRedactingReplacer(key: string, value: unknown): unknown {
  if (SECRET_KEY_PATTERN.test(key)) {
    return "[REDACTED]";
  }
  if (typeof value === "string") {
    return redactSecretMentions(value);
  }
  return value;
}

export async function runCoreCollection(): Promise<void> {
  const runtime = createNodeRuntime();
  let persistence;
  try {
    persistence = await runtime.getPersistence();
  } catch (err) {
    console.error("Failed to initialize persistence:", err);
    process.exitCode = 1;
    return;
  }

  const { connection, rawObservationRepo, normalizedObservationRepo } = persistence;
  let result;
  try {
    result = await runCoreCollectionJob({
      http: runtime.http,
      jsonStore: runtime.jsonStore,
      env: runtime.env,
      clock: runtime.clock,
      rawObservationRepo,
      normalizedObservationRepo,
      runIdFactory: runtime.runIdFactory
    });

    console.log(JSON.stringify(result, secretRedactingReplacer, 2));

    if (result.shouldFailCommand) {
      process.exitCode = 1;
    } else {
      process.exitCode = 0;
    }
  } catch (err) {
    console.error("Collection run failed:", err);
    process.exitCode = 1;
  } finally {
    try {
      await connection.close();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("Failed to close database connection:", redactSecretMentions(errMsg));
      process.exitCode = 1;
    }
  }
}

if (
  process.argv[1]?.endsWith("core-collection.ts") ||
  process.argv[1]?.endsWith("core-collection.js") ||
  process.argv[1]?.endsWith("core-collection")
) {
  runCoreCollection().catch((error) => {
    console.error("Unhandled error in core collection runner:", error);
    process.exitCode = 1;
  });
}
