import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OpenAiLlmProvider } from "../../../src/adapters/node/openai-llm-provider.js";
import { HttpRequestError } from "../../../src/ports/http.js";
import { FakeHttp } from "../../fakes/fake-http.js";
import { FakeLlmProvider } from "../../fakes/fake-llm-provider.js";

const SampleOutputSchema = z.object({
  summary: z.string(),
  score: z.number()
});

describe("OpenAiLlmProvider & FakeLlmProvider", () => {
  it("should construct request with strict json_schema, Authorization header, and return metadata on success", async () => {
    const http = new FakeHttp();
    const provider = new OpenAiLlmProvider({
      http,
      baseUrl: "https://api.openai.com/v1",
      apiKey: "secret-key-123",
      model: "gpt-4o-mini",
      modelVersion: "2024-07-18"
    });

    http.setPostResponse("https://api.openai.com/v1/chat/completions", {
      body: {
        status: 200,
        ok: true,
        headers: { "content-type": "application/json" },
        body: {
          model: "gpt-4o-mini-2024-07-18",
          choices: [
            {
              message: {
                content: JSON.stringify({ summary: "Market is calm", score: 42 })
              }
            }
          ]
        }
      }
    });

    const result = await provider.generateStructured({
      systemPrompt: "You are a helpful assistant",
      context: { text: "hello" },
      schema: SampleOutputSchema,
      schemaName: "SampleOutput",
      timeoutMs: 5000
    });

    expect(result.output).toEqual({ summary: "Market is calm", score: 42 });
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4o-mini");
    expect(result.modelVersion).toBe("gpt-4o-mini-2024-07-18");

    const requests = http.postCalls;
    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(req.options?.headers).toEqual({
      Authorization: "Bearer secret-key-123",
      "Content-Type": "application/json"
    });
    expect(req.options?.timeoutMs).toBe(5000);
    expect(req.options?.maxAttempts).toBe(1);

    const body = req.body as {
      model: string;
      response_format: {
        type: string;
        json_schema: {
          name: string;
          strict: boolean;
          schema: Record<string, unknown>;
        };
      };
    };

    expect(body.model).toBe("gpt-4o-mini");
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "SampleOutput",
        strict: true
      }
    });
    expect(body.response_format.json_schema.schema).not.toHaveProperty("$ref");
    expect(body.response_format.json_schema.schema).not.toHaveProperty("$schema");
    expect(body.response_format.json_schema.schema).toHaveProperty("type", "object");
  });

  it("redacts authorization header boundaries and secrets in results and error throws", async () => {
    const http = new FakeHttp();
    const provider = new OpenAiLlmProvider({
      http,
      baseUrl: "https://api.openai.com/v1",
      apiKey: "super-secret-key",
      model: "gpt-4o"
    });

    http.setPostResponse("https://api.openai.com/v1/chat/completions", {
      error: new HttpRequestError(
        "http_status",
        "HTTP 401 Unauthorized for key super-secret-key and backup key super-secret-key",
        401,
        false
      )
    });

    let error: Error | undefined;
    try {
      await provider.generateStructured({
        systemPrompt: "sys",
        context: {},
        schema: SampleOutputSchema,
        schemaName: "SampleOutput"
      });
    } catch (err: unknown) {
      if (err instanceof Error) {
        error = err;
      }
    }

    expect(error).toBeDefined();
    expect(error?.message).not.toContain("super-secret-key");
    expect(error?.message).toContain("[REDACTED]");
    expect(error?.message.match(/\[REDACTED\]/g)).toHaveLength(2);
    const jsonString = JSON.stringify(error);
    expect(jsonString).not.toContain("super-secret-key");
  });

  it("rejects when HTTP request fails", async () => {
    const http = new FakeHttp();
    const provider = new OpenAiLlmProvider({
      http,
      baseUrl: "https://api.openai.com/v1",
      apiKey: "secret",
      model: "gpt-4o"
    });

    http.setPostResponse("https://api.openai.com/v1/chat/completions", {
      body: {
        status: 500,
        ok: false,
        headers: {},
        body: "Internal Server Error"
      }
    });

    await expect(
      provider.generateStructured({
        systemPrompt: "sys",
        context: {},
        schema: SampleOutputSchema,
        schemaName: "SampleOutput"
      })
    ).rejects.toThrow("LLM provider returned HTTP status 500");
  });

  it("rejects when choice content is absent or empty", async () => {
    const http = new FakeHttp();
    const provider = new OpenAiLlmProvider({
      http,
      baseUrl: "https://api.openai.com/v1",
      apiKey: "secret",
      model: "gpt-4o"
    });

    http.setPostResponse("https://api.openai.com/v1/chat/completions", {
      body: {
        status: 200,
        ok: true,
        headers: {},
        body: { choices: [] }
      }
    });

    await expect(
      provider.generateStructured({
        systemPrompt: "sys",
        context: {},
        schema: SampleOutputSchema,
        schemaName: "SampleOutput"
      })
    ).rejects.toThrow("LLM provider returned empty response content");
  });

  it("rejects when returned content is invalid JSON", async () => {
    const http = new FakeHttp();
    const provider = new OpenAiLlmProvider({
      http,
      baseUrl: "https://api.openai.com/v1",
      apiKey: "secret",
      model: "gpt-4o"
    });

    http.setPostResponse("https://api.openai.com/v1/chat/completions", {
      body: {
        status: 200,
        ok: true,
        headers: {},
        body: {
          choices: [{ message: { content: "NOT VALID JSON" } }]
        }
      }
    });

    await expect(
      provider.generateStructured({
        systemPrompt: "sys",
        context: {},
        schema: SampleOutputSchema,
        schemaName: "SampleOutput"
      })
    ).rejects.toThrow("LLM provider returned malformed JSON");
  });

  it("rejects when returned JSON fails Zod schema validation", async () => {
    const http = new FakeHttp();
    const provider = new OpenAiLlmProvider({
      http,
      baseUrl: "https://api.openai.com/v1",
      apiKey: "secret",
      model: "gpt-4o"
    });

    http.setPostResponse("https://api.openai.com/v1/chat/completions", {
      body: {
        status: 200,
        ok: true,
        headers: {},
        body: {
          choices: [
            { message: { content: JSON.stringify({ summary: 123, score: "not a number" }) } }
          ]
        }
      }
    });

    await expect(
      provider.generateStructured({
        systemPrompt: "sys",
        context: {},
        schema: SampleOutputSchema,
        schemaName: "SampleOutput"
      })
    ).rejects.toThrow("LLM provider output failed schema validation");
  });

  it("supports FakeLlmProvider for queued success and error outcomes", async () => {
    const fake = new FakeLlmProvider();
    fake.enqueueResult({
      output: { summary: "Fake summary", score: 99 },
      provider: "fake-provider",
      model: "fake-model",
      modelVersion: "v1.0"
    });

    const res = await fake.generateStructured({
      systemPrompt: "sys",
      context: { foo: "bar" },
      schema: SampleOutputSchema,
      schemaName: "SampleOutput"
    });

    expect(res.output).toEqual({ summary: "Fake summary", score: 99 });
    expect(fake.capturedRequests()).toHaveLength(1);
    expect(fake.capturedRequests()[0]!.context).toEqual({ foo: "bar" });

    fake.enqueueError(new Error("Queued failure"));
    await expect(
      fake.generateStructured({
        systemPrompt: "sys",
        context: {},
        schema: SampleOutputSchema,
        schemaName: "SampleOutput"
      })
    ).rejects.toThrow("Queued failure");
  });
});
