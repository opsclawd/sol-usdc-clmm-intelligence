import { createNodeRuntime } from "../../src/adapters/node/composition-root.js";
import { runPriceObservationsJob } from "../../src/jobs/price-observations-job.js";

const SECRET_KEY_PATTERN = /(api[_-]?key|bearer|token|auth|secret)/i;

function redactSecretMentions(text: string): string {
  return text
    .replace(/api[_-]?key/gi, "[REDACTED]")
    .replace(/bearer/gi, "[REDACTED]")
    .replace(/token/gi, "[REDACTED]")
    .replace(/auth/gi, "[REDACTED]")
    .replace(/secret/gi, "[REDACTED]");
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

export async function runCollector(): Promise<void> {
  const runtime = createNodeRuntime();
  const persistence = await runtime.getPersistence();
  const result = await runPriceObservationsJob({
    http: runtime.http,
    jsonStore: runtime.jsonStore,
    env: runtime.env,
    clock: runtime.clock,
    rawObservationRepo: persistence.rawObservationRepo,
    normalizedObservationRepo: persistence.normalizedObservationRepo
  });

  // Prints the structured result (JSON) safely without leaking secrets
  console.log(JSON.stringify(result, secretRedactingReplacer, 2));

  if (result.shouldFailCommand) {
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
}

if (
  process.argv[1]?.endsWith("jupiter-price.ts") ||
  process.argv[1]?.endsWith("jupiter-price.js") ||
  process.argv[1]?.endsWith("jupiter-price")
) {
  runCollector().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
