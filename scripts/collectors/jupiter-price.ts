import { createNodeRuntime } from "../../src/adapters/node/composition-root.js";
import { runPriceObservationsJob } from "../../src/jobs/price-observations-job.js";
import { redactSecretMentions, secretRedactingReplacer } from "../../src/domain/redact-secrets.js";

export async function runCollector(): Promise<void> {
  let connection: { close(): Promise<void> } | undefined;
  try {
    const runtime = createNodeRuntime();
    const persistence = await runtime.getPersistence();
    connection = persistence.connection;

    const result = await runPriceObservationsJob({
      http: runtime.http,
      jsonStore: runtime.jsonStore,
      env: runtime.env,
      clock: runtime.clock,
      rawObservationRepo: persistence.rawObservationRepo,
      normalizedObservationRepo: persistence.normalizedObservationRepo,
      runIdFactory: runtime.runIdFactory
    });

    console.log(JSON.stringify(result, secretRedactingReplacer, 2));
    process.exitCode = result.shouldFailCommand ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Price observation collection failed:", redactSecretMentions(message));
    process.exitCode = 1;
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Failed to close database connection:", redactSecretMentions(message));
        process.exitCode = 1;
      }
    }
  }
}

if (
  process.argv[1]?.endsWith("jupiter-price.ts") ||
  process.argv[1]?.endsWith("jupiter-price.js") ||
  process.argv[1]?.endsWith("jupiter-price")
) {
  runCollector().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Unhandled error in price collector runner:", redactSecretMentions(message));
    process.exitCode = 1;
  });
}
