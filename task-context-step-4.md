# Task Context: Task 4

Title: Integrate Solana status into the five-source core run

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-7
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-7
Start Commit: d9bb76998401dd5a7d8096b1d4f98db221c3ed23

## Task Requirements

**Files:**

- Modify: `src/contracts/collection-run.ts`
- Modify: `src/application/collect-core.ts`
- Modify: `src/application/source-outcome.ts`
- Modify: `src/domain/core-collection/reduce.ts`
- Modify: `src/jobs/core-collection-job.ts`
- Modify: `scripts/collectors/core-collection.ts`
- Modify: `tests/application/collect-core.test.ts`
- Modify: `tests/application/source-outcome.test.ts`
- Modify: `tests/domain/core-collection/reduce.test.ts`
- Modify: `tests/scripts/core-collection.test.ts`

**Atomic required-shape change:** `CoreSourceKey`, `CollectCoreDeps`, `CoreCollectionResult`, and `CoreCollectionJobDeps` gain required Solana members in this task. Every production constructor/caller and test implementation is updated in the same task so the automatic workspace typecheck remains green.

**Behavioral invariants to test first:**

- `starts all five leaves before awaiting and invokes each exactly once`
- `passes the same collection context object to all five leaves`
- `preserves four-source evidence when Solana RPC is unavailable`
- `returns COMPLETE only when all five sources contribute fresh usable evidence`
- `maps degraded Solana status to usable core evidence with explicit warnings`
- `maps unavailable Solana status to an explicit aggregate warning without fabricating evidence`
- `orders Solana warnings after the four existing source groups`
- `binds the Solana collector with the shared retry and persistence dependencies`
- `prints the Solana outcome and preserves existing exit semantics`

- [ ] **Step 1: Update failing coordinator and reducer tests**

  Change all `CollectCoreDeps` fixtures from four to five leaves, all “four” assertions to “five,” and all total-count expectations from 4 to 5. Add `"solana"` / `"solana-rpc"` outcomes. Assert:
  - all five promises start before the aggregate await;
  - a Solana timeout plus four accepted leaves is `PARTIAL`, `shouldFailCommand: false`, with counts `{ complete: 4, partial: 0, stale: 0, absentOrFailed: 1 }`;
  - all five accepted/replayed fresh leaves is `COMPLETE`;
  - a Solana conflict is `FAILED`;
  - warning order is CLMM, Pyth, Jupiter, Orca, Solana.

  Run:

  ```bash
  pnpm test tests/application/collect-core.test.ts tests/domain/core-collection/reduce.test.ts
  ```

  Expected: FAIL because the core contracts and coordinator still contain four sources.

- [ ] **Step 2: Expand the core contracts reducer and coordinator atomically**

  Make the required public shapes:

  ```ts
  export type CoreSourceKey = "clmm-v2" | "pyth" | "jupiter" | "orca" | "solana";

  export interface CollectCoreDeps {
    readonly clmmV2: CoreLeaf;
    readonly pyth: CoreLeaf;
    readonly jupiter: CoreLeaf;
    readonly orca: CoreLeaf;
    readonly solana: CoreLeaf;
  }
  ```

  Add `readonly solana: SourceCollectionOutcome` to `CoreCollectionResult`. Start and independently guard the fifth leaf before `Promise.all`, include it in the fixed outcome list, and add `solana: 4` to deterministic warning ordering. Do not change the reducer truth table: usable mixed runs remain `PARTIAL`, all absent/stale remain `UNAVAILABLE`, total malformed/unexpected failures remain `FAILED`, and any conflict remains `FAILED`.

- [ ] **Step 3: Add and test Solana source-outcome mapping**

  Add:

  ```ts
  export function mapSolanaNetworkStatusOutcome(
    result: SolanaNetworkStatusSourceResult
  ): SourceCollectionOutcome;
  ```

  It sets `sourceKey: "solana"`, `source: "solana-rpc"`, preserves status/usability/durable ids/freshness/confidence/diagnostic, and converts each payload warning to `{ source: "solana", code, message }`. Use stable messages: `"Solana RPC node is behind"` and `"Solana RPC slot is unavailable"`. For a non-usable status, also emit exactly one status warning—`solana_rpc_timeout`, `solana_rpc_network`, `solana_rpc_unavailable`, `solana_rpc_malformed`, `solana_rpc_conflict`, or `solana_rpc_failed`—so partial failure is visible in the aggregate warning list without inventing a normalized health value.

  Run:

  ```bash
  pnpm test tests/application/source-outcome.test.ts
  ```

  Expected: FAIL until the mapper is present, then PASS after implementation.

- [ ] **Step 4: Wire the job and CLI in the same required-shape change**

  Add `retryControl: RetryControl` to `CoreCollectionJobDeps`. Bind a `solana` leaf that calls `collectSolanaNetworkStatus(deps, context)` and maps it with `mapSolanaNetworkStatusOutcome`; guard unexpected rejection with `mapSourceError("solana", "solana-rpc", err)`. Pass `runtime.retryControl` from `scripts/collectors/core-collection.ts`.

  In `tests/scripts/core-collection.test.ts`, mock the new collector, add `retryControl` to runtime/dependency fixtures, assert the same context and dependencies reach the Solana leaf, include `solana` in printed COMPLETE/FAILED fixtures, and preserve connection-close plus exit-code assertions.

