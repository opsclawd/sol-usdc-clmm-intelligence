<!-- plan-review-required -->

# Schema-Constrained Research Briefs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate schema-constrained, source-grounded SOL/USDC research briefs from bounded evidence-bundle projections, persist complete or explicitly degraded artifacts with model/prompt lineage, and attach only valid complete briefs to the canonical payload sent to Regime Engine.

**Architecture:** Add pure brief-domain modules for schemas, prompts, projection, cross-reference validation, fallback construction, and canonical-contract mapping. A provider-agnostic port is implemented by one OpenAI-compatible Node adapter; the application use case loads the latest immutable base bundle and bounded prior context, invokes the provider, validates or degrades the result, and appends a `research_briefs` row. Publication remains the only irreversible external side effect: it composes an eligible persisted brief into a copy of the base payload, revalidates and rehashes that copy, and audits the exact brief and composed hash without changing the stored bundle.

**Tech Stack:** TypeScript, Zod, `zod-to-json-schema`, Vitest, Drizzle-backed repository ports, the existing `HttpClient`, and the pinned `evidence-bundle.v1` contract.

---

## Goal

- Bound every model input by deterministic item, string, and serialized-byte limits.
- Treat provider output as untrusted until Zod and source-reference validation pass.
- Persist prompt version, input fingerprint/references, generation status, confidence, and provider/model metadata.
- Fail closed to a low-confidence degraded artifact for provider, timeout, malformed-output, unsupported-reference, or oversized-context failures.
- Publish only complete, current, source-matching briefs; retain the deterministic-only bundle when no eligible brief exists.

## Non-goals

- Do not change the pinned Regime Engine JSON Schema or generated `EvidenceBundleV1` declarations.
- Do not synthesize regimes, rebalance recommendations, position instructions, or final `PolicyInsight` values.
- Do not add raw-data collectors, automatic current-regime fetching, provider retries, streaming, or multi-provider failover.
- Do not persist secrets, full HTTP request/response envelopes, chain-of-thought, or an uncontrolled copy of the evidence bundle.
- Do not mutate an existing `evidence_bundles` row after a brief is generated.

## Affected files

- `package.json`
- `pnpm-lock.yaml`
- `.env.example`
- `README.md`
- `docs/operator-runbook.md`
- `src/contracts/research-brief.ts`
- `src/contracts/index.ts`
- `src/domain/brief/brief-schema.ts`
- `src/domain/brief/prompts.ts`
- `src/domain/brief/project-context.ts`
- `src/domain/brief/map-to-evidence-bundle.ts`
- `src/domain/brief/index.ts`
- `src/ports/llm-provider.ts`
- `src/ports/index.ts`
- `src/adapters/node/openai-llm-provider.ts`
- `src/application/generate-research-brief.ts`
- `src/jobs/generate-research-brief-job.ts`
- `src/jobs/index.ts`
- `scripts/generate/research-brief.ts`
- `src/application/publish-evidence-bundle.ts`
- `src/jobs/publish-evidence-bundle-job.ts`
- `scripts/collectors/publish-evidence-bundle.ts`
- `src/adapters/node/composition-root.ts`
- `tests/fakes/fake-llm-provider.ts`
- `tests/fakes/index.ts`
- `tests/domain/brief/brief-schema.test.ts`
- `tests/domain/brief/project-context.test.ts`
- `tests/domain/brief/map-to-evidence-bundle.test.ts`
- `tests/adapters/node/openai-llm-provider.test.ts`
- `tests/application/generate-research-brief.test.ts`
- `tests/jobs/generate-research-brief-job.test.ts`
- `tests/scripts/research-brief.test.ts`
- `tests/application/publish-evidence-bundle.test.ts`
- `tests/scripts/publish-evidence-bundle.test.ts`
- `tests/fixtures/research-brief/calm.json`
- `tests/fixtures/research-brief/trending.json`
- `tests/fixtures/research-brief/stressed.json`
- `tests/fixtures/research-brief/sparse.json`

## Behavioral invariants

