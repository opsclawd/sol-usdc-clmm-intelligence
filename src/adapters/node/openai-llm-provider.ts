import { zodToJsonSchema } from "zod-to-json-schema";
import type { HttpClient } from "../../ports/http.js";
import type {
  LlmProvider,
  StructuredGeneration,
  StructuredGenerationRequest
} from "../../ports/llm-provider.js";

export interface OpenAiLlmProviderOptions {
  readonly http: HttpClient;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly modelVersion?: string;
}

interface OpenAiChatCompletionResponse {
  readonly model?: string;
  readonly choices?: ReadonlyArray<{
    readonly message?: {
      readonly content?: string | null;
    };
  }>;
}

export class OpenAiLlmProvider implements LlmProvider {
  private readonly http: HttpClient;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly modelVersion?: string;

  constructor(options: OpenAiLlmProviderOptions) {
    this.http = options.http;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model;
    if (options.modelVersion !== undefined) {
      this.modelVersion = options.modelVersion;
    }
  }

  async generateStructured<T>(
    request: StructuredGenerationRequest<T>
  ): Promise<StructuredGeneration<T>> {
    const jsonSchema = zodToJsonSchema(request.schema, {
      target: "openAi"
    }) as Record<string, unknown>;
    delete jsonSchema.$schema;

    const payload = {
      model: this.model,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: JSON.stringify(request.context) }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: request.schemaName,
          strict: true,
          schema: jsonSchema
        }
      }
    };

    const url = `${this.baseUrl}/chat/completions`;
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json"
    };

    let response;
    try {
      response = await this.http.postJsonRaw<OpenAiChatCompletionResponse>(url, payload, {
        headers,
        ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
        maxAttempts: 1
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const redactedMsg = this.apiKey ? msg.replaceAll(this.apiKey, "[REDACTED]") : msg;
      throw new Error(`LLM provider HTTP request failed: ${redactedMsg}`);
    }

    if (!response.ok) {
      throw new Error(`LLM provider returned HTTP status ${response.status}`);
    }

    const content = response.body?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string" || content.trim() === "") {
      throw new Error("LLM provider returned empty response content");
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(content);
    } catch {
      throw new Error("LLM provider returned malformed JSON");
    }

    const parseResult = request.schema.safeParse(parsedJson);
    if (!parseResult.success) {
      throw new Error(`LLM provider output failed schema validation: ${parseResult.error.message}`);
    }

    const returnedModel = response.body?.model || this.modelVersion;

    return {
      output: parseResult.data,
      provider: "openai",
      model: this.model,
      ...(returnedModel !== undefined ? { modelVersion: returnedModel } : {})
    };
  }
}
