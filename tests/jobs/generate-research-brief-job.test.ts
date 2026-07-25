import { describe, it, expect, vi } from "vitest";
import {
  generateResearchBriefJob,
  type GenerateResearchBriefJobDeps
} from "../../src/jobs/generate-research-brief-job.js";
import type { DbConnection } from "../../src/ports/db.js";
import type {
  GenerateResearchBriefParams,
  GenerateResearchBriefOutcome
} from "../../src/application/generate-research-brief.js";
import type { EvidenceBundleRepo } from "../../src/ports/bundle-repo.js";
import type { ResearchBriefRepo } from "../../src/ports/brief-repo.js";
import type { LlmProvider } from "../../src/ports/llm-provider.js";

const mockGenerateResearchBrief = vi.fn();
vi.mock("../../src/application/generate-research-brief.js", () => {
  return {
    generateResearchBrief: (deps: unknown, params: unknown) =>
      mockGenerateResearchBrief(deps, params)
  };
});

describe("generateResearchBriefJob", () => {
  it("invokes generateResearchBrief and closes db connection on success", async () => {
    const mockOutcome: GenerateResearchBriefOutcome = {
      outcome: "no_brief",
      reason: "no_bundle"
    };
    mockGenerateResearchBrief.mockResolvedValueOnce(mockOutcome);

    const closeMock = vi.fn().mockResolvedValue(undefined);
    const fakeDbConnection = { close: closeMock } as unknown as DbConnection;

    const fakeDeps: GenerateResearchBriefJobDeps = {
      bundleRepo: {} as unknown as EvidenceBundleRepo,
      briefRepo: {} as unknown as ResearchBriefRepo,
      llmProvider: {} as unknown as LlmProvider,
      dbConnection: fakeDbConnection
    };

    const params: GenerateResearchBriefParams = {
      pair: "SOL/USDC",
      evaluationTimeUnixMs: 1700000000000,
      codeVersion: "1.0.0"
    };

    const job = generateResearchBriefJob(fakeDeps);
    const result = await job(params);

    expect(mockGenerateResearchBrief).toHaveBeenCalledWith(fakeDeps, params);
    expect(result).toBe(mockOutcome);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("closes db connection when generateResearchBrief throws an unhandled error", async () => {
    const error = new Error("DB connection failure");
    mockGenerateResearchBrief.mockRejectedValueOnce(error);

    const closeMock = vi.fn().mockResolvedValue(undefined);
    const fakeDbConnection = { close: closeMock } as unknown as DbConnection;

    const fakeDeps: GenerateResearchBriefJobDeps = {
      bundleRepo: {} as unknown as EvidenceBundleRepo,
      briefRepo: {} as unknown as ResearchBriefRepo,
      llmProvider: {} as unknown as LlmProvider,
      dbConnection: fakeDbConnection
    };

    const params: GenerateResearchBriefParams = {
      pair: "SOL/USDC",
      evaluationTimeUnixMs: 1700000000000,
      codeVersion: "1.0.0"
    };

    const job = generateResearchBriefJob(fakeDeps);
    await expect(job(params)).rejects.toThrow("DB connection failure");
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
