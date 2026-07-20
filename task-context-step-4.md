# Task Context: Task 4

Title: Create run contexts and migrate every existing leaf caller atomically

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-24
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-24
Start Commit: f7a18d04ef7d634a88ba3e8a3a6eec1ad65ab581

## Task Requirements

**Files:**

- Create: `src/ports/run-id.ts`
- Modify: `src/ports/index.ts`
- Create: `src/adapters/node/uuid-run-id-factory.ts`
- Modify: `src/adapters/node/composition-root.ts`
- Create: `tests/fakes/fake-run-id-factory.ts`
- Modify: `tests/fakes/index.ts`
- Create: `src/application/create-collection-run-context.ts`
- Create: `tests/application/create-collection-run-context.test.ts`
- Modify: `src/application/collect-clmm-bundle.ts`
- Modify: `src/application/collect-pyth-price.ts`
- Modify: `src/application/collect-jupiter-quote.ts`
- Modify: `src/application/collect-price-observations.ts`
- Modify: `src/application/collect-jupiter-price.ts`
- Modify: `src/jobs/clmm-bundle-job.ts`
- Modify: `src/jobs/price-observations-job.ts`
- Modify: `scripts/collectors/clmm-bundle.ts`
- Modify: `scripts/collectors/jupiter-price.ts`
- Modify: `tests/application/collect-clmm-bundle.test.ts`
- Modify: `tests/application/collect-pyth-price.test.ts`
- Modify: `tests/application/collect-jupiter-quote.test.ts`
- Modify: `tests/application/collect-price-observations.test.ts`
- Modify: `tests/application/collect-jupiter-price.test.ts`
- Modify: `tests/scripts/clmm-bundle.test.ts`
- Modify: `tests/scripts/price-observations.test.ts`

**Exported API changes:** Add `RunIdFactory.nextRunId(): string`, add `NodeRuntime.runIdFactory`, add `createCollectionRunContext`, make `collectClmmBundle`, `collectPythPrice`, `collectJupiterQuote`, and `collectPriceObservations` require `CollectionRunContext` as their second parameter. Every current caller and test is updated in this same task so the automatic workspace typecheck gate remains green.

- [ ] **Step 1: Write context-creation tests first.** Add `uses the operator run id or generates one once at the job boundary`, covering a non-empty `INTELLIGENCE_PIPELINE_RUN_ID`, blank-as-unset behavior, exactly one factory call, a finite parsed clock value, and rejection of an invalid clock.
- [ ] **Step 2: Update leaf and aggregate tests first.** Supply a frozen `{ runId: "run-123", startedAtUnixMs: ... }` to every direct leaf call; name and assert `passes explicit immutable context without leaf environment rereads`. In the existing price aggregate concurrency case, assert both leaves receive the same object. Scope the 509-line CLMM test edit to its setup/helper and provenance assertions rather than rewriting unrelated lifecycle cases.
- [ ] **Step 3: Run the focused tests and confirm signature failures.** Run `pnpm exec vitest run tests/application/create-collection-run-context.test.ts tests/application/collect-clmm-bundle.test.ts tests/application/collect-pyth-price.test.ts tests/application/collect-jupiter-quote.test.ts tests/application/collect-price-observations.test.ts tests/application/collect-jupiter-price.test.ts tests/scripts/clmm-bundle.test.ts tests/scripts/price-observations.test.ts`; expect failures until the new port, adapter, signatures, and job wiring are implemented.
- [ ] **Step 4: Add the port and all implementations in this same task.** Define:

```ts
export interface RunIdFactory {
  nextRunId(): string;
}
```

Implement `UuidRunIdFactory` with `randomUUID()`, a deterministic queue-backed fake, export both through their indexes, and expose one factory instance on `NodeRuntime`. `createCollectionRunContext` reads the operator value once, treats whitespace-only as unset, otherwise generates once, parses `clock.now()` once, validates a non-empty run ID and finite timestamp, and returns `Object.freeze({ runId, startedAtUnixMs })`.

