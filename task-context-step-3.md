# Task Context: Task 3

Title: Map bundles into source-independent fact candidates

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-22
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-22
Start Commit: 354e656925912cc7e58de7220277b1694b69286d

## Task Requirements

**Files:**

- Create: `src/contracts/normalized-clmm-observation.ts`
- Modify: `src/contracts/index.ts`
- Create: `src/domain/clmm-bundle/normalize.ts`
- Modify: `src/domain/clmm-bundle/index.ts`
- Create: `tests/domain/clmm-bundle/normalize.test.ts`

**Behavioral invariants to test first:**

- `maps one pool and data-quality candidate plus one position and fee candidate per position and one trigger per alert` fixes cardinality.
- `maps an empty positions and alerts bundle to only pool_state and data_quality` forbids fabricated absence events.
- `materializes unavailable optional values as null while retaining zero false empty arrays and decimal strings` enforces missing-data semantics.
- `includes stable poolId positionId or triggerId in every multi-entity payload` preserves normalized identity within one raw observation.
- `does not normalize srLevels or emit volume_metrics` holds the authority and scope boundary.

- [ ] **Step 1: Write mapper tests using `makeClmmBundle`; assert complete payload objects, ordering, and exact candidate kinds.**
- [ ] **Step 2: Run `pnpm vitest run tests/domain/clmm-bundle/normalize.test.ts` and confirm it fails on missing contracts/mapper.**
- [ ] **Step 3: Define versioned readonly payload interfaces for `PoolStatePayloadV1`, `PositionStatePayloadV1`, `FeeMetricsPayloadV1`, `TriggerEventPayloadV1`, and `DataQualityPayloadV1`, plus a discriminated `ClmmNormalizedCandidate` union.** Every payload includes `schemaVersion: 1`, `pair`, entity identity, and `observedAtUnixMs`; raw token/liquidity amounts remain strings.
- [ ] **Step 4: Implement `normalizeClmmBundle(bundle: ClmmBundle): readonly ClmmNormalizedCandidate[]` as a pure mapper with deterministic ordering: pool, positions and their fees in input order, alerts in input order, then data quality.** Qualification context on triggers comes from the matching position; invalid references are impossible after Task 1 but should still fail defensively.
- [ ] **Step 5: Export contracts and mapper, rerun the focused test, then run `pnpm exec eslint src/contracts/normalized-clmm-observation.ts src/contracts/index.ts src/domain/clmm-bundle/normalize.ts src/domain/clmm-bundle/index.ts tests/domain/clmm-bundle/normalize.test.ts --max-warnings 0` and `pnpm exec prettier --check src/contracts/normalized-clmm-observation.ts src/contracts/index.ts src/domain/clmm-bundle/normalize.ts src/domain/clmm-bundle/index.ts tests/domain/clmm-bundle/normalize.test.ts`.**
- [ ] **Step 6: Commit:** `git add src/contracts/normalized-clmm-observation.ts src/contracts/index.ts src/domain/clmm-bundle/normalize.ts src/domain/clmm-bundle/index.ts tests/domain/clmm-bundle/normalize.test.ts && git commit -m "feat(clmm): map bundle facts into normalized candidates"`.

## Repository Targets

### Expected Files

- src/contracts/normalized-clmm-observation.ts
- src/contracts/index.ts
- src/domain/clmm-bundle/normalize.ts
- src/domain/clmm-bundle/index.ts
- tests/domain/clmm-bundle/normalize.test.ts

## Validation Commands

```bash
pnpm vitest run tests/domain/clmm-bundle/normalize.test.ts
pnpm exec eslint src/contracts/normalized-clmm-observation.ts src/contracts/index.ts src/domain/clmm-bundle/normalize.ts src/domain/clmm-bundle/index.ts tests/domain/clmm-bundle/normalize.test.ts --max-warnings 0
pnpm exec prettier --check src/contracts/normalized-clmm-observation.ts src/contracts/index.ts src/domain/clmm-bundle/normalize.ts src/domain/clmm-bundle/index.ts tests/domain/clmm-bundle/normalize.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **fact cardinality**: One bundle maps to one pool and quality fact, one position and fee fact per position, and one trigger fact per supplied alert. (Test: `maps one pool and data-quality candidate plus one position and fee candidate per position and one trigger per alert`)
- **empty collection semantics**: Empty positions and alerts do not create fabricated absence events. (Test: `maps an empty positions and alerts bundle to only pool_state and data_quality`)
- **absence preservation**: Unavailable optionals become null while zero, false, empty arrays, and decimal strings remain present. (Test: `materializes unavailable optional values as null while retaining zero false empty arrays and decimal strings`)
- **stable entity identity**: Every multi-entity payload includes its stable source-independent entity ID. (Test: `includes stable poolId positionId or triggerId in every multi-entity payload`)
- **normalization scope boundary**: Embedded support/resistance and absent volume data are not normalized in this slice. (Test: `does not normalize srLevels or emit volume_metrics`)