- [ ] **Step 5: Run task-scoped verification**

  ```bash
  pnpm test tests/application/collect-core.test.ts tests/application/source-outcome.test.ts tests/domain/core-collection/reduce.test.ts tests/scripts/core-collection.test.ts
  pnpm exec eslint src/contracts/collection-run.ts src/application/collect-core.ts src/application/source-outcome.ts src/domain/core-collection/reduce.ts src/jobs/core-collection-job.ts scripts/collectors/core-collection.ts tests/application/collect-core.test.ts tests/application/source-outcome.test.ts tests/domain/core-collection/reduce.test.ts tests/scripts/core-collection.test.ts --max-warnings 0
  pnpm exec prettier --check src/contracts/collection-run.ts src/application/collect-core.ts src/application/source-outcome.ts src/domain/core-collection/reduce.ts src/jobs/core-collection-job.ts scripts/collectors/core-collection.ts tests/application/collect-core.test.ts tests/application/source-outcome.test.ts tests/domain/core-collection/reduce.test.ts tests/scripts/core-collection.test.ts
  pnpm exec depcruise --config .dependency-cruiser.cjs src/contracts/collection-run.ts src/application/collect-core.ts src/application/source-outcome.ts src/domain/core-collection/reduce.ts src/jobs/core-collection-job.ts
  ```

  Expected: all commands pass. The implement loop’s automatic `pnpm -r typecheck` gate also passes after this task.

- [ ] **Step 6: Commit**

  ```bash
  git add src/contracts/collection-run.ts src/application/collect-core.ts src/application/source-outcome.ts src/domain/core-collection/reduce.ts src/jobs/core-collection-job.ts scripts/collectors/core-collection.ts tests/application/collect-core.test.ts tests/application/source-outcome.test.ts tests/domain/core-collection/reduce.test.ts tests/scripts/core-collection.test.ts
  git commit -m "feat: add Solana status to core collection"
  ```

## Repository Targets

### Expected Files

- src/contracts/collection-run.ts
- src/application/collect-core.ts
- src/application/source-outcome.ts
- src/domain/core-collection/reduce.ts
- src/jobs/core-collection-job.ts
- scripts/collectors/core-collection.ts
- tests/application/collect-core.test.ts
- tests/application/source-outcome.test.ts
- tests/domain/core-collection/reduce.test.ts
- tests/scripts/core-collection.test.ts

## Validation Commands

```bash
pnpm test tests/application/collect-core.test.ts tests/application/source-outcome.test.ts tests/domain/core-collection/reduce.test.ts tests/scripts/core-collection.test.ts
pnpm exec eslint src/contracts/collection-run.ts src/application/collect-core.ts src/application/source-outcome.ts src/domain/core-collection/reduce.ts src/jobs/core-collection-job.ts scripts/collectors/core-collection.ts tests/application/collect-core.test.ts tests/application/source-outcome.test.ts tests/domain/core-collection/reduce.test.ts tests/scripts/core-collection.test.ts --max-warnings 0
pnpm exec prettier --check src/contracts/collection-run.ts src/application/collect-core.ts src/application/source-outcome.ts src/domain/core-collection/reduce.ts src/jobs/core-collection-job.ts scripts/collectors/core-collection.ts tests/application/collect-core.test.ts tests/application/source-outcome.test.ts tests/domain/core-collection/reduce.test.ts tests/scripts/core-collection.test.ts
pnpm exec depcruise --config .dependency-cruiser.cjs src/contracts/collection-run.ts src/application/collect-core.ts src/application/source-outcome.ts src/domain/core-collection/reduce.ts src/jobs/core-collection-job.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **five-way parallel start**: All five leaves start before awaiting and each runs exactly once. (Test: `starts all five leaves before awaiting and invokes each exactly once`)
- **shared run context**: Every leaf receives the same immutable collection context object. (Test: `passes the same collection context object to all five leaves`)
- **Solana partial-failure isolation**: Unavailable Solana RPC preserves four usable siblings and yields a successful PARTIAL run. (Test: `preserves four-source evidence when Solana RPC is unavailable`)
- **five-source completeness**: COMPLETE is emitted only when all five required sources contribute fresh usable evidence. (Test: `returns COMPLETE only when all five sources contribute fresh usable evidence`)
- **degraded Solana outcome mapping**: Recognized degraded network status remains usable and carries explicit common warnings. (Test: `maps degraded Solana status to usable core evidence with explicit warnings`)
- **unavailable Solana warning mapping**: A non-usable Solana outcome contributes one explicit aggregate warning and no fabricated normalized evidence. (Test: `maps unavailable Solana status to an explicit aggregate warning without fabricating evidence`)
- **deterministic warning order**: Solana warning rank follows CLMM, Pyth, Jupiter, and Orca regardless of completion timing. (Test: `orders Solana warnings after the four existing source groups`)
- **job dependency binding**: The job binds the Solana collector with the same context, retry control, and repositories. (Test: `binds the Solana collector with the shared retry and persistence dependencies`)
- **CLI result and exit stability**: The CLI prints the fifth outcome while retaining status-derived exit and cleanup behavior. (Test: `prints the Solana outcome and preserves existing exit semantics`)