1. `bounded-context-is-deterministic`: the same bundle/prior/current-regime input always produces the same ordered projection and input hash.
2. `bounded-context-rejects-byte-overflow`: a projection above 65,536 serialized UTF-8 bytes is never sent to the provider.
3. `unsupported-model-references-degrade`: any model-returned evidence or source ID absent from the bounded context produces a degraded artifact.
4. `canonical-mapping-resolves-lineage`: the mapped canonical brief references only feature/context IDs present in its source bundle.
5. `provider-failure-persists-degraded`: provider rejection, timeout, malformed JSON, or schema failure persists one low-confidence degraded artifact with an explicit warning.
6. `successful-generation-persists-complete`: valid grounded output persists one complete artifact with deterministic timestamps, prompt version, input hash, and adapter-supplied model metadata.
7. `generation-replay-is-idempotent`: identical source bundle, projection, prompt, model metadata, and structured result reuse the existing bundle-plus-payload-hash row.
8. `prior-context-is-bounded`: inspect at most 10 bundles from the previous seven days and use only the newest valid prior artifact.
9. `expired-source-is-not-generated`: an expired or stale source bundle yields `no_brief` without provider or database writes.
10. `job-closes-db-on-completion-or-degradation`: successful or degraded research brief generation closes the shared database connection before exiting with code 0.
11. `job-closes-db-on-unhandled-error`: unhandled configuration, validation, or persistence errors close the shared database connection before propagating or exiting with a non-zero exit code.
12. `publisher-attaches-only-eligible-complete-brief`: only the latest complete, schema-valid, source-bundle-matching, unexpired brief is attached.
13. `publisher-fails-closed-on-invalid-stored-brief`: malformed, degraded, expired, or mismatched brief rows leave the base deterministic-only payload unchanged.
14. `publisher-audits-composed-payload`: when a brief is attached, every retry uses the same composed payload/hash/idempotency key and records its `researchBriefId`.
15. `publisher-retry-payload-is-stable`: all retry attempts reuse the one precomputed composed payload, hash, idempotency key, and brief ID.

## Task 1: Define the research brief contracts, schemas, and prompt

**Files:**

- Create: `src/contracts/research-brief.ts`
- Modify: `src/contracts/index.ts`
- Create: `src/domain/brief/brief-schema.ts`
- Create: `src/domain/brief/prompts.ts`
- Create: `src/domain/brief/index.ts`
- Create: `tests/domain/brief/brief-schema.test.ts`

- [ ] **Step 1: Write failing schema and prompt tests**

Cover exact parsing of a complete artifact and a degraded artifact; rejection of unknown keys, invalid timestamps, empty source/evidence references, overlong arrays/strings, invalid confidence, and policy language such as direct rebalance instructions. Assert that `RESEARCH_BRIEF_PROMPT_V1` says to use only supplied evidence, preserve numeric units, report missing evidence, and never make policy or transaction decisions.

- [ ] **Step 2: Run the focused test and confirm missing-module failures**

Run: `pnpm test tests/domain/brief/brief-schema.test.ts`

Expected: FAIL because the research-brief contract and domain modules do not exist.

- [ ] **Step 3: Add the contract and strict schemas**

Define `ResearchBriefGenerationStatus = "complete" | "degraded"`, `SupportsCurrentRegime = "supports" | "contradicts" | "unclear" | "not_applicable"`, provider metadata, source-bundle references, the grounded narrative fields from the issue, `sourceEvidenceIds`, `sourceRefs`, `inputContextHash`, nullable `priorBriefRef`, `generatedAt`, `promptVersion`, and an optional closed degradation-reason enum. Export `LlmResearchBriefOutputSchema` for model-controlled narrative/reference fields and `PersistedResearchBriefSchema` for the full deterministic envelope. Keep `pair`, lifecycle timestamps, prompt/model metadata, input hashes, and generation status application-controlled rather than trusting the model to echo them.

- [ ] **Step 4: Add the versioned prompt**

Export `RESEARCH_BRIEF_PROMPT_VERSION = "research-brief/v1"` and a fixed system prompt that requires JSON-only evidence summarization, explicit unsupported/missing-input warnings, citation by provided IDs, no invented metrics, no policy synthesis, and no transaction/rebalance instructions.

