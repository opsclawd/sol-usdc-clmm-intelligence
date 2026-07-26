# Task Context: Task 1

Title: Define the research brief contracts, schemas, and prompt

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

## Repository Targets

### Expected Files

- src/contracts/research-brief.ts
- src/contracts/index.ts
- src/domain/brief/brief-schema.ts
- src/domain/brief/prompts.ts
- src/domain/brief/index.ts
- tests/domain/brief/brief-schema.test.ts

## Validation Commands

```bash
pnpm test tests/domain/brief/brief-schema.test.ts
pnpm exec eslint src/contracts/research-brief.ts src/contracts/index.ts src/domain/brief/brief-schema.ts src/domain/brief/prompts.ts src/domain/brief/index.ts tests/domain/brief/brief-schema.test.ts --max-warnings 0
```
