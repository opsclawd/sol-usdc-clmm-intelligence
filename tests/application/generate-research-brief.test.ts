import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeBundleRepo } from "../fakes/fake-bundle-repo.js";
import { FakeBriefRepo } from "../fakes/fake-brief-repo.js";
import { FakeLlmProvider } from "../fakes/fake-llm-provider.js";
import {
  generateResearchBrief,
  persistResearchBrief,
  generateAndPersistResearchBrief
} from "../../src/application/generate-research-brief.js";
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

  let bundleCounter = 0;
  async function insertTestBundle(
    bundle: EvidenceBundleV1 = calmFixture,
    asOfMs = evalTimeMs,
    expMs = expiresAtMs,
    isStale = false,
    idempotencyKey?: string
  ) {
    bundleCounter++;
    const payloadHash = await canonicalHash(bundle);
    const outcome = await bundleRepo.insertOrClassify({
      schemaVersion: bundle.schemaVersion,
      pair: bundle.pair,
      asOfUnixMs: asOfMs,
      expiresAtUnixMs: expMs,
      payload: bundle,
      payloadHash,
      payloadCanonical: JSON.stringify(bundle),
      idempotencyKey: idempotencyKey ?? `bundle-${asOfMs}-${bundleCounter}`,
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

  describe("target selection and prior context", () => {
    it("candidate generation excludes newer and same-time prior bundles", async () => {
      const baseTime = evalTimeMs - 100000;
      const targetAsOfIso = new Date(baseTime).toISOString();

      const olderBundleRow = await insertTestBundle(calmFixture, baseTime - 10000, expiresAtMs);
      const olderPersisted: PersistedResearchBrief = {
        briefId: `brief-${olderBundleRow.id}`,
        pair: "SOL/USDC",
        generationStatus: "complete",
        llmOutput: validLlmOutput,
        sourceRefs: [],
        providerMetadata: { provider: "openai", model: "gpt-4o" },
        sourceBundleRef: { bundleId: olderBundleRow.id, bundleHash: olderBundleRow.payloadHash },
        inputContextHash: "hash-older",
        priorBriefRef: null,
        generatedAt: new Date(baseTime - 10000).toISOString(),
        promptVersion: RESEARCH_BRIEF_PROMPT_VERSION
      };
      await briefRepo.insert({
        evidenceBundleId: olderBundleRow.id,
        promptVersion: RESEARCH_BRIEF_PROMPT_VERSION,
        modelProvider: "openai",
        structuredOutput: olderPersisted,
        signalClass: "contextual",
        confidence: DEFAULT_CONFIDENCE,
        payloadHash: await canonicalHash(olderPersisted),
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: baseTime - 10000
      });

      const sameTimeBundleRow = await insertTestBundle(calmFixture, baseTime, expiresAtMs);
      const sameTimePersisted: PersistedResearchBrief = {
        briefId: `brief-${sameTimeBundleRow.id}`,
        pair: "SOL/USDC",
        generationStatus: "complete",
        llmOutput: validLlmOutput,
        sourceRefs: [],
        providerMetadata: { provider: "openai", model: "gpt-4o" },
        sourceBundleRef: {
          bundleId: sameTimeBundleRow.id,
          bundleHash: sameTimeBundleRow.payloadHash
        },
        inputContextHash: "hash-sametime",
        priorBriefRef: null,
        generatedAt: new Date(baseTime).toISOString(),
        promptVersion: RESEARCH_BRIEF_PROMPT_VERSION
      };
      await briefRepo.insert({
        evidenceBundleId: sameTimeBundleRow.id,
        promptVersion: RESEARCH_BRIEF_PROMPT_VERSION,
        modelProvider: "openai",
        structuredOutput: sameTimePersisted,
        signalClass: "contextual",
        confidence: DEFAULT_CONFIDENCE,
        payloadHash: await canonicalHash(sameTimePersisted),
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: baseTime
      });

      const newerBundleRow = await insertTestBundle(calmFixture, baseTime + 10000, expiresAtMs);
      const newerPersisted: PersistedResearchBrief = {
        briefId: `brief-${newerBundleRow.id}`,
        pair: "SOL/USDC",
        generationStatus: "complete",
        llmOutput: validLlmOutput,
        sourceRefs: [],
        providerMetadata: { provider: "openai", model: "gpt-4o" },
        sourceBundleRef: { bundleId: newerBundleRow.id, bundleHash: newerBundleRow.payloadHash },
        inputContextHash: "hash-newer",
        priorBriefRef: null,
        generatedAt: new Date(baseTime + 10000).toISOString(),
        promptVersion: RESEARCH_BRIEF_PROMPT_VERSION
      };
      await briefRepo.insert({
        evidenceBundleId: newerBundleRow.id,
        promptVersion: RESEARCH_BRIEF_PROMPT_VERSION,
        modelProvider: "openai",
        structuredOutput: newerPersisted,
        signalClass: "contextual",
        confidence: DEFAULT_CONFIDENCE,
        payloadHash: await canonicalHash(newerPersisted),
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: baseTime + 10000
      });

      const candidatePayload: EvidenceBundleV1 = {
        ...calmFixture,
        asOf: targetAsOfIso
      };

      llmProvider.enqueueResult({ output: validLlmOutput, provider: "openai", model: "gpt-4o" });

      const result = await generateResearchBrief(
        { bundleRepo, briefRepo, llmProvider },
        {
          evidenceBundlePayload: candidatePayload,
          pair: "SOL/USDC",
          evaluationTimeUnixMs: evalTimeMs,
          codeVersion: "1.0.0"
        }
      );

      expect(result.outcome).toBe("generated_complete");
      if (result.outcome !== "generated_complete") return;

      expect(result.brief.priorBriefRef).not.toBeNull();
      expect(result.brief.priorBriefRef?.briefId).toBe(olderPersisted.briefId);
    });

    it("selects prior context deterministically by bundle and brief tie-breakers", async () => {
      const olderTime = evalTimeMs - 50000;

      await insertTestBundle(calmFixture, olderTime, expiresAtMs);
      const bundleB = await insertTestBundle(calmFixture, olderTime, expiresAtMs);

      const briefB1Persisted: PersistedResearchBrief = {
        briefId: `brief-${bundleB.id}-1`,
        pair: "SOL/USDC",
        generationStatus: "complete",
        llmOutput: validLlmOutput,
        sourceRefs: [],
        providerMetadata: { provider: "openai", model: "gpt-4o" },
        sourceBundleRef: { bundleId: bundleB.id, bundleHash: bundleB.payloadHash },
        inputContextHash: "hash-b1",
        priorBriefRef: null,
        generatedAt: new Date(olderTime).toISOString(),
        promptVersion: RESEARCH_BRIEF_PROMPT_VERSION
      };
      const briefB1 = await briefRepo.insert({
        evidenceBundleId: bundleB.id,
        promptVersion: RESEARCH_BRIEF_PROMPT_VERSION,
        modelProvider: "openai",
        structuredOutput: briefB1Persisted,
        signalClass: "contextual",
        confidence: DEFAULT_CONFIDENCE,
        payloadHash: await canonicalHash(briefB1Persisted),
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: olderTime
      });

      const briefB2Persisted: PersistedResearchBrief = {
        briefId: `brief-${bundleB.id}-2`,
        pair: "SOL/USDC",
        generationStatus: "complete",
        llmOutput: validLlmOutput,
        sourceRefs: [],
        providerMetadata: { provider: "openai", model: "gpt-4o" },
        sourceBundleRef: { bundleId: bundleB.id, bundleHash: bundleB.payloadHash },
        inputContextHash: "hash-b2",
        priorBriefRef: null,
        generatedAt: new Date(olderTime).toISOString(),
        promptVersion: RESEARCH_BRIEF_PROMPT_VERSION
      };
      const briefB2 = await briefRepo.insert({
        evidenceBundleId: bundleB.id,
        promptVersion: RESEARCH_BRIEF_PROMPT_VERSION,
        modelProvider: "openai",
        structuredOutput: briefB2Persisted,
        signalClass: "contextual",
        confidence: DEFAULT_CONFIDENCE,
        payloadHash: await canonicalHash(briefB2Persisted),
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: olderTime
      });

      const higherBrief = briefB2.id > briefB1.id ? briefB2Persisted : briefB1Persisted;

      const candidatePayload: EvidenceBundleV1 = {
        ...calmFixture,
        asOf: new Date(evalTimeMs).toISOString()
      };

      llmProvider.enqueueResult({ output: validLlmOutput, provider: "openai", model: "gpt-4o" });
      const result1 = await generateResearchBrief(
        { bundleRepo, briefRepo, llmProvider },
        {
          evidenceBundlePayload: candidatePayload,
          pair: "SOL/USDC",
          evaluationTimeUnixMs: evalTimeMs,
          codeVersion: "1.0.0"
        }
      );

      expect(result1.outcome).toBe("generated_complete");
      if (result1.outcome !== "generated_complete") return;
      expect(result1.brief.priorBriefRef?.briefId).toBe(higherBrief.briefId);
    });
  });

  describe("generation and degradation", () => {
    it("brief generation does not write before bundle identity exists", async () => {
      llmProvider.enqueueResult({ output: validLlmOutput, provider: "openai", model: "gpt-4o" });

      const result = await generateResearchBrief(
        { bundleRepo, briefRepo, llmProvider },
        {
          evidenceBundlePayload: calmFixture,
          pair: "SOL/USDC",
          evaluationTimeUnixMs: evalTimeMs,
          codeVersion: "1.0.0"
        }
      );

      expect(result.outcome).toBe("generated_complete");
      if (result.outcome === "generated_complete") {
        expect(result.brief).toBeDefined();
        expect(result).not.toHaveProperty("row");
      }
      const existing = await briefRepo.findByBundleId(0);
      expect(existing.length).toBe(0);
    });

    it("degraded generation carries deterministic grounded fallback evidence IDs", async () => {
      llmProvider.enqueueError(new Error("LLM provider timeout"));

      const result = await generateResearchBrief(
        { bundleRepo, briefRepo, llmProvider },
        {
          evidenceBundlePayload: calmFixture,
          pair: "SOL/USDC",
          evaluationTimeUnixMs: evalTimeMs,
          codeVersion: "1.0.0"
        }
      );

      expect(result.outcome).toBe("generated_degraded");
      if (result.outcome === "generated_degraded") {
        expect(result.brief.generationStatus).toBe("degraded");
        expect(result.brief.llmOutput.sourceEvidenceIds.length).toBeGreaterThan(0);
        expect(result.brief.llmOutput.sourceEvidenceIds).toContain("feat-sol-price");
        expect(result.brief.llmOutput.sourceEvidenceIds.length).toBeLessThanOrEqual(256);
      }
    });

    it("successful candidate generation passes context projection to provider", async () => {
      llmProvider.enqueueResult({
        output: validLlmOutput,
        provider: "openai",
        model: "gpt-4o",
        modelVersion: "2024-08-06"
      });

      const result = await generateResearchBrief(
        { bundleRepo, briefRepo, llmProvider },
        {
          evidenceBundlePayload: calmFixture,
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

      const requests = llmProvider.capturedRequests();
      expect(requests.length).toBe(1);
      expect(requests[0]?.context).not.toHaveProperty("id");
      expect(requests[0]?.context).toHaveProperty("features");
      expect(requests[0]?.context).toHaveProperty("inputContextHash");
    });

    it("projects current-regime evidence when supplied", async () => {
      llmProvider.enqueueResult({
        output: validLlmOutput,
        provider: "openai",
        model: "gpt-4o"
      });

      const result = await generateResearchBrief(
        { bundleRepo, briefRepo, llmProvider },
        {
          evidenceBundlePayload: calmFixture,
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

    it("degrades a candidate brief when sourceEvidenceIds is empty", async () => {
      llmProvider.enqueueResult({
        output: { ...validLlmOutput, sourceEvidenceIds: [] },
        provider: "openai",
        model: "gpt-4o"
      });

      const result = await generateResearchBrief(
        { bundleRepo, briefRepo, llmProvider },
        {
          evidenceBundlePayload: calmFixture,
          pair: "SOL/USDC",
          evaluationTimeUnixMs: evalTimeMs,
          codeVersion: "1.0.0"
        }
      );

      expect(result.outcome).toBe("generated_degraded");
      if (result.outcome !== "generated_degraded") return;
      expect(result.brief.generationStatus).toBe("degraded");
      expect(result.brief.llmOutput.degradationReason).toBe("schema_validation_failed");
      expect(result.brief.llmOutput.sourceEvidenceIds.length).toBeGreaterThan(0);
    });

    it("degrades candidate brief on ungrounded evidence reference in LLM output", async () => {
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
          evidenceBundlePayload: calmFixture,
          pair: "SOL/USDC",
          evaluationTimeUnixMs: evalTimeMs,
          codeVersion: "1.0.0"
        }
      );

      expect(result.outcome).toBe("generated_degraded");
      if (result.outcome === "generated_degraded") {
        expect(result.brief.llmOutput.degradationReason).toBe("schema_validation_failed");
        expect(result.brief.llmOutput.sourceEvidenceIds.length).toBeGreaterThan(0);
      }
    });
  });

  describe("replay and idempotency", () => {
    it("candidate generation reuses a complete matching input context without an LLM call", async () => {
      const bundleRow = await insertTestBundle(calmFixture, evalTimeMs, expiresAtMs);
      llmProvider.enqueueResult({ output: validLlmOutput, provider: "openai", model: "gpt-4o" });
      const first = await generateResearchBrief(
        { bundleRepo, briefRepo, llmProvider },
        {
          evidenceBundlePayload: calmFixture,
          pair: "SOL/USDC",
          evaluationTimeUnixMs: evalTimeMs,
          codeVersion: "1.0.0"
        }
      );
      expect(first.outcome).toBe("generated_complete");
      if (first.outcome !== "generated_complete") return;

      await persistResearchBrief(
        { briefRepo },
        {
          bundleId: bundleRow.id,
          bundleHash: bundleRow.payloadHash,
          brief: first.brief,
          pair: "SOL/USDC",
          evaluationTimeUnixMs: evalTimeMs,
          codeVersion: "1.0.0",
          expiresAtUnixMs: expiresAtMs
        }
      );

      expect(llmProvider.capturedRequests().length).toBe(1);

      const second = await generateResearchBrief(
        { bundleRepo, briefRepo, llmProvider },
        {
          evidenceBundlePayload: calmFixture,
          pair: "SOL/USDC",
          evaluationTimeUnixMs: evalTimeMs,
          codeVersion: "1.0.0"
        }
      );

      expect(second.outcome).toBe("reused");
      expect(llmProvider.capturedRequests().length).toBe(1);
    });

    it("does not reuse degraded briefs on retry", async () => {
      const bundleRow = await insertTestBundle(calmFixture, evalTimeMs, expiresAtMs);
      llmProvider.enqueueError(new Error("LLM API Timeout"));

      const first = await generateResearchBrief(
        { bundleRepo, briefRepo, llmProvider },
        {
          evidenceBundlePayload: calmFixture,
          pair: "SOL/USDC",
          evaluationTimeUnixMs: evalTimeMs,
          codeVersion: "1.0.0"
        }
      );
      expect(first.outcome).toBe("generated_degraded");
      if (first.outcome !== "generated_degraded") return;

      await persistResearchBrief(
        { briefRepo },
        {
          bundleId: bundleRow.id,
          bundleHash: bundleRow.payloadHash,
          brief: first.brief,
          pair: "SOL/USDC",
          evaluationTimeUnixMs: evalTimeMs,
          codeVersion: "1.0.0",
          expiresAtUnixMs: expiresAtMs
        }
      );

      llmProvider.enqueueResult({
        output: validLlmOutput,
        provider: "openai",
        model: "gpt-4o"
      });

      const second = await generateResearchBrief(
        { bundleRepo, briefRepo, llmProvider },
        {
          evidenceBundlePayload: calmFixture,
          pair: "SOL/USDC",
          evaluationTimeUnixMs: evalTimeMs,
          codeVersion: "1.0.0"
        }
      );

      expect(second.outcome).toBe("generated_complete");
      expect(llmProvider.capturedRequests().length).toBe(2);
    });
  });

  describe("persistence and errors", () => {
    it("brief persistence binds the final bundle id and hash", async () => {
      llmProvider.enqueueResult({ output: validLlmOutput, provider: "openai", model: "gpt-4o" });

      const generated = await generateResearchBrief(
        { bundleRepo, briefRepo, llmProvider },
        {
          evidenceBundlePayload: calmFixture,
          pair: "SOL/USDC",
          evaluationTimeUnixMs: evalTimeMs,
          codeVersion: "1.0.0"
        }
      );
      expect(generated.outcome).toBe("generated_complete");
      if (generated.outcome !== "generated_complete") return;

      const finalBundleId = 42;
      const finalBundleHash = "hash-bundle-42";

      const row = await persistResearchBrief(
        { briefRepo },
        {
          bundleId: finalBundleId,
          bundleHash: finalBundleHash,
          brief: generated.brief,
          pair: "SOL/USDC",
          evaluationTimeUnixMs: evalTimeMs,
          codeVersion: "1.0.0",
          expiresAtUnixMs: expiresAtMs
        }
      );

      expect(row.evidenceBundleId).toBe(finalBundleId);
      const persisted = row.structuredOutput as PersistedResearchBrief;
      expect(persisted.sourceBundleRef.bundleId).toBe(finalBundleId);
      expect(persisted.sourceBundleRef.bundleHash).toBe(finalBundleHash);

      const bundleSourceRef = persisted.sourceRefs.find((r) => r.refType === "evidence_bundle");
      expect(bundleSourceRef?.id).toBe(finalBundleId);
      expect(bundleSourceRef?.payloadHash).toBe(finalBundleHash);

      const bundleDerivedRef = row.provenance.derivedFromRefs.find(
        (r) => r.refType === "evidence_bundle"
      );
      expect(bundleDerivedRef?.id).toBe(finalBundleId);
      expect(bundleDerivedRef?.payloadHash).toBe(finalBundleHash);

      const storedRows = await briefRepo.findByBundleId(finalBundleId);
      expect(storedRows.length).toBe(1);
    });

    it("propagates repository write failure when persisting brief", async () => {
      llmProvider.enqueueResult({
        output: validLlmOutput,
        provider: "openai",
        model: "gpt-4o"
      });

      const generated = await generateResearchBrief(
        { bundleRepo, briefRepo, llmProvider },
        {
          evidenceBundlePayload: calmFixture,
          pair: "SOL/USDC",
          evaluationTimeUnixMs: evalTimeMs,
          codeVersion: "1.0.0"
        }
      );
      expect(generated.outcome).toBe("generated_complete");
      if (generated.outcome !== "generated_complete") return;

      briefRepo.insert = async () => {
        throw new Error("DB Connection Error");
      };

      await expect(
        persistResearchBrief(
          { briefRepo },
          {
            bundleId: 1,
            bundleHash: "hash-1",
            brief: generated.brief,
            pair: "SOL/USDC",
            evaluationTimeUnixMs: evalTimeMs,
            codeVersion: "1.0.0",
            expiresAtUnixMs: expiresAtMs
          }
        )
      ).rejects.toThrow("DB Connection Error");
    });
  });

  describe("compatibility facade (generateAndPersistResearchBrief)", () => {
    it("targets requested bundle by ID when same-pair bundles coexist", async () => {
      const target = await insertTestBundle(calmFixture, evalTimeMs - 1_000, expiresAtMs);
      const newer = await insertTestBundle(calmFixture, evalTimeMs, expiresAtMs);
      llmProvider.enqueueResult({ output: validLlmOutput, provider: "openai", model: "gpt-4o" });

      const result = await generateAndPersistResearchBrief(
        { bundleRepo, briefRepo, llmProvider },
        {
          evidenceBundleId: target.id,
          pair: "SOL/USDC",
          evaluationTimeUnixMs: evalTimeMs,
          codeVersion: "1.0.0"
        }
      );

      expect(result.outcome).toBe("generated_complete");
      if (result.outcome !== "generated_complete") return;
      expect(result.row.evidenceBundleId).toBe(target.id);
      expect(result.row.evidenceBundleId).not.toBe(newer.id);
    });

    it("returns no_brief without falling back when requested bundle ID does not exist", async () => {
      const bundleRow = await insertTestBundle(calmFixture, evalTimeMs, expiresAtMs);
      const nonExistentId = bundleRow.id + 999;

      const result = await generateAndPersistResearchBrief(
        { bundleRepo, briefRepo, llmProvider },
        {
          evidenceBundleId: nonExistentId,
          pair: "SOL/USDC",
          evaluationTimeUnixMs: evalTimeMs,
          codeVersion: "1.0.0"
        }
      );

      expect(result).toEqual({ outcome: "no_brief", reason: "no_bundle" });
      expect(llmProvider.capturedRequests().length).toBe(0);
      const briefs = await briefRepo.findByBundleId(nonExistentId);
      expect(briefs.length).toBe(0);
    });

    it("returns no_brief when bundle is stale", async () => {
      const staleBundleRow = await insertTestBundle(calmFixture, evalTimeMs, expiresAtMs, true);

      const result = await generateAndPersistResearchBrief(
        { bundleRepo, briefRepo, llmProvider },
        {
          evidenceBundleId: staleBundleRow.id,
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

    it("returns no_brief when bundle is expired", async () => {
      const expiredBundleRow = await insertTestBundle(
        calmFixture,
        evalTimeMs - 7200000,
        evalTimeMs - 3600000
      );

      const result = await generateAndPersistResearchBrief(
        { bundleRepo, briefRepo, llmProvider },
        {
          evidenceBundleId: expiredBundleRow.id,
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
  });
});
