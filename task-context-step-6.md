# Task Context: Task 6

Title: Orchestrate durable observation and feature persistence

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

- Create: `src/application/collect-perp-liquidation.ts`
- Create: `tests/application/collect-perp-liquidation.test.ts`

- [ ] **Step 1: Write failing application state-transition tests**

  Required tests:
  - `transitions a new fact from absent to raw pending to normalized and raw parsed before feature insertion`;
  - `transitions an identical fact from parsed to replayed without duplicate normalized or feature rows`;
  - `transitions the same identity with a changed payload to conflict while preserving the immutable row`;
  - `recovers a stuck raw pending row by completing normalization and marking raw parsed on subsequent runs`;
  - `persists stale observations and PARTIAL features with stale_input_degraded`;
  - `returns degraded coverage without zero-valued evidence when a metric is unavailable`;
  - `continues processing valid facts after one malformed fact`.

- [ ] **Step 2: Verify the application tests fail**

  Run: `pnpm vitest run tests/application/collect-perp-liquidation.test.ts`

  Expected: FAIL because `collectPerpLiquidation` does not exist.

- [ ] **Step 3: Implement collection over existing repository ports with stuck pending recovery**

  Define dependencies on `PerpLiquidationSourcePort`, `RawObservationRepo`, `NormalizedObservationRepo`, and `DerivedFeatureRepo`. The input contains source key and lookback. Fetch one snapshot, sort facts by deterministic identity, then for each fact:
  1. validate and normalize;
  2. derive the source observation key and canonical payload/hash;
  3. `insertOrClassify` raw as `pending`;
  4. on new raw insert (outcome `inserted`) OR when classifying an existing raw row that is in status `pending` (due to a prior crash before normalized insert): enrich and insert normalized observation, then mark raw `parsed`;
  5. on processing error, attempt raw `failed` and preserve the original diagnostic;
  6. on identical parsed replay, reuse persisted normalized candidates without another normalized insert;
  7. on conflict (existing raw row has different payload hash), preserve the existing raw row and report conflict.

  Only after all observation transitions complete, derive the four features from the current snapshot’s normalized candidates and `featureRepo.insertMany`. Idempotency is the existing `(featureKind, derivationKey)` contract.

- [ ] **Step 4: Reduce source coverage without policy synthesis**

  Return counts, per-source coverage, and explicit outcome structures:

  ```ts
  export type PerpLiquidationCollectionStatus =
    | "accepted"
    | "partial"
    | "degraded"
    | "identical_replay"
    | "malformed"
    | "timeout"
    | "network"
    | "unavailable"
    | "failed";

  export interface PerpLiquidationCollectionResult {
    readonly venue: PerpVenue;
    readonly status: PerpLiquidationCollectionStatus;
    readonly rawCount: number;
    readonly normalizedCount: number;
    readonly featureCount: number;
    readonly coverage: Readonly<Record<PerpMetricKind, PerpMetricCoverage>>;
  }
  ```

  Any usable stale fact or unavailable metric makes the source `degraded`; mixed accepted/failed facts make it `partial`; an empty successful response with unavailable coverage is degraded/unavailable, never accepted “no risk.”

- [ ] **Step 5: Run focused tests and lint**

  Run: `pnpm vitest run tests/application/collect-perp-liquidation.test.ts`

  Expected: PASS.

  Run: `pnpm exec eslint src/application/collect-perp-liquidation.ts tests/application/collect-perp-liquidation.test.ts`

  Expected: exit 0.

- [ ] **Step 6: Commit**

  ```bash
  git add src/application/collect-perp-liquidation.ts tests/application/collect-perp-liquidation.test.ts
  git commit -m "feat: persist perp observations and derived features"
  ```

## Repository Targets

### Expected Files

- src/application/collect-perp-liquidation.ts
- tests/application/collect-perp-liquidation.test.ts

## Validation Commands

```bash
pnpm vitest run tests/application/collect-perp-liquidation.test.ts
pnpm exec eslint src/application/collect-perp-liquidation.ts tests/application/collect-perp-liquidation.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **persistence order**: A new fact is raw pending before normalized insertion, raw parsed afterward, and feature insertion occurs last. (Test: `transitions a new fact from absent to raw pending to normalized and raw parsed before feature insertion`)
- **identical replay**: A parsed identical raw fact reuses persisted evidence without duplicate normalized or feature rows. (Test: `transitions an identical fact from parsed to replayed without duplicate normalized or feature rows`)
- **immutable conflict**: A changed payload under the same identity reports conflict and leaves the stored raw row unchanged. (Test: `transitions the same identity with a changed payload to conflict while preserving the immutable row`)
- **stuck pending recovery**: Recovers a stuck raw pending row by completing normalization and marking raw parsed on subsequent runs. (Test: `recovers a stuck raw pending row by completing normalization and marking raw parsed on subsequent runs`)
- **stale persistence**: Stale facts remain auditable but derived features are PARTIAL with stale_input_degraded. (Test: `persists stale observations and PARTIAL features with stale_input_degraded`)
- **degraded coverage handling**: Returns degraded coverage without zero-valued evidence when a metric is unavailable. (Test: `returns degraded coverage without zero-valued evidence when a metric is unavailable`)
- **fault isolation**: Continues processing valid facts after one malformed fact. (Test: `continues processing valid facts after one malformed fact`)