- [ ] **Step 5: Export the new declarations and pass focused checks**

Run: `pnpm test tests/domain/brief/brief-schema.test.ts`

Expected: PASS.

Run: `pnpm exec eslint src/contracts/research-brief.ts src/contracts/index.ts src/domain/brief/brief-schema.ts src/domain/brief/prompts.ts src/domain/brief/index.ts tests/domain/brief/brief-schema.test.ts --max-warnings 0`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/contracts/research-brief.ts src/contracts/index.ts src/domain/brief/brief-schema.ts src/domain/brief/prompts.ts src/domain/brief/index.ts tests/domain/brief/brief-schema.test.ts
git commit -m "feat(briefs): define constrained research brief contract"
```

## Task 2: Build bounded context projection, regression fixtures, and canonical mapping

**Files:**

- Create: `src/domain/brief/project-context.ts`
- Create: `src/domain/brief/map-to-evidence-bundle.ts`
- Modify: `src/domain/brief/index.ts`
- Create: `tests/domain/brief/project-context.test.ts`
- Create: `tests/domain/brief/map-to-evidence-bundle.test.ts`
- Create: `tests/fixtures/research-brief/calm.json`
- Create: `tests/fixtures/research-brief/trending.json`
- Create: `tests/fixtures/research-brief/stressed.json`
- Create: `tests/fixtures/research-brief/sparse.json`

**Invariants to test first:**

- `bounded-context-is-deterministic`: sort feature IDs, contextual claims, source references, and warnings before hashing.
- `bounded-context-rejects-byte-overflow`: enforce 64 features, 16 claims per contextual family, 64 source references, 512 characters per copied text field, and 65,536 total UTF-8 bytes.
- `unsupported-model-references-degrade`: validate `sourceEvidenceIds` and `sourceRefs` as non-empty subsets of IDs present in the projection.
- `canonical-mapping-resolves-lineage`: the mapped canonical brief references only feature/context IDs present in its source bundle.

- [ ] **Step 1: Add four bounded fixtures and failing projection tests**

Each fixture must be a compact `EvidenceBundleV1` scenario: calm/complete, trending with a prior brief, stressed with mixed contextual warnings, and sparse with unavailable families. Tests must assert exact selected IDs/order, truncation warnings, missing-family warnings, prior-brief minimization, optional current-regime projection, byte-cap rejection, and stable `inputContextHash`.

- [ ] **Step 2: Add failing canonical-mapping tests**

Assert that a complete persisted artifact maps to canonical `ResearchBrief` fields (`headline` to `summary`, changes/risks to bounded `keyFindings`/`uncertainties`, deterministic model metadata, and grounded evidence IDs), changes coverage to `available`, removes only `RESEARCH_BRIEF_UNAVAILABLE`, and leaves the source object untouched. Assert that degraded artifacts are ineligible for mapping.

- [ ] **Step 3: Run focused tests and confirm missing exports**

Run: `pnpm test tests/domain/brief/project-context.test.ts tests/domain/brief/map-to-evidence-bundle.test.ts`

Expected: FAIL because projection and mapping functions are absent.

- [ ] **Step 4: Implement deterministic projection and grounding validation**

Export `projectResearchBriefContext`, `validateGroundedReferences`, `ResearchBriefContext`, `ResearchBriefContextError`, and the named limits. Include only normalized feature values/status/units/confidence/warnings, bounded contextual claim summaries, referenced source metadata, assessment coverage/warnings, a minimized prior artifact, and optional caller-supplied current-regime evidence. Compute the hash with `canonicalHash`; throw the closed `CONTEXT_TOO_LARGE` error before provider invocation when the byte cap is exceeded.

- [ ] **Step 5: Implement non-mutating canonical mapping**

Export `mapPersistedBriefToCanonicalBundle(base, artifact, briefId)`. Return a copied `EvidenceBundleV1`, cap contract arrays at 32 entries, update research-brief coverage/warnings consistently, and throw on degraded status or unresolved evidence IDs.

- [ ] **Step 6: Pass focused checks and commit**

Run: `pnpm test tests/domain/brief/project-context.test.ts tests/domain/brief/map-to-evidence-bundle.test.ts`

Expected: PASS for calm, trending, stressed, sparse, overflow, grounding, and non-mutation cases.

Run: `pnpm exec eslint src/domain/brief/project-context.ts src/domain/brief/map-to-evidence-bundle.ts src/domain/brief/index.ts tests/domain/brief/project-context.test.ts tests/domain/brief/map-to-evidence-bundle.test.ts --max-warnings 0`

Expected: exit 0.

```bash
git add src/domain/brief tests/domain/brief tests/fixtures/research-brief
git commit -m "feat(briefs): bound evidence context and canonical mapping"
```

## Task 3: Add the LLM provider port and all implementations

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/ports/llm-provider.ts`
- Modify: `src/ports/index.ts`
- Create: `src/adapters/node/openai-llm-provider.ts`
- Create: `tests/fakes/fake-llm-provider.ts`
- Modify: `tests/fakes/index.ts`
- Create: `tests/adapters/node/openai-llm-provider.test.ts`

