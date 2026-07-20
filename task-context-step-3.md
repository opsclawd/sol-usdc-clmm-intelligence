# Task Context: Task 3

Title: Add bounded candidate reads and pure deterministic selectors

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-25
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-25
Start Commit: 72198d814d2ef33860d879741b7b7acc3b54e679

## Task Requirements

**Files:**

- Modify: `src/ports/normalized-observation-repo.ts`
- Modify: `src/adapters/node/drizzle-normalized-observation-repo.ts`
- Modify: `tests/fakes/fake-normalized-observation-repo.ts`
- Create: `src/domain/derived-feature/select.ts`
- Modify: `src/domain/derived-feature/index.ts`
- Create: `tests/domain/derived-feature/select.test.ts`
- Modify: `tests/ports/normalized-observation-repo.test.ts`

**Behavioral invariants (write these tests first):**

- `candidate reads filter source kind and inclusive receipt lower bound`: the port performs only coarse indexed filtering and returns `(receivedAtUnixMs, id)` ascending.
- `selects the latest exact-scope valid row with deterministic tie breaks`: compare semantic time, provider slot when present, receipt time, then normalized ID.
- `rejects a persisted-fresh row that expired by evaluation time`: `isStale === false` never overrides `validUntilUnixMs <= evaluationAsOfUnixMs`.
- `records malformed wrong-source and wrong-scope candidates deterministically`: rejected IDs and reasons are stable regardless of database input order.
- `deduplicates volatility timestamps by slot receipt and id`: select the highest slot, then receipt time, then ID, sort timestamps ascending, and retain discarded IDs.
- `accepts historical volatility samples while requiring a fresh anchor`: samples inside the one-hour window may be expired at evaluation time; the latest anchor may not be.

- [ ] **Step 1: Add failing port and selector tests.** Cover pair/pool/position matching, source allowlists, malformed payloads, dynamic expiry, semantic tie breaks, out-of-order series, inclusive lookback, and duplicate timestamps.

- [ ] **Step 2: Add one bounded query method and update every implementation in the same step.** This is an exported port change and must remain atomic across the port, Drizzle adapter, and fake.

```ts
export interface NormalizedObservationCandidateQuery {
  readonly sourceKinds: readonly {
    readonly source: Source;
    readonly observationKind: ObservationKind;
  }[];
  readonly receivedAtOrAfterUnixMs: number;
}

export interface NormalizedObservationRepo {
  // existing methods remain
  listCandidates(query: NormalizedObservationCandidateQuery): Promise<NormalizedObservationRow[]>;
}
```

The Drizzle implementation must build an `OR` over source/kind pairs plus the receipt lower bound and order by receipt then ID. The fake must mirror those semantics exactly.

- [ ] **Step 3: Implement pure payload narrowing and selectors.** Return selected rows and structured rejected candidates; do not import ports, DB, environment, clock, or adapters.

```ts
export interface CandidateRejection {
  readonly observationId: number;
  readonly reason: string;
}

export interface Selection<T> {
  readonly selected: readonly T[];
  readonly rejected: readonly CandidateRejection[];
}

export const SELECTION_VERSION = "mvp-feature-selection/v1";
```

- [ ] **Step 4: Run the selector/port checks.** Expected: stable results for all permutations of the same candidates.

**Validation commands:**

```bash
pnpm exec vitest run tests/domain/derived-feature/select.test.ts tests/ports/normalized-observation-repo.test.ts
pnpm exec eslint src/ports/normalized-observation-repo.ts src/adapters/node/drizzle-normalized-observation-repo.ts tests/fakes/fake-normalized-observation-repo.ts src/domain/derived-feature/select.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/select.test.ts tests/ports/normalized-observation-repo.test.ts --max-warnings 0
pnpm exec prettier --check src/ports/normalized-observation-repo.ts src/adapters/node/drizzle-normalized-observation-repo.ts tests/fakes/fake-normalized-observation-repo.ts src/domain/derived-feature/select.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/select.test.ts tests/ports/normalized-observation-repo.test.ts
```

**Commit:** `feat: select bounded feature inputs deterministically`

## Repository Targets

### Expected Files

- src/ports/normalized-observation-repo.ts
- src/adapters/node/drizzle-normalized-observation-repo.ts
- tests/fakes/fake-normalized-observation-repo.ts
- src/domain/derived-feature/select.ts
- src/domain/derived-feature/index.ts
- tests/domain/derived-feature/select.test.ts
- tests/ports/normalized-observation-repo.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/domain/derived-feature/select.test.ts tests/ports/normalized-observation-repo.test.ts
pnpm exec eslint src/ports/normalized-observation-repo.ts src/adapters/node/drizzle-normalized-observation-repo.ts tests/fakes/fake-normalized-observation-repo.ts src/domain/derived-feature/select.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/select.test.ts tests/ports/normalized-observation-repo.test.ts --max-warnings 0
pnpm exec prettier --check src/ports/normalized-observation-repo.ts src/adapters/node/drizzle-normalized-observation-repo.ts tests/fakes/fake-normalized-observation-repo.ts src/domain/derived-feature/select.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/select.test.ts tests/ports/normalized-observation-repo.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **bounded candidate read**: Candidate reads filter only requested source/kind pairs and an inclusive receipt lower bound, returning receipt/id order. (Test: `candidate reads filter source kind and inclusive receipt lower bound`)
- **deterministic latest selection**: Semantic time, provider slot, receipt time, and normalized ID form the complete tie-break order. (Test: `selects the latest exact-scope valid row with deterministic tie breaks`)
- **dynamic expiry**: A row at or beyond its validity deadline is rejected even if persisted isStale is false. (Test: `rejects a persisted-fresh row that expired by evaluation time`)
- **deterministic rejection audit**: Malformed, wrong-source, and wrong-scope candidates produce stable rejected IDs and reasons independent of input order. (Test: `records malformed wrong-source and wrong-scope candidates deterministically`)
- **volatility timestamp deduplication**: Duplicate timestamp winners use slot, receipt, then ID and discarded IDs remain auditable. (Test: `deduplicates volatility timestamps by slot receipt and id`)
- **fresh anchor historical window**: The volatility anchor must be fresh while valid historical samples inside the window may have expired by evaluation time. (Test: `accepts historical volatility samples while requiring a fresh anchor`)
