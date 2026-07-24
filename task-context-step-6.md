# Task Context: Task 6

Title: Orchestrate multi-source collection and status reduction

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-10
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-10
Start Commit: dfdc6c6a72b0862f77922bc0061053324d906eef

## Task Requirements

**Files:**

- Create: `src/jobs/on-chain-flow-job.ts`
- Modify: `src/jobs/index.ts`
- Create: `tests/jobs/on-chain-flow-job.test.ts`

**Behavioral invariants to test first:**

- `all usable sources reduce to COMPLETE without command failure`.
- `one usable and one unavailable source reduce to PARTIAL without command failure`.
- `all unavailable sources reduce to UNAVAILABLE with command failure`.
- `zero usable sources with malformed or persistence failure reduce to FAILED with command failure`.
- `duplicate configured source names abort before collection`.
- `one run context and one threshold set are passed to both collectors`.
- `outcomes are returned in stable source-name order regardless of completion order`.

- [ ] **Step 1: Write failing job tests**

  Run:

  ```bash
  pnpm test tests/jobs/on-chain-flow-job.test.ts
  ```

  Expected: FAIL because the job does not exist.

- [ ] **Step 2: Implement job and exports**

  Export `ConfiguredOnChainFlowSource`, `OnChainFlowJobDeps`, `OnChainFlowJobResult`, `onChainFlowJob`, and `runOnChainFlowJob`. Validate exactly one Helius and one Birdeye source, create one run context, run sources independently with the same explicit thresholds/lookback, redact rejected diagnostics, sort outcomes by source, and reduce status using the truth table in the invariants. Export the public job surface from `src/jobs/index.ts`.

- [ ] **Step 3: Run task-scoped verification**

  ```bash
  pnpm test tests/jobs/on-chain-flow-job.test.ts
  pnpm exec eslint src/jobs/on-chain-flow-job.ts src/jobs/index.ts tests/jobs/on-chain-flow-job.test.ts --max-warnings 0
  pnpm exec prettier --check src/jobs/on-chain-flow-job.ts src/jobs/index.ts tests/jobs/on-chain-flow-job.test.ts
  ```

  Expected: all commands pass.

- [ ] **Step 4: Commit**

  ```bash
  git add src/jobs/on-chain-flow-job.ts src/jobs/index.ts tests/jobs/on-chain-flow-job.test.ts
  git commit -m "feat: orchestrate on-chain flow source collection"
  ```

## Repository Targets

### Expected Files

- src/jobs/on-chain-flow-job.ts
- src/jobs/index.ts
- tests/jobs/on-chain-flow-job.test.ts

## Validation Commands

```bash
pnpm test tests/jobs/on-chain-flow-job.test.ts
pnpm exec eslint src/jobs/on-chain-flow-job.ts src/jobs/index.ts tests/jobs/on-chain-flow-job.test.ts --max-warnings 0
pnpm exec prettier --check src/jobs/on-chain-flow-job.ts src/jobs/index.ts tests/jobs/on-chain-flow-job.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **complete reduction**: All usable sources produce COMPLETE and do not fail the command. (Test: `all usable sources reduce to COMPLETE without command failure`)
- **partial reduction**: A usable source plus an unavailable source produces PARTIAL and exits successfully. (Test: `one usable and one unavailable source reduce to PARTIAL without command failure`)
- **unavailable reduction**: All unavailable sources produce UNAVAILABLE and fail the command. (Test: `all unavailable sources reduce to UNAVAILABLE with command failure`)
- **failed reduction**: No usable evidence plus malformed or persistence failure produces FAILED. (Test: `zero usable sources with malformed or persistence failure reduce to FAILED with command failure`)
- **unique source configuration**: Duplicate source names abort before any source is called. (Test: `duplicate configured source names abort before collection`)
- **shared run configuration**: Both collectors receive one run context and the same explicit threshold set. (Test: `one run context and one threshold set are passed to both collectors`)
- **stable outcome order**: Result ordering is source-name stable regardless of asynchronous completion. (Test: `outcomes are returned in stable source-name order regardless of completion order`)
