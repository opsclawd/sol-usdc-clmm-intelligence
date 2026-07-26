import { describe, it, expect, vi, beforeEach } from "vitest";
import { runGenerateResearchBriefScript } from "../../scripts/generate/research-brief.js";
import type { NodeRuntime } from "../../src/adapters/node/composition-root.js";

const mockGenerateResearchBriefJob = vi.fn();
vi.mock("../../src/jobs/generate-research-brief-job.js", () => {
  return {
    generateResearchBriefJob: (deps: unknown) => (params: unknown) =>
      mockGenerateResearchBriefJob(deps, params)
  };
});

describe("runGenerateResearchBriefScript", () => {
  let mockRuntime: NodeRuntime;

  beforeEach(() => {
    mockGenerateResearchBriefJob.mockReset();
    process.exitCode = undefined;

    mockRuntime = {
      clock: { now: () => 1700000000000 },
      jsonStore: {
        readJson: vi.fn(),
        writeJson: vi.fn()
      },
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: vi.fn() },
        bundleRepo: {},
        briefRepo: {}
      }),
      getLlmProvider: vi.fn().mockResolvedValue({})
    } as unknown as NodeRuntime;
  });

  it("handles valid object input and generated_complete result", async () => {
    const mockOutcome = {
      outcome: "generated_complete",
      row: { id: 10, evidenceBundleId: 5 },
      brief: {
        generationStatus: "complete",
        promptVersion: "v1",
        llmOutput: { unsupportedOrMissingInputs: [] }
      }
    };
    mockGenerateResearchBriefJob.mockResolvedValueOnce(mockOutcome);

    const result = await runGenerateResearchBriefScript(mockRuntime, {
      pair: "SOL/USDC",
      evaluationTimeUnixMs: 1700000000000,
      codeVersion: "1.0.0"
    });

    expect(result).toEqual({
      outcome: "generated_complete",
      briefRowId: 10,
      sourceBundleId: 5,
      generationStatus: "complete",
      promptVersion: "v1",
      warnings: []
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("returns no_brief outcome and sets exitCode to 1 on no_brief result", async () => {
    const mockOutcome = {
      outcome: "no_brief",
      reason: "no_bundle"
    };
    mockGenerateResearchBriefJob.mockResolvedValueOnce(mockOutcome);

    const result = await runGenerateResearchBriefScript(mockRuntime, {
      pair: "SOL/USDC",
      evaluationTimeUnixMs: 1700000000000,
      codeVersion: "1.0.0"
    });

    expect(result).toEqual({
      outcome: "no_brief",
      reason: "no_bundle"
    });
    expect(process.exitCode).toBe(1);
  });

  it("returns error outcome on wrong pair input", async () => {
    const result = await runGenerateResearchBriefScript(mockRuntime, {
      pair: "BTC/USDC",
      evaluationTimeUnixMs: 1700000000000,
      codeVersion: "1.0.0"
    });

    expect(result).toEqual({
      outcome: "error",
      reason: "wrong_pair"
    });
    expect(process.exitCode).toBe(1);
  });
});