This task intentionally keeps the new `LlmProvider.generateStructured` method, its production adapter, and test fake in one typecheck-safe change. `NodeRuntime` remains unchanged so existing collector runtime fixtures continue to typecheck; the brief CLI constructs the adapter from the runtime's existing HTTP/environment ports in Task 5.

- [ ] **Step 1: Add failing adapter tests**

Test strict JSON-schema request construction, authorization redaction boundaries, configured endpoint/model/timeout, `zod-to-json-schema` conversion, successful metadata extraction, HTTP error rejection, absent output rejection, invalid JSON rejection, and Zod-invalid output rejection. The adapter must make one HTTP attempt; retry/failover is not introduced here.

- [ ] **Step 2: Run the focused test and confirm missing port/adapter failures**

Run: `pnpm test tests/adapters/node/openai-llm-provider.test.ts`

Expected: FAIL because `LlmProvider` and `OpenAiLlmProvider` do not exist.

- [ ] **Step 3: Add `zod-to-json-schema` and define the port**

Add the runtime dependency with `pnpm add zod-to-json-schema`. Define one request-object method:

```ts
generateStructured<T>(request: StructuredGenerationRequest<T>): Promise<StructuredGeneration<T>>
```

The request carries system prompt, bounded context, Zod schema, schema name, and timeout. The result carries validated output plus provider/model/model-version metadata. The port must not expose API keys or raw provider response bodies.

- [ ] **Step 4: Implement every provider implementation and runtime binding**

Implement `OpenAiLlmProvider` over the existing `HttpClient.postJsonRaw`, using an OpenAI-compatible strict `json_schema` response format and `maxAttempts: 1`. Add `FakeLlmProvider` with queued resolve/reject outcomes and captured requests. Constructor options carry base URL, API key, model, optional model version, and no secret is exposed through results or errors.

- [ ] **Step 5: Pass focused checks and commit**

Run: `pnpm test tests/adapters/node/openai-llm-provider.test.ts`

Expected: PASS.

Run: `pnpm exec eslint src/ports/llm-provider.ts src/ports/index.ts src/adapters/node/openai-llm-provider.ts tests/fakes/fake-llm-provider.ts tests/fakes/index.ts tests/adapters/node/openai-llm-provider.test.ts --max-warnings 0`

Expected: exit 0.

```bash
git add package.json pnpm-lock.yaml src/ports/llm-provider.ts src/ports/index.ts src/adapters/node/openai-llm-provider.ts tests/fakes/fake-llm-provider.ts tests/fakes/index.ts tests/adapters/node/openai-llm-provider.test.ts
git commit -m "feat(briefs): add structured LLM provider adapter"
```

## Task 4: Implement fail-closed research brief generation and persistence

**Files:**

- Create: `src/application/generate-research-brief.ts`
- Create: `tests/application/generate-research-brief.test.ts`

**Invariants to test first:**

