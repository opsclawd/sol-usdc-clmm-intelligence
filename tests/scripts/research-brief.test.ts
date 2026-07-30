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
      evidenceBundleId: 5,
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
      evidenceBundleId: 5,
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
      evidenceBundleId: 5,
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

  it("rejects an absent request before initializing brief dependencies", async () => {
    const result = await runGenerateResearchBriefScript(mockRuntime, undefined);
    expect(result).toEqual({ outcome: "error", reason: "request_required" });
    expect(mockRuntime.getPersistence).not.toHaveBeenCalled();
    expect(mockGenerateResearchBriefJob).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("rejects a missing evidenceBundleId before initializing brief dependencies", async () => {
    const result = await runGenerateResearchBriefScript(mockRuntime, {
      pair: "SOL/USDC",
      evaluationTimeUnixMs: 1700000000000,
      codeVersion: "1.0.0"
    });
    expect(result).toEqual({ outcome: "error", reason: "invalid_evidence_bundle_id" });
    expect(mockRuntime.getPersistence).not.toHaveBeenCalled();
    expect(mockGenerateResearchBriefJob).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it.each([0, -1, 1.5, "1", Number.NaN])(
    "rejects a malformed evidenceBundleId before initializing brief dependencies",
    async (evidenceBundleId) => {
      const result = await runGenerateResearchBriefScript(mockRuntime, {
        evidenceBundleId,
        pair: "SOL/USDC",
        evaluationTimeUnixMs: 1700000000000,
        codeVersion: "1.0.0"
      });
      expect(result.reason).toBe("invalid_evidence_bundle_id");
      expect(mockRuntime.getPersistence).not.toHaveBeenCalled();
    }
  );

  it("rejects a missing evaluationTimeUnixMs before initializing brief dependencies", async () => {
    const result = await runGenerateResearchBriefScript(mockRuntime, {
      evidenceBundleId: 5,
      pair: "SOL/USDC",
      codeVersion: "1.0.0"
    });
    expect(result).toEqual({ outcome: "error", reason: "invalid_evaluation_time_unix_ms" });
    expect(mockRuntime.getPersistence).not.toHaveBeenCalled();
    expect(mockGenerateResearchBriefJob).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it.each([0, -1, 1.5, "1", Number.NaN])(
    "rejects a malformed evaluationTimeUnixMs before initializing brief dependencies",
    async (evaluationTimeUnixMs) => {
      const result = await runGenerateResearchBriefScript(mockRuntime, {
        evidenceBundleId: 5,
        pair: "SOL/USDC",
        evaluationTimeUnixMs,
        codeVersion: "1.0.0"
      });
      expect(result.reason).toBe("invalid_evaluation_time_unix_ms");
      expect(mockRuntime.getPersistence).not.toHaveBeenCalled();
    }
  );
});
