import { createNodeRuntime, type NodeRuntime } from "../../src/adapters/node/composition-root.js";
import { generateResearchBriefJob } from "../../src/jobs/generate-research-brief-job.js";
import type {
  GenerateResearchBriefParams,
  GenerateResearchBriefOutcome
} from "../../src/application/generate-research-brief.js";

export interface RedactedBriefOutcome {
  outcome: string;
  briefRowId?: number;
  sourceBundleId?: number;
  generationStatus?: string;
  promptVersion?: string;
  warnings?: readonly string[];
  reason?: string;
}

function redactOutcome(result: GenerateResearchBriefOutcome): RedactedBriefOutcome {
  switch (result.outcome) {
    case "no_brief":
      return { outcome: "no_brief", reason: result.reason };
    case "reused":
      return {
        outcome: "reused",
        briefRowId: result.row.id,
        sourceBundleId: result.row.evidenceBundleId,
        generationStatus: result.brief.generationStatus,
        promptVersion: result.brief.promptVersion,
        warnings: result.brief.llmOutput.unsupportedOrMissingInputs
      };
    case "generated_complete":
      return {
        outcome: "generated_complete",
        briefRowId: result.row.id,
        sourceBundleId: result.row.evidenceBundleId,
        generationStatus: result.brief.generationStatus,
        promptVersion: result.brief.promptVersion,
        warnings: result.brief.llmOutput.unsupportedOrMissingInputs
      };
    case "generated_degraded":
      return {
        outcome: "generated_degraded",
        briefRowId: result.row.id,
        sourceBundleId: result.row.evidenceBundleId,
        generationStatus: result.brief.generationStatus,
        promptVersion: result.brief.promptVersion,
        warnings: result.brief.llmOutput.unsupportedOrMissingInputs
      };
  }
}

export async function runGenerateResearchBriefScript(
  runtime: NodeRuntime,
  requestInput?: string | unknown
): Promise<RedactedBriefOutcome> {
  if (requestInput === undefined || requestInput === null) {
    console.error("Invalid request: request input is required");
    process.exitCode = 1;
    return { outcome: "error", reason: "request_required" };
  }

  let parsedParams: GenerateResearchBriefParams;

  if (typeof requestInput === "object") {
    parsedParams = requestInput as GenerateResearchBriefParams;
  } else if (typeof requestInput === "string") {
    const raw = requestInput.trim();
    if (raw === "") {
      console.error("Invalid request: request input is required");
      process.exitCode = 1;
      return { outcome: "error", reason: "request_required" };
    }
    if (raw.startsWith("{")) {
      try {
        parsedParams = JSON.parse(raw);
      } catch (err) {
        console.error(
          "Failed to parse request JSON string:",
          err instanceof Error ? err.message : String(err)
        );
        process.exitCode = 1;
        return { outcome: "error", reason: "request_parse_failed" };
      }
    } else {
      try {
        parsedParams = (await runtime.jsonStore.readJson(raw)) as GenerateResearchBriefParams;
      } catch (err) {
        console.error(
          "Failed to read request JSON file:",
          err instanceof Error ? err.message : String(err)
        );
        process.exitCode = 1;
        return { outcome: "error", reason: "request_read_failed" };
      }
    }
  } else {
    console.error("Invalid request: request input is required");
    process.exitCode = 1;
    return { outcome: "error", reason: "request_required" };
  }

  const evidenceBundleId = (parsedParams as { evidenceBundleId?: unknown })?.evidenceBundleId;
  if (
    typeof evidenceBundleId !== "number" ||
    !Number.isSafeInteger(evidenceBundleId) ||
    evidenceBundleId <= 0
  ) {
    console.error("Invalid request: evidenceBundleId must be a positive safe integer");
    process.exitCode = 1;
    return { outcome: "error", reason: "invalid_evidence_bundle_id" };
  }

  const evaluationTimeUnixMs = (parsedParams as { evaluationTimeUnixMs?: unknown })
    ?.evaluationTimeUnixMs;
  if (
    typeof evaluationTimeUnixMs !== "number" ||
    !Number.isSafeInteger(evaluationTimeUnixMs) ||
    evaluationTimeUnixMs <= 0
  ) {
    console.error("Invalid request: evaluationTimeUnixMs must be a positive safe integer");
    process.exitCode = 1;
    return { outcome: "error", reason: "invalid_evaluation_time_unix_ms" };
  }

  if (!parsedParams.pair || parsedParams.pair !== "SOL/USDC") {
    console.error("Invalid request: pair must be SOL/USDC");
    process.exitCode = 1;
    return { outcome: "error", reason: "wrong_pair" };
  }

  const persistence = await runtime.getPersistence();
  let llmProvider;
  if (runtime.getLlmProvider) {
    llmProvider = await runtime.getLlmProvider();
  } else {
    const { OpenAiLlmProvider } = await import("../../src/adapters/node/openai-llm-provider.js");
    const baseUrl = runtime.env.get("LLM_BASE_URL");
    const apiKey = runtime.env.get("LLM_API_KEY");
    const model = runtime.env.get("LLM_MODEL");
    const modelVersion = runtime.env.getOptional("LLM_MODEL_VERSION");
    llmProvider = new OpenAiLlmProvider({
      http: runtime.http,
      baseUrl,
      apiKey,
      model,
      ...(modelVersion ? { modelVersion } : {})
    });
  }

  const { connection, bundleRepo, briefRepo } = persistence;

  const job = generateResearchBriefJob({
    bundleRepo,
    briefRepo,
    llmProvider,
    dbConnection: connection
  });

  let result: GenerateResearchBriefOutcome;
  try {
    result = await job(parsedParams);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Research brief generation job failed:", err);
    process.exitCode = 1;
    return {
      outcome: "error",
      reason: message
    };
  }

  const redacted = redactOutcome(result);
  console.log(JSON.stringify(redacted));

  if (result.outcome === "no_brief") {
    process.exitCode = 1;
  }

  return redacted;
}

async function main(): Promise<void> {
  const runtime = createNodeRuntime();
  const args = process.argv.slice(2);
  const input = args[0];

  try {
    await runGenerateResearchBriefScript(runtime, input);
  } catch (error) {
    console.error("Research brief generation script failed:", error);
    process.exitCode = 1;
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