- `provider-failure-persists-degraded`: every caught provider/validation/grounding/context error maps to a closed degradation reason and explicit warning.
- `successful-generation-persists-complete`: deterministic envelope fields override any provider-controlled metadata.
- `generation-replay-is-idempotent`: canonical artifact hashing makes identical invocations reuse the repository row.
- `prior-context-is-bounded`: inspect at most 10 bundles from the previous seven days and use only the newest valid prior artifact.
- `expired-source-is-not-generated`: an expired or stale source bundle yields `no_brief` without provider or database writes.

- [ ] **Step 1: Write failing use-case tests**

Cover no bundle, expired/stale bundle, successful complete generation, optional current-regime assessment, no-regime `not_applicable`, prior-brief lookup, each provider/parse/reference/overflow fallback, deterministic timestamps, confidence/provenance construction, canonical hash idempotency, and persistence failure propagation. Assert the provider receives the projection, never the raw bundle row.

- [ ] **Step 2: Run the focused test and confirm the module is missing**

Run: `pnpm test tests/application/generate-research-brief.test.ts`

Expected: FAIL because `generateResearchBrief` does not exist.

- [ ] **Step 3: Implement the orchestration**

Define a request with `pair: "SOL/USDC"`, optional caller-supplied current-regime evidence, `evaluationTimeUnixMs`, and code/run identity. Load the latest bundle, enforce lifecycle gates, find a bounded prior artifact through existing bundle/brief repository methods, project context, invoke `generateStructured`, validate grounded IDs, construct and validate the complete envelope, canonical-hash it, and insert taxonomy/confidence/provenance fields. On any generation-side failure, build, validate, hash, and insert one degraded artifact with `confidence: "low"` and an explicit warning. Do not catch repository write failures or turn missing/expired bundles into fake brief rows.

- [ ] **Step 4: Pass focused checks and commit**

Run: `pnpm test tests/application/generate-research-brief.test.ts`

Expected: PASS for all complete, degraded, no-op, and idempotent transitions.

Run: `pnpm exec eslint src/application/generate-research-brief.ts tests/application/generate-research-brief.test.ts --max-warnings 0`

Expected: exit 0.

```bash
git add src/application/generate-research-brief.ts tests/application/generate-research-brief.test.ts
git commit -m "feat(briefs): generate and persist fail-closed briefs"
```

## Task 5: Add the research brief job and CLI entrypoint

**Files:**

- Modify: `package.json`
- Modify: `.env.example`
- Create: `src/jobs/generate-research-brief-job.ts`
- Modify: `src/jobs/index.ts`
- Create: `scripts/generate/research-brief.ts`
- Create: `tests/jobs/generate-research-brief-job.test.ts`
- Create: `tests/scripts/research-brief.test.ts`

**Invariants to test first:**

- `job-closes-db-on-completion-or-degradation`: successful or degraded research brief generation closes the shared database connection before exiting with code 0.
- `job-closes-db-on-unhandled-error`: unhandled configuration, validation, or persistence errors close the shared database connection before propagating or exiting with a non-zero exit code.

- [ ] **Step 1: Write failing job and script tests**

Test request-file validation before persistence/provider creation, runtime dependency wiring, optional current-regime input, redacted one-line result output, database close on complete/degraded/error outcomes, nonzero exit for `no_brief` and unhandled persistence/config errors, and zero exit for persisted complete or degraded artifacts.

- [ ] **Step 2: Run focused tests and confirm missing entrypoints**

Run: `pnpm test tests/jobs/generate-research-brief-job.test.ts tests/scripts/research-brief.test.ts`

Expected: FAIL because the job and script do not exist.

- [ ] **Step 3: Implement the thin job and script**

Export `generateResearchBriefJob` and `runGenerateResearchBriefScript`. Add `pnpm generate:brief <request-json>`; validate `pair`, evaluation time, code/run fields, and optional current-regime shape before external work. Resolve persistence, then construct `OpenAiLlmProvider` from the runtime's existing HTTP/environment ports using `LLM_BASE_URL`, required `LLM_API_KEY`, `LLM_MODEL`, optional `LLM_MODEL_VERSION`, and `LLM_TIMEOUT_MS`; always close the shared connection. Output only outcome, brief row ID, source bundle ID, generation status, prompt version, and warnings.

