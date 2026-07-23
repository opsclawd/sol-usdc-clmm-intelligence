import { createNodeRuntime } from "../../src/adapters/node/composition-root.js";
import { HttpScheduledEventSource } from "../../src/adapters/node/http-scheduled-event-source.js";
import { HttpProtocolIncidentSource } from "../../src/adapters/node/http-protocol-incident-source.js";
import { runContextEventsJob } from "../../src/jobs/context-events-job.js";
import { redactSecretMentions, secretRedactingReplacer } from "../../src/domain/redact-secrets.js";

export async function runContextEventsCollect(): Promise<void> {
  const runtime = createNodeRuntime();
  let persistence;
  try {
    persistence = await runtime.getPersistence();
  } catch (err) {
    console.error("Failed to initialize persistence:", err);
    process.exitCode = 1;
    return;
  }

  const macroCalendarUrl = runtime.env.getOptional("MACRO_CALENDAR_API_URL");
  const macroCalendarApiKey = runtime.env.getOptional("MACRO_CALENDAR_API_KEY");
  const solanaStatusUrl = runtime.env.getOptional("SOLANA_STATUS_API_URL");
  const solanaStatusApiKey = runtime.env.getOptional("SOLANA_STATUS_API_KEY");

  if (!macroCalendarUrl) {
    console.error("Missing required environment variable: MACRO_CALENDAR_API_URL");
    process.exitCode = 1;
    try {
      await persistence.connection.close();
    } catch (closeErr) {
      const errMsg = closeErr instanceof Error ? closeErr.message : String(closeErr);
      console.error("Failed to close database connection:", redactSecretMentions(errMsg));
    }
    return;
  }

  if (!solanaStatusUrl) {
    console.error("Missing required environment variable: SOLANA_STATUS_API_URL");
    process.exitCode = 1;
    try {
      await persistence.connection.close();
    } catch (closeErr) {
      const errMsg = closeErr instanceof Error ? closeErr.message : String(closeErr);
      console.error("Failed to close database connection:", redactSecretMentions(errMsg));
    }
    return;
  }

  const scheduledEventSource = new HttpScheduledEventSource({
    http: runtime.http,
    url: macroCalendarUrl,
    ...(macroCalendarApiKey && { apiKey: macroCalendarApiKey })
  });

  const protocolIncidentSource = new HttpProtocolIncidentSource({
    http: runtime.http,
    url: solanaStatusUrl,
    ...(solanaStatusApiKey && { apiKey: solanaStatusApiKey })
  });

  let result;
  try {
    result = await runContextEventsJob({
      scheduledEventSource,
      protocolIncidentSource,
      rawObservationRepo: persistence.rawObservationRepo,
      normalizedObservationRepo: persistence.normalizedObservationRepo,
      env: runtime.env,
      clock: runtime.clock,
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
      await persistence.connection.close();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("Failed to close database connection:", redactSecretMentions(errMsg));
      process.exitCode = 1;
    }
  }
}

if (
  process.argv[1]?.endsWith("context-events.ts") ||
  process.argv[1]?.endsWith("context-events.js") ||
  process.argv[1]?.endsWith("context-events")
) {
  runContextEventsCollect().catch((error) => {
    console.error("Unhandled error in context events collector runner:", error);
    process.exitCode = 1;
  });
}
