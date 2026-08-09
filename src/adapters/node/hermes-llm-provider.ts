import { zodToJsonSchema } from "zod-to-json-schema";
import type {
  LlmProvider,
  StructuredGeneration,
  StructuredGenerationRequest
} from "../../ports/llm-provider.js";

/**
 * Generate structured output by invoking the local `hermes` CLI instead of an
 * HTTP LLM endpoint.
 *
 * Motivation (#171): the only working credential on this host is MiniMax's, and
 * MiniMax accepts `response_format: json_schema` with `strict: true` while
 * ignoring it — it returns reasoning prose wrapped in <think> tags, which the
 * OpenAI adapter cannot parse. Hermes already authenticates against that
 * provider and normalises the response, so routing through it sidesteps both
 * problems without putting a second credential in this service.
 *
 * The LlmProvider port is unchanged: grounding checks, schema validation and
 * bundle finalisation all behave exactly as they do for the HTTP adapter. Only
 * the transport differs.
 *
 * `hermes` is absent in CI and local checkouts. Failures here surface as
 * provider-unavailable so the caller fails closed to `researchBrief: null`
 * rather than fabricating a brief (see domain/brief/provider-availability.ts).
 */
export interface RunHermesCommand {
  (
    args: readonly string[],
    timeoutMs: number
  ): Promise<{
    readonly stdout: string;
    readonly exitCode: number;
  }>;
}

export interface HermesLlmProviderOptions {
  readonly run: RunHermesCommand;
  readonly model: string;
  readonly provider: string;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * `hermes chat -Q` appends a trailing `session_id: <id>` line to stdout. Strip
 * it, plus any markdown fence, before parsing.
 */
export function extractJsonPayload(stdout: string): string {
  let text = stdout.replace(/^\s*session_id:.*$/gim, "").trim();

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) text = fenced[1].trim();

  const start = text.search(/[[{]/);
  if (start === -1) return text;

  const opener = text[start];
  const closer = opener === "{" ? "}" : "]";
  const end = text.lastIndexOf(closer);
  return end > start ? text.slice(start, end + 1) : text.slice(start);
}

export class HermesLlmProvider implements LlmProvider {
  private readonly run: RunHermesCommand;
  private readonly model: string;
  private readonly provider: string;
  private readonly timeoutMs: number;

  constructor(options: HermesLlmProviderOptions) {
    this.run = options.run;
    this.model = options.model;
    this.provider = options.provider;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async generateStructured<T>(
    request: StructuredGenerationRequest<T>
  ): Promise<StructuredGeneration<T>> {
    const jsonSchema = zodToJsonSchema(request.schema, { target: "openAi" }) as Record<
      string,
      unknown
    >;
    delete jsonSchema.$schema;

    // Hermes exposes no structured-output parameter, so the schema is stated in
    // the prompt. Output is still validated against the Zod schema below, so a
    // non-conforming reply fails rather than being accepted.
    const prompt = [
      request.systemPrompt,
      "",
      `Respond with ONLY a single JSON object matching this JSON Schema named "${request.schemaName}".`,
      "No prose, no explanation, no markdown fences.",
      "",
      "SCHEMA:",
      JSON.stringify(jsonSchema),
      "",
      "INPUT:",
      JSON.stringify(request.context)
    ].join("\n");

    const timeoutMs = request.timeoutMs ?? this.timeoutMs;

    let result: { stdout: string; exitCode: number };
    try {
      result = await this.run(["chat", "-Q", "-q", prompt], timeoutMs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`LLM provider HTTP request failed: hermes invocation failed: ${msg}`);
    }

    if (result.exitCode !== 0) {
      throw new Error(`LLM provider returned HTTP status 502 (hermes exit ${result.exitCode})`);
    }

    const payload = extractJsonPayload(result.stdout);
    if (payload.trim() === "") {
      throw new Error("LLM provider returned empty response content");
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(payload);
    } catch {
      throw new Error("LLM provider returned malformed JSON");
    }

    const parseResult = request.schema.safeParse(parsedJson);
    if (!parseResult.success) {
      throw new Error(`LLM provider output failed schema validation: ${parseResult.error.message}`);
    }

    return {
      output: parseResult.data,
      provider: this.provider,
      model: this.model,
      modelVersion: this.model
    };
  }
}
