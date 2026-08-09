import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  HermesLlmProvider,
  extractJsonPayload
} from "../../../src/adapters/node/hermes-llm-provider.js";
import { isProviderUnavailable } from "../../../src/domain/brief/provider-availability.js";

const schema = z.object({ summary: z.string() });

function provider(
  run: (args: readonly string[], t: number) => Promise<{ stdout: string; exitCode: number }>
) {
  return new HermesLlmProvider({ run, model: "MiniMax-M2.7", provider: "minimax" });
}

const request = {
  systemPrompt: "be brief",
  context: { a: 1 },
  schema,
  schemaName: "brief"
};

describe("extractJsonPayload", () => {
  it("strips the trailing session_id line hermes appends", () => {
    // Observed verbatim from `hermes chat -Q -q ...` on the VPS.
    const out = '{"summary":"ok"}\n\nsession_id: 20260809_033243_07d1e5\n';
    expect(JSON.parse(extractJsonPayload(out))).toEqual({ summary: "ok" });
  });

  it("unwraps a markdown fence", () => {
    expect(JSON.parse(extractJsonPayload('```json\n{"summary":"ok"}\n```'))).toEqual({
      summary: "ok"
    });
  });

  it("recovers JSON surrounded by prose", () => {
    expect(JSON.parse(extractJsonPayload('Sure!\n{"summary":"ok"}\nHope that helps.'))).toEqual({
      summary: "ok"
    });
  });
});

describe("HermesLlmProvider", () => {
  it("returns parsed output with truthful provider metadata", async () => {
    const p = provider(async () => ({
      stdout: '{"summary":"ok"}\n\nsession_id: abc\n',
      exitCode: 0
    }));
    const result = await p.generateStructured(request);

    expect(result.output).toEqual({ summary: "ok" });
    // Must not report "unknown" — that is what the degraded path emitted (#171).
    expect(result.provider).toBe("minimax");
    expect(result.model).toBe("MiniMax-M2.7");
  });

  it("passes the prompt to `hermes chat -Q -q`", async () => {
    let seen: readonly string[] = [];
    const p = provider(async (args) => {
      seen = args;
      return { stdout: '{"summary":"ok"}', exitCode: 0 };
    });
    await p.generateStructured(request);

    expect(seen.slice(0, 3)).toEqual(["chat", "-Q", "-q"]);
    expect(seen[3]).toContain("be brief");
  });

  it("reports a spawn failure as provider-unavailable so the caller fails closed", async () => {
    // hermes is absent in CI and local checkouts.
    const p = provider(async () => {
      throw new Error("spawn hermes ENOENT");
    });
    await expect(p.generateStructured(request)).rejects.toThrow(/hermes invocation failed/);
    await p.generateStructured(request).catch((e: Error) => {
      expect(isProviderUnavailable(e.message)).toBe(true);
    });
  });

  it("reports a non-zero exit as provider-unavailable", async () => {
    const p = provider(async () => ({ stdout: "", exitCode: 3 }));
    await p.generateStructured(request).catch((e: Error) => {
      expect(isProviderUnavailable(e.message)).toBe(true);
    });
  });

  it("rejects output that does not satisfy the schema", async () => {
    // Hermes has no structured-output parameter, so Zod is the only guarantee.
    const p = provider(async () => ({ stdout: '{"wrong":"shape"}', exitCode: 0 }));
    await expect(p.generateStructured(request)).rejects.toThrow(/failed schema validation/);
  });

  it("rejects non-JSON output as a degraded answer, not unavailability", async () => {
    const p = provider(async () => ({ stdout: "I cannot help with that.", exitCode: 0 }));
    await p.generateStructured(request).catch((e: Error) => {
      expect(e.message).toMatch(/malformed JSON|empty response/);
      expect(isProviderUnavailable(e.message)).toBe(false);
    });
  });
});