- [ ] **Step 5: Migrate all existing leaf signatures and provenance.** Remove `INTELLIGENCE_PIPELINE_RUN_ID` reads from the three leaf use cases and use `context.runId` for request metadata/enrichment. Make `collectPriceObservations(deps, context)` pass that context to both price leaves. Update the CLMM and price jobs to create a context at their standalone job boundary using `env`, `clock`, and `runIdFactory`; update both scripts and all tests/callers in the file list in the same commit.
- [ ] **Step 6: Verify this task.** Run the focused Vitest command from Step 3, `pnpm exec eslint src/ports/run-id.ts src/ports/index.ts src/adapters/node/uuid-run-id-factory.ts src/adapters/node/composition-root.ts tests/fakes/fake-run-id-factory.ts tests/fakes/index.ts src/application/create-collection-run-context.ts tests/application/create-collection-run-context.test.ts src/application/collect-clmm-bundle.ts src/application/collect-pyth-price.ts src/application/collect-jupiter-quote.ts src/application/collect-price-observations.ts src/application/collect-jupiter-price.ts src/jobs/clmm-bundle-job.ts src/jobs/price-observations-job.ts scripts/collectors/clmm-bundle.ts scripts/collectors/jupiter-price.ts tests/application/collect-clmm-bundle.test.ts tests/application/collect-pyth-price.test.ts tests/application/collect-jupiter-quote.test.ts tests/application/collect-price-observations.test.ts tests/application/collect-jupiter-price.test.ts tests/scripts/clmm-bundle.test.ts tests/scripts/price-observations.test.ts --max-warnings 0`, and `pnpm exec prettier --check src/ports/run-id.ts src/ports/index.ts src/adapters/node/uuid-run-id-factory.ts src/adapters/node/composition-root.ts tests/fakes/fake-run-id-factory.ts tests/fakes/index.ts src/application/create-collection-run-context.ts tests/application/create-collection-run-context.test.ts src/application/collect-clmm-bundle.ts src/application/collect-pyth-price.ts src/application/collect-jupiter-quote.ts src/application/collect-price-observations.ts src/application/collect-jupiter-price.ts src/jobs/clmm-bundle-job.ts src/jobs/price-observations-job.ts scripts/collectors/clmm-bundle.ts scripts/collectors/jupiter-price.ts tests/application/collect-clmm-bundle.test.ts tests/application/collect-pyth-price.test.ts tests/application/collect-jupiter-quote.test.ts tests/application/collect-price-observations.test.ts tests/application/collect-jupiter-price.test.ts tests/scripts/clmm-bundle.test.ts tests/scripts/price-observations.test.ts`.
- [ ] **Step 7: Commit.** Run `git add src/ports/run-id.ts src/ports/index.ts src/adapters/node/uuid-run-id-factory.ts src/adapters/node/composition-root.ts tests/fakes/fake-run-id-factory.ts tests/fakes/index.ts src/application/create-collection-run-context.ts tests/application/create-collection-run-context.test.ts src/application/collect-clmm-bundle.ts src/application/collect-pyth-price.ts src/application/collect-jupiter-quote.ts src/application/collect-price-observations.ts src/application/collect-jupiter-price.ts src/jobs/clmm-bundle-job.ts src/jobs/price-observations-job.ts scripts/collectors/clmm-bundle.ts scripts/collectors/jupiter-price.ts tests/application/collect-clmm-bundle.test.ts tests/application/collect-pyth-price.test.ts tests/application/collect-jupiter-quote.test.ts tests/application/collect-price-observations.test.ts tests/application/collect-jupiter-price.test.ts tests/scripts/clmm-bundle.test.ts tests/scripts/price-observations.test.ts && git commit -m "feat: pass explicit collection run contexts"`.

**Task invariants:**

- `single boundary identity creation` — test case `uses the operator run id or generates one once at the job boundary`.
- `explicit leaf correlation` — test case `passes explicit immutable context without leaf environment rereads`.

