# Design Document: Generate Schema-Constrained Research Briefs

## 1. Problem Being Solved and Why It Matters

The sol-usdc-clmm-intelligence pipeline currently generates rich, structured "Evidence Bundles" containing raw and derived features (price, liquidity, volatility, news, etc.). However, Regime Engine requires high-level, human-readable insights to contextually inform its deterministic policy synthesis. Raw evidence bundles are too verbose for direct human interpretation or holistic regime summarization.

By using an LLM over a bounded set of this structured evidence, we can produce a compact "Research Brief" that extracts key findings, identifies risks, and flags missing evidence. This provides Regime Engine with a synthesized narrative that complements its deterministic rules, while strictly preventing the LLM from making final policy decisions.

## 2. Key Design Decisions and Trade-offs

- **LLM Input Bounding (Full Bundle vs. Projection)**
  - _Decision:_ We will not dump the entire raw evidence bundle into the LLM context. Instead, we will project the bundle into a minimized "LLM Context" object that strips out heavy metadata (like content hashes, deep provenance logs) and retains only high-level taxonomy summaries, feature values, and previous brief context.
  - _Trade-off:_ Reduces token usage and hallucination risk, but requires maintaining a projection function.

- **Output Constraint Mechanism**
  - _Decision:_ Use Zod to define the schema and leverage modern LLM provider features (e.g., OpenAI Structured Outputs or Anthropic Tool Use) to guarantee the output matches the required `ResearchBrief` schema.
  - _Trade-off:_ Couples us to providers that support strict JSON schemas, but ensures pipeline stability.

- **Handling LLM Failures and Invalid Output**
  - _Decision:_ If the LLM API fails, times out, or the output fails schema validation, the system will "fail closed" into a degraded state. We will generate a fallback brief with `confidence: "low"` and explicit warnings (e.g., `["LLM generation failed, falling back to deterministic evidence only"]`).
  - _Trade-off:_ Prevents the pipeline from crashing, but Regime Engine must gracefully handle low-confidence or sparse briefs.

- **Schema Mapping**
  - _Decision:_ The LLM will output a JSON object matching the exact requirements from the issue (headline, key changes, supports-current-regime, major risks, etc.). This payload will be persisted into the `research_briefs.structured_output` JSONB column, and then mapped into the canonical `EvidenceBundle` contract's `ResearchBrief` interface before publication.

## 3. Proposed Approach and Rationale

1. **LLM Port Definition (`src/ports/llm-provider.ts`)**
   Define a port interface `LlmProvider` with a method `generateStructured<T>(prompt: string, context: unknown, schema: ZodSchema<T>): Promise<T>`.

2. **Output Schema (`src/domain/brief/brief-schema.ts`)**
   Define a Zod schema `LlmResearchBriefSchema` mapping directly to the issue's requirements:
   - `pair`, `asOf`, `expiresAt`
   - `sourceBundleRefs`, `sourceRefs`
   - `headline`, `keyChangesSincePriorBrief`, `supportsCurrentRegimeAssessment`, `majorRisks`, `warningsOrMissingEvidence`
   - `confidence`

3. **Prompt Templates (`src/domain/brief/prompts.ts`)**
   Store versioned prompts (e.g., `v1`). The prompt will strictly instruct the model to "only use the provided JSON evidence," "do not invent metrics," and "act as an evidence summarizer, not a policy maker."

4. **Application Use Case (`src/application/generate-research-brief.ts`)**
   An application service that:
   - Fetches the latest assembled `EvidenceBundle`.
   - Fetches the prior `ResearchBrief` to allow the LLM to diff changes.
   - Projects them into a minimal context payload.
   - Invokes the `LlmProvider`.
   - On success, validates with Zod and saves to the `DrizzleBriefRepo`.
   - On failure, generates the fallback degraded brief and saves it.
   - Returns the brief for attachment to the final `EvidenceBundle` publish step.

5. **LLM Adapter (`src/adapters/node/openai-llm-provider.ts` or similar)**
   Implement the port using Vercel AI SDK or native fetch, injecting model metadata and prompt versions into the response.

## 4. Assumptions Made

- **Provider Capabilities:** The configured LLM provider supports strict structured JSON output natively.
- **Environment Context:** The system has access to the "current regime" state to include in the prompt so the LLM can evaluate `supports-current-regime`.
- **Database Schema:** The existing `research_briefs` table's `structuredOutput` (JSONB) column is sufficient to hold the raw LLM output, and we do not need to add new top-level SQL columns for the new fields.
- **No Direct Execution:** The generated brief is strictly informational and will be consumed downstream by Regime Engine. It does not trigger direct transactions in this repository.
- **Authentication:** Standard environment variables (e.g., `LLM_API_KEY`) will be available in the runtime environment.

## 5. Scope

**In Scope:**

- Zod schema for constrained LLM output.
- Versioned prompt templates and context projection logic.
- Definition of an LLM Port and a Node adapter.
- Persistence of the inputs (implicitly via bundle links), outputs, prompt version, and model metadata.
- Fallback behavior (degraded state) on LLM failure or schema mismatch.
- Regression fixtures testing calm, trending, stressed, and sparse-data scenarios against the schema parser and prompt logic.

**Out of Scope:**

- Policy synthesis or decision-making based on the brief.
- Direct user-facing display or copy generation (UI rendering).
- Raw data collection (handled by upstream collectors).
- Modifying the canonical `evidence-bundle.v1` JSON schema beyond ensuring mapping compatibility.

## 6. Risks or Concerns Identified from Code Analysis

- **Token Limits vs. Bundle Size:** `EvidenceBundle` instances can become massive, especially with `on_chain_flow` and `news_events`. If we pass too much raw data to the LLM, we risk context window exhaustion or degraded reasoning. The "projection" step is critical to mitigate this.
- **Latency in Cron Jobs:** LLM inference (especially with structured output on complex data) can take 10-30 seconds. The cron orchestration (`src/jobs`) must account for this latency and handle timeouts to prevent pipeline blockage.
- **Canonical Contract Mismatch:** The generated `evidence-bundle-v1.ts` contract has a `ResearchBrief` interface that differs slightly in naming (e.g., `keyFindings` vs `keyChangesSincePriorBrief`, `uncertainties` vs `majorRisks`). We must implement a precise mapping layer between the LLM output schema and the canonical contract schema to avoid validation failures during bundle publication.