- [ ] **Step 4: Document environment defaults**

Add `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_MODEL_VERSION`, and `LLM_TIMEOUT_MS` to `.env.example`, with comments that keys are never persisted and the provider must support strict JSON-schema output.

- [ ] **Step 5: Pass focused checks and commit**

Run: `pnpm test tests/jobs/generate-research-brief-job.test.ts tests/scripts/research-brief.test.ts`

Expected: PASS.

Run: `pnpm exec eslint src/jobs/generate-research-brief-job.ts src/jobs/index.ts scripts/generate/research-brief.ts tests/jobs/generate-research-brief-job.test.ts tests/scripts/research-brief.test.ts --max-warnings 0`

Expected: exit 0.

```bash
git add package.json .env.example src/jobs/generate-research-brief-job.ts src/jobs/index.ts scripts/generate/research-brief.ts tests/jobs/generate-research-brief-job.test.ts tests/scripts/research-brief.test.ts
git commit -m "feat(briefs): expose research brief generation command"
```

## Task 6: Compose eligible briefs into evidence publication

**Files:**

- Modify: `src/application/publish-evidence-bundle.ts`
- Modify: `src/jobs/publish-evidence-bundle-job.ts`
- Modify: `scripts/collectors/publish-evidence-bundle.ts`
- Modify: `src/adapters/node/composition-root.ts`
- Modify: `tests/application/publish-evidence-bundle.test.ts`
- Modify: `tests/scripts/publish-evidence-bundle.test.ts`

**Invariants to test first:**

- `publisher-attaches-only-eligible-complete-brief`: select the newest row by `receivedAtUnixMs` then ID, and require complete status, valid schema, exact source bundle ID/hash, and `expiresAt > now`.
- `publisher-fails-closed-on-invalid-stored-brief`: malformed/degraded/expired/mismatched rows preserve the already-validated base payload and null research-brief audit reference.
- `publisher-audits-composed-payload`: attach before contract validation; use the composed canonical payload/hash for HTTP and every audit row while preserving the base `evidenceBundleId`.
- `publisher-retry-payload-is-stable`: all retry attempts reuse the one precomputed composed payload, hash, idempotency key, and brief ID.

- [ ] **Step 1: Add focused cases to the existing publisher tests**

Extend the existing helpers with `ResearchBriefRepo`. Add cases for valid attachment, newest-valid selection, malformed/degraded/expired/source-mismatched fallback, mapping/contract failure, composed request headers/hash, and retry audit stability. Update script runtime fixtures mechanically so the new required dependency typechecks. Keep new cases in a dedicated `describe("research brief composition", ...)` section of each large test file.

- [ ] **Step 2: Run only the publisher test files**

Run: `pnpm test tests/application/publish-evidence-bundle.test.ts tests/scripts/publish-evidence-bundle.test.ts`

Expected: FAIL until the publisher loads and composes briefs.

- [ ] **Step 3: Implement one-time preflight composition**

Add `briefRepo` to `PublishEvidenceBundleDeps` and script/composition-root/job wiring. After the base bundle passes its stored canonical/hash check, load its brief rows, choose the newest eligible complete artifact, map it into a copied payload, and validate/canonicalize that composed payload. If no eligible row exists, retain the base canonical result. If a supposedly eligible row cannot map or validate, fail closed to the base bundle rather than publish an unvalidated brief. Carry selected `researchBriefId`, composed payload/hash, and composed idempotency key through all existing audit inserts and retry branches.

- [ ] **Step 4: Pass focused checks and commit**

Run: `pnpm test tests/application/publish-evidence-bundle.test.ts tests/scripts/publish-evidence-bundle.test.ts`

Expected: PASS, including existing retry and audit behavior.

Run: `pnpm exec eslint src/application/publish-evidence-bundle.ts scripts/collectors/publish-evidence-bundle.ts tests/application/publish-evidence-bundle.test.ts tests/scripts/publish-evidence-bundle.test.ts --max-warnings 0`

Expected: exit 0.