## Repository Targets

### Expected Files

- src/ports/run-id.ts
- src/ports/index.ts
- src/adapters/node/uuid-run-id-factory.ts
- src/adapters/node/composition-root.ts
- tests/fakes/fake-run-id-factory.ts
- tests/fakes/index.ts
- src/application/create-collection-run-context.ts
- tests/application/create-collection-run-context.test.ts
- src/application/collect-clmm-bundle.ts
- src/application/collect-pyth-price.ts
- src/application/collect-jupiter-quote.ts
- src/application/collect-price-observations.ts
- src/application/collect-jupiter-price.ts
- src/jobs/clmm-bundle-job.ts
- src/jobs/price-observations-job.ts
- scripts/collectors/clmm-bundle.ts
- scripts/collectors/jupiter-price.ts
- tests/application/collect-clmm-bundle.test.ts
- tests/application/collect-pyth-price.test.ts
- tests/application/collect-jupiter-quote.test.ts
- tests/application/collect-price-observations.test.ts
- tests/application/collect-jupiter-price.test.ts
- tests/scripts/clmm-bundle.test.ts
- tests/scripts/price-observations.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/application/create-collection-run-context.test.ts tests/application/collect-clmm-bundle.test.ts tests/application/collect-pyth-price.test.ts tests/application/collect-jupiter-quote.test.ts tests/application/collect-price-observations.test.ts tests/application/collect-jupiter-price.test.ts tests/scripts/clmm-bundle.test.ts tests/scripts/price-observations.test.ts
pnpm exec eslint src/ports/run-id.ts src/ports/index.ts src/adapters/node/uuid-run-id-factory.ts src/adapters/node/composition-root.ts tests/fakes/fake-run-id-factory.ts tests/fakes/index.ts src/application/create-collection-run-context.ts tests/application/create-collection-run-context.test.ts src/application/collect-clmm-bundle.ts src/application/collect-pyth-price.ts src/application/collect-jupiter-quote.ts src/application/collect-price-observations.ts src/application/collect-jupiter-price.ts src/jobs/clmm-bundle-job.ts src/jobs/price-observations-job.ts scripts/collectors/clmm-bundle.ts scripts/collectors/jupiter-price.ts tests/application/collect-clmm-bundle.test.ts tests/application/collect-pyth-price.test.ts tests/application/collect-jupiter-quote.test.ts tests/application/collect-price-observations.test.ts tests/application/collect-jupiter-price.test.ts tests/scripts/clmm-bundle.test.ts tests/scripts/price-observations.test.ts --max-warnings 0
pnpm exec prettier --check src/ports/run-id.ts src/ports/index.ts src/adapters/node/uuid-run-id-factory.ts src/adapters/node/composition-root.ts tests/fakes/fake-run-id-factory.ts tests/fakes/index.ts src/application/create-collection-run-context.ts tests/application/create-collection-run-context.test.ts src/application/collect-clmm-bundle.ts src/application/collect-pyth-price.ts src/application/collect-jupiter-quote.ts src/application/collect-price-observations.ts src/application/collect-jupiter-price.ts src/jobs/clmm-bundle-job.ts src/jobs/price-observations-job.ts scripts/collectors/clmm-bundle.ts scripts/collectors/jupiter-price.ts tests/application/collect-clmm-bundle.test.ts tests/application/collect-pyth-price.test.ts tests/application/collect-jupiter-quote.test.ts tests/application/collect-price-observations.test.ts tests/application/collect-jupiter-price.test.ts tests/scripts/clmm-bundle.test.ts tests/scripts/price-observations.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **single boundary identity creation**: A non-empty operator run ID wins; otherwise exactly one generated ID and one parsed start time form the immutable context. (Test: `uses the operator run id or generates one once at the job boundary`)
- **explicit leaf correlation**: Leaves use the supplied context for provenance and do not re-read the run ID from environment state. (Test: `passes explicit immutable context without leaf environment rereads`)
