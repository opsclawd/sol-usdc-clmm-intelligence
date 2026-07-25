# Task Context: Task 3

Title: Add the LLM provider port and all implementations

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-12
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-12
Start Commit: 9e740ad51c6cc14733d2261f4f854d90a3505ead

## Task Requirements

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

## Repository Targets

### Expected Files

- package.json
- pnpm-lock.yaml
- src/ports/llm-provider.ts
- src/ports/index.ts
- src/adapters/node/openai-llm-provider.ts
- tests/fakes/fake-llm-provider.ts
- tests/fakes/index.ts
- tests/adapters/node/openai-llm-provider.test.ts

## Validation Commands

```bash
pnpm test tests/adapters/node/openai-llm-provider.test.ts
pnpm exec eslint src/ports/llm-provider.ts src/ports/index.ts src/adapters/node/openai-llm-provider.ts tests/fakes/fake-llm-provider.ts tests/fakes/index.ts tests/adapters/node/openai-llm-provider.test.ts --max-warnings 0
```