```bash
git add src/application/publish-evidence-bundle.ts src/jobs/publish-evidence-bundle-job.ts scripts/collectors/publish-evidence-bundle.ts src/adapters/node/composition-root.ts tests/application/publish-evidence-bundle.test.ts tests/scripts/publish-evidence-bundle.test.ts
git commit -m "feat(briefs): attach validated briefs during publication"
```

## Task 7: Document the operational brief lifecycle

**Files:**

- Modify: `README.md`
- Modify: `docs/operator-runbook.md`

- [ ] **Step 1: Document the command and authority boundary**

Describe `pnpm generate:brief <request-json>`, its required environment, the bounded-context limits, complete versus degraded outcomes, optional caller-supplied current-regime evidence, and the fact that the LLM summarizes evidence but cannot synthesize policy.

- [ ] **Step 2: Document persistence and publication diagnostics**

Add operator queries that join `research_briefs` to its source bundle and publish attempts, explain `structured_output.generationStatus`, prompt/model/input-hash fields, and state that only complete, unexpired, source-matching briefs are composed into publication. Include recovery guidance: rerun generation after provider/config recovery; never edit immutable bundle/brief rows.

- [ ] **Step 3: Check only the changed documentation and commit**

Run: `pnpm exec prettier --check README.md docs/operator-runbook.md`

Expected: both files pass formatting.

```bash
git add README.md docs/operator-runbook.md
git commit -m "docs(briefs): document generation and degraded recovery"
```

## Tests to add or update

- Domain schema tests prove closed shapes, field bounds, confidence/status rules, and prompt authority restrictions.
- Projection regression tests use calm, trending, stressed, and sparse fixtures and prove deterministic selection, explicit missing evidence, grounding, and hard context limits.
- Adapter tests prove strict JSON-schema requests and reject all unvalidated provider output.
- Application tests name every generation transition and verify no provider/database calls on gated inputs.
- Job/script tests prove configuration validation, redaction, exit semantics, and connection closure.
- Publisher tests preserve the existing retry suite while adding brief eligibility, composition, canonical validation, and audit lineage cases.

## Validation commands

The implementation loop automatically runs `pnpm -r typecheck` after each task. Use each task's exact file-scoped test/lint/format commands as its acceptance criteria. The orchestrator's dedicated validate phase owns the repository-wide configured gate after implementation; it is intentionally not represented as a standalone task or as a substitute for any task-local check.

## Risk areas

- The pinned canonical brief is narrower than the persisted issue-level artifact. Mapping must remain explicit and must not edit generated contract assets.
- OpenAI-compatible strict JSON-schema response envelopes vary by endpoint/provider. The adapter must support only the documented configured envelope and fail closed on any other shape.
- The source bundle is immutable and has an idempotency key independent of its brief. Composed publication hashes must be audited separately without overwriting stored bundle hashes.
- A degraded artifact is useful audit evidence but is not eligible for outbound attachment.
- Prior-brief lookup through existing repository methods must stay bounded to seven days/ten bundles to avoid an accidental unbounded query loop.
- Provider latency occurs before a database insert; the configured timeout must be finite and there is deliberately no retry loop in generation.
- Publisher retry behavior already has many branches. Compute brief composition once before the loop so retries cannot select a different row mid-flight.

## Stop conditions

- Abort if the configured provider cannot guarantee strict JSON-schema output; do not downgrade to free-form parsing.
- Abort if attaching a brief would require changing the pinned Regime Engine schema/generated contract; coordinate that change in `regime-engine` first.
- Abort if the canonical mapper cannot resolve every `sourceEvidenceId` to a feature or contextual evidence item in the exact source bundle.
- Abort if implementation reveals that `research_briefs.structured_output` cannot retain the complete/degraded envelope and input lineage without a migration; design the migration explicitly before proceeding.
- Abort if current-regime evidence is only available by scraping or inferring policy state. Keep the assessment `not_applicable` until a bounded caller-owned input exists.
- Abort rather than persist or log any API key, authorization header, full provider response, or unbounded raw evidence payload.
- Abort if blockers #8–#11 are not actually present in the branch or the latest bundle lacks the evidence families assumed by the regression fixtures.
