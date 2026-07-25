# Task Context: Task 7

Title: Add the two-source job and collector entrypoint

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-11
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-11
Start Commit: d62ccad6f3f1f0812dc1d59b322256f63fbcf7ba

## Task Requirements

**Files:**

- Create: `src/jobs/perp-liquidation-job.ts`
- Modify: `src/jobs/index.ts`
- Create: `scripts/collectors/perp-liquidation.ts`
- Create: `tests/jobs/perp-liquidation-job.test.ts`
- Create: `tests/scripts/perp-liquidation.test.ts`
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Write failing job reduction and script tests**

  Required state tests:
  - `transitions one unavailable venue plus one usable venue to PARTIAL without failing the command`;
  - `transitions two unavailable venues to UNAVAILABLE and fails the command`;
  - `sorts source outcomes deterministically`;
  - `rejects duplicate or incomplete two-source configuration`;
  - `redacts source secrets from job and script diagnostics`;
  - `sets exit code zero for COMPLETE and PARTIAL and one for UNAVAILABLE and FAILED`;
  - `closes persistence exactly once after success or failure`.

- [ ] **Step 2: Verify job and script tests fail**

  Run: `pnpm vitest run tests/jobs/perp-liquidation-job.test.ts tests/scripts/perp-liquidation.test.ts`

  Expected: FAIL because the job and script do not exist.

- [ ] **Step 3: Implement job status reduction**

  Require exactly one `binance-fapi` and one `drift-api` adapter. Create one shared `CollectionRunContext`, run sources concurrently, redact thrown diagnostics, and reduce:

  | Source outcomes                                       | Job status    | `shouldFailCommand` |
  | ----------------------------------------------------- | ------------- | ------------------- |
  | both usable, neither degraded                         | `COMPLETE`    | false               |
  | at least one usable and any degraded/unusable         | `PARTIAL`     | false               |
  | both timeout/network/unavailable                      | `UNAVAILABLE` | true                |
  | no usable evidence and any malformed/conflict/failure | `FAILED`      | true                |

- [ ] **Step 4: Implement the thin script**

  Add `collect:perp-liquidation` to `package.json`. Read and validate:
  - `BINANCE_FAPI_BASE_URL` (default `https://fapi.binance.com`);
  - `BINANCE_SOL_PERP_SYMBOL`;
  - `DRIFT_DATA_API_BASE_URL`;
  - `DRIFT_SOL_PERP_MARKET_INDEX`;
  - documented Drift precision configuration if it cannot be sourced from a metadata endpoint;
  - `PERP_LIQUIDATION_LOOKBACK_MS` (minimum four hours so OI derivation has coverage).

  Construct both adapters with `runtime.http` and `runtime.retryControl`, initialize persistence once, run the job, print secret-redacted JSON, set exit code from `shouldFailCommand`, and close the DB connection in `finally`.

- [ ] **Step 5: Document environment variables**

  Add a dedicated Pack C block to `.env.example`. Do not add Binance user API keys or secrets because the adapter uses public market data only.

- [ ] **Step 6: Run focused tests and lint**

  Run: `pnpm vitest run tests/jobs/perp-liquidation-job.test.ts tests/scripts/perp-liquidation.test.ts`

  Expected: PASS.

  Run: `pnpm exec eslint src/jobs/perp-liquidation-job.ts src/jobs/index.ts scripts/collectors/perp-liquidation.ts tests/jobs/perp-liquidation-job.test.ts tests/scripts/perp-liquidation.test.ts`

  Expected: exit 0.

  Run: `pnpm exec prettier --check package.json`

  Expected: exit 0.

- [ ] **Step 7: Commit**

  ```bash
  git add src/jobs/perp-liquidation-job.ts src/jobs/index.ts scripts/collectors/perp-liquidation.ts tests/jobs/perp-liquidation-job.test.ts tests/scripts/perp-liquidation.test.ts package.json .env.example
  git commit -m "feat: run two-source perp liquidation collection"
  ```

## Repository Targets

### Expected Files

- src/jobs/perp-liquidation-job.ts
- src/jobs/index.ts
- scripts/collectors/perp-liquidation.ts
- tests/jobs/perp-liquidation-job.test.ts
- tests/scripts/perp-liquidation.test.ts
- package.json
- .env.example

## Validation Commands

```bash
pnpm vitest run tests/jobs/perp-liquidation-job.test.ts tests/scripts/perp-liquidation.test.ts
pnpm exec eslint src/jobs/perp-liquidation-job.ts src/jobs/index.ts scripts/collectors/perp-liquidation.ts tests/jobs/perp-liquidation-job.test.ts tests/scripts/perp-liquidation.test.ts
pnpm exec prettier --check package.json
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **partial source availability**: One usable venue and one unavailable venue yields PARTIAL and a successful command exit. (Test: `transitions one unavailable venue plus one usable venue to PARTIAL without failing the command`)
- **total source unavailability**: Two unavailable venues yield UNAVAILABLE and a failing command exit. (Test: `transitions two unavailable venues to UNAVAILABLE and fails the command`)
- **persistence cleanup**: The script closes persistence exactly once on both success and failure paths. (Test: `closes persistence exactly once after success or failure`)
