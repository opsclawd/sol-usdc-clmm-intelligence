import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeBundleRepo } from "../fakes/fake-bundle-repo.js";
import { FakeBriefRepo } from "../fakes/fake-brief-repo.js";
import { FakeLlmProvider } from "../fakes/fake-llm-provider.js";
import { generateResearchBrief } from "../../src/application/generate-research-brief.js";
import type {
  LlmResearchBriefOutput,
  PersistedResearchBrief
} from "../../src/contracts/research-brief.js";
import { RESEARCH_BRIEF_PROMPT_VERSION } from "../../src/domain/brief/prompts.js";
import { canonicalHash } from "../../src/domain/content-hash.js";
import type { EvidenceBundleV1 } from "../../src/contracts/generated/evidence-bundle-v1.js";
import type { ResearchBriefContext } from "../../src/domain/brief/project-context.js";
import { DEFAULT_CONFIDENCE, DEFAULT_PROVENANCE } from "../helpers/taxonomy-fixtures.js";

const calmFixture: EvidenceBundleV1 = JSON.parse(
  readFileSync(resolve(__dirname, "../fixtures/research-brief/calm.json"), "utf8")
);

describe("generateResearchBrief", () => {
  let bundleRepo: FakeBundleRepo;
  let briefRepo: FakeBriefRepo;
  let llmProvider: FakeLlmProvider;

  const evalTimeMs = 1778414400000; // 2026-05-10T12:00:00.000Z
  const expiresAtMs = evalTimeMs + 3600000;

  const validLlmOutput: LlmResearchBriefOutput = {
    summary: "The SOL/USDC pool is in a calm, balanced state with 24.5% fee APR.",
    keyTakeaways: ["Fee APR is healthy at 24.5%", "Price support at 140 USDC is holding"],
    supportsCurrentRegime: "supports",
    regimeAssessmentReasoning: "Market state and support levels indicate stability.",
    confidenceScore: 0.9,
    confidenceReasoning: "Complete data across fee metrics and support levels.",
    sourceEvidenceIds: ["feat-sol-price", "feat-fee-apr", "sr-calm-1"],
    unsupportedOrMissingInputs: []
  };

  beforeEach(() => {
    bundleRepo = new FakeBundleRepo();
    briefRepo = new FakeBriefRepo();
    llmProvider = new FakeLlmProvider();
  });

  async function insertTestBundle(
    bundle: EvidenceBundleV1 = calmFixture,
    asOfMs = evalTimeMs,
    expMs = expiresAtMs,
    isStale = false
  ) {
    const payloadCanonical = JSON.stringify(bundle);
    const payloadHash = await canonicalHash(bundle);
    const outcome = await bundleRepo.insertOrClassify({
      schemaVersion: bundle.schemaVersion,
      pair: bundle.pair,
      asOfUnixMs: asOfMs,
      expiresAtUnixMs: expMs,
      payload: bundle,
      payloadHash,
      payloadCanonical,
      idempotencyKey: `bundle-${asOfMs}`,
      confidence: DEFAULT_CONFIDENCE,
      isStale,
      provenance: DEFAULT_PROVENANCE,
      receivedAtUnixMs: asOfMs
    });
    if (outcome.outcome !== "inserted") {
      throw new Error("Failed to insert test bundle");
    }
    return outcome.row;
  }

  // Required named invariant tests
  it("provider-failure-persists-degraded", async () => {
    await insertTestBundle();
    llmProvider.enqueueError(new Error("LLM API Timeout"));

    const result = await generateResearchBrief(
      { bundleRepo, briefRepo, llmProvider },
      {
        pair: "SOL/USDC",
        evaluationTimeUnixMs: evalTimeMs,
        codeVersion: "1.0.0",
        runId: "run-test-01"
      }
    );

    expect(result.outcome).toBe("generated_degraded");
    if (result.outcome !== "generated_degraded") return;

    expect(result.brief.generationStatus).toBe("degraded");
    expect(result.brief.llmOutput.degradationReason).toBe("model_error");
    expect(result.brief.llmOutput.confidenceScore).toBe(0);

    const rows = await briefRepo.findByBundleId(result.row.evidenceBundleId);
    expect(rows.length).toBe(1);
    expect(rows[0]?.confidence.level).toBe("low");
  });

  it("successful-generation-persists-complete", async () => {
    const bundleRow = await insertTestBundle();
    llmProvider.enqueueResult({
      output: validLlmOutput,
      provider: "openai",
      model: "gpt-4o",
      modelVersion: "2024-08-06"
    });

    const result = await generateResearchBrief(
      { bundleRepo, briefRepo, llmProvider },
      {
        pair: "SOL/USDC",
        evaluationTimeUnixMs: evalTimeMs,
        codeVersion: "1.0.0",
        runId: "run-test-01"
      }
    );

    expect(result.outcome).toBe("generated_complete");
    if (result.outcome !== "generated_complete") return;

    expect(result.brief.generationStatus).toBe("complete");
    expect(result.brief.providerMetadata.provider).toBe("openai");
    expect(result.brief.providerMetadata.model).toBe("gpt-4o");
    expect(result.brief.promptVersion).toBe(RESEARCH_BRIEF_PROMPT_VERSION);
    expect(result.brief.generatedAt).toBe(new Date(evalTimeMs).toISOString());
    expect(result.brief.sourceBundleRef.bundleId).toBe(bundleRow.id);
    expect(result.brief.sourceBundleRef.bundleHash).toBe(bundleRow.payloadHash);
    expect(result.row.evidenceFamily).toBe("market_regime");
    expect(result.row.taxonomySummary).toEqual({
      families: { market_regime: 1 },
      dominantClass: "contextual"
    });

    // Provider receives context projection, never raw bundle row
    const requests = llmProvider.capturedRequests();
    expect(requests.length).toBe(1);
    expect(requests[0]?.context).not.toHaveProperty("id");
    expect(requests[0]?.context).toHaveProperty("features");
    expect(requests[0]?.context).toHaveProperty("inputContextHash");
  });

  it("generation-replay-is-idempotent", async () => {
    await insertTestBundle();
    llmProvider.enqueueResult({
      output: validLlmOutput,
      provider: "openai",
      model: "gpt-4o"
    });

    const first = await generateResearchBrief(
      { bundleRepo, briefRepo, llmProvider },
      {
        pair: "SOL/USDC",
        evaluationTimeUnixMs: evalTimeMs,
        codeVersion: "1.0.0"
      }
    );
    expect(first.outcome).toBe("generated_complete");

    // Second call with identical input should return reused outcome without calling provider again
    const second = await generateResearchBrief(
      { bundleRepo, briefRepo, llmProvider },
      {
        pair: "SOL/USDC",
        evaluationTimeUnixMs: evalTimeMs,
        codeVersion: "1.0.0"
      }
    );

    expect(first.outcome).toBe("generated_complete");
    expect(second.outcome).toBe("reused");
    if (first.outcome === "generated_complete" && second.outcome === "reused") {
      expect(second.row.id).toBe(first.row.id);
    }
    expect(llmProvider.capturedRequests().length).toBe(1);
  });

  it("prior-context-is-bounded", async () => {
    // Insert older bundles & brief to simulate prior context
    const olderTime = evalTimeMs - 2 * 24 * 60 * 60 * 1000;
    const olderBundleRow = await insertTestBundle(calmFixture, olderTime, olderTime + 3600000);

    // Create a complete prior brief for older bundle
    const priorPersisted: PersistedResearchBrief = {
      briefId: `brief-${olderBundleRow.id}-hash`,
      pair: "SOL/USDC",
      generationStatus: "complete",
      llmOutput: validLlmOutput,
      sourceRefs: [],
      providerMetadata: { provider: "openai", model: "gpt-4o" },
      sourceBundleRef: { bundleId: olderBundleRow.id, bundleHash: olderBundleRow.payloadHash },
      inputContextHash: "hash-older-context",
      priorBriefRef: null,
      generatedAt: new Date(olderTime).toISOString(),
      promptVersion: RESEARCH_BRIEF_PROMPT_VERSION
    };

    const priorPayloadHash = await canonicalHash(priorPersisted);
    await briefRepo.insert({
      evidenceBundleId: olderBundleRow.id,
      promptVersion: RESEARCH_BRIEF_PROMPT_VERSION,
      modelProvider: "openai",
      structuredOutput: priorPersisted,
      signalClass: "contextual",
      confidence: DEFAULT_CONFIDENCE,
      payloadHash: priorPayloadHash,
      provenance: DEFAULT_PROVENANCE,
      receivedAtUnixMs: olderTime
    });

    // Now insert current bundle
    await insertTestBundle(calmFixture, evalTimeMs, expiresAtMs);

    llmProvider.enqueueResult({
      output: validLlmOutput,
      provider: "openai",
      model: "gpt-4o"
    });

    const result = await generateResearchBrief(
      { bundleRepo, briefRepo, llmProvider },
      {
        pair: "SOL/USDC",
        evaluationTimeUnixMs: evalTimeMs,
        codeVersion: "1.0.0"
      }
    );

    expect(result.outcome).toBe("generated_complete");
    if (result.outcome === "generated_complete") {
      expect(result.brief.priorBriefRef).not.toBeNull();
      expect(result.brief.priorBriefRef?.payloadHash).toBe(priorPayloadHash);
    }
  });

  it("expired-source-is-not-generated", async () => {
    // Insert an expired bundle
    await insertTestBundle(calmFixture, evalTimeMs - 7200000, evalTimeMs - 3600000);

    const result = await generateResearchBrief(
      { bundleRepo, briefRepo, llmProvider },
      {
        pair: "SOL/USDC",
        evaluationTimeUnixMs: evalTimeMs,
        codeVersion: "1.0.0"
      }
    );

    expect(result.outcome).toBe("no_brief");
    if (result.outcome === "no_brief") {
      expect(result.reason).toBe("expired_source");
    }
    expect(llmProvider.capturedRequests().length).toBe(0);
  });

  // Step 1 additional scenarios
  it("returns no_brief when no bundle exists", async () => {
    const result = await generateResearchBrief(
      { bundleRepo, briefRepo, llmProvider },
      {
        pair: "SOL/USDC",
        evaluationTimeUnixMs: evalTimeMs,
        codeVersion: "1.0.0"
      }
    );

    expect(result.outcome).toBe("no_brief");
    if (result.outcome === "no_brief") {
      expect(result.reason).toBe("no_bundle");
    }
  });

  it("returns no_brief when bundle is stale", async () => {
    await insertTestBundle(calmFixture, evalTimeMs, expiresAtMs, true);

    const result = await generateResearchBrief(
      { bundleRepo, briefRepo, llmProvider },
      {
        pair: "SOL/USDC",
        evaluationTimeUnixMs: evalTimeMs,
        codeVersion: "1.0.0"
      }
    );

    expect(result.outcome).toBe("no_brief");
    if (result.outcome === "no_brief") {
      expect(result.reason).toBe("stale_source");
    }
  });

  it("projects current-regime evidence when supplied", async () => {
    await insertTestBundle();
    llmProvider.enqueueResult({
      output: validLlmOutput,
      provider: "openai",
      model: "gpt-4o"
    });

    const result = await generateResearchBrief(
      { bundleRepo, briefRepo, llmProvider },
      {
        pair: "SOL/USDC",
        evaluationTimeUnixMs: evalTimeMs,
        codeVersion: "1.0.0",
        currentRegimeEvidence: {
          regimeLabel: "calm_range",
          confidenceBps: 8500,
          supportingReasoning: "Low volatility and balanced pool reserves."
        }
      }
    );

    expect(result.outcome).toBe("generated_complete");
    const req = llmProvider.capturedRequests()[0];
    const ctx = req?.context as ResearchBriefContext;
    expect(ctx.currentRegimeEvidence).toBeDefined();
    expect(ctx.currentRegimeEvidence?.regimeLabel).toBe("calm_range");
  });

  it("persists degraded brief on ungrounded evidence reference in LLM output", async () => {
    await insertTestBundle();
    const ungroundedOutput: LlmResearchBriefOutput = {
      ...validLlmOutput,
      sourceEvidenceIds: ["non-existent-feature-id"]
    };
    llmProvider.enqueueResult({
      output: ungroundedOutput,
      provider: "openai",
      model: "gpt-4o"
    });

    const result = await generateResearchBrief(
      { bundleRepo, briefRepo, llmProvider },
      {
        pair: "SOL/USDC",
        evaluationTimeUnixMs: evalTimeMs,
        codeVersion: "1.0.0"
      }
    );

    expect(result.outcome).toBe("generated_degraded");
    if (result.outcome === "generated_degraded") {
      expect(result.brief.llmOutput.degradationReason).toBe("schema_validation_failed");
    }
  });

  it("propagates repository write failure without catching as degraded", async () => {
    await insertTestBundle();
    llmProvider.enqueueResult({
      output: validLlmOutput,
      provider: "openai",
      model: "gpt-4o"
    });

    briefRepo.insert = async () => {
      throw new Error("DB Connection Error");
    };

    await expect(
      generateResearchBrief(
        { bundleRepo, briefRepo, llmProvider },
        {
          pair: "SOL/USDC",
          evaluationTimeUnixMs: evalTimeMs,
          codeVersion: "1.0.0"
        }
      )
    ).rejects.toThrow("DB Connection Error");
  });
});
