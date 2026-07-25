# Task Context: Task 3

Title: Add bounded candidate reads and deterministic selectors

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-8
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-8
Start Commit: 5701491d28b2b8489db6ce45b5b24d87d3570a52

## Task Requirements

**Files:** Modify `src/ports/normalized-observation-repo.ts`, `src/adapters/node/drizzle-normalized-observation-repo.ts`, `tests/fakes/fake-normalized-observation-repo.ts`, `src/domain/derived-feature/index.ts`, `tests/ports/normalized-observation-repo.test.ts`, `tests/application/assemble-context-events.test.ts`, and `tests/application/assemble-evidence-bundle.test.ts`; create `src/domain/derived-feature/select.ts` and `tests/domain/derived-feature/select.test.ts`.

**Behavioral invariants to test first**

- `candidate reads filter source kind and inclusive receipt lower bound`
- `selects the latest exact-scope valid row with deterministic tie breaks`
- `rejects a persisted-fresh row that expired by evaluation time`
- `records malformed wrong-source and wrong-scope candidates deterministically`
- `deduplicates volatility timestamps by slot receipt and id`
- `accepts historical volatility samples while requiring a fresh anchor`

- [ ] Write failing port/selector tests covering source-kind pairs, exact scope, malformed payloads, expiry, semantic time, slot/receipt/ID ties, inclusive lookback, and duplicate timestamps.
- [ ] In one atomic interface-plus-implementations change, add:

```ts
export interface NormalizedObservationCandidateQuery {
  readonly sourceKinds: readonly {
    readonly source: Source;
    readonly observationKind: ObservationKind;
  }[];
  readonly receivedAtOrAfterUnixMs: number;
}
export interface NormalizedObservationRepo {
  // existing members remain
  listCandidates(query: NormalizedObservationCandidateQuery): Promise<NormalizedObservationRow[]>;
}
```

Drizzle must build an `OR` over exact source/kind pairs, apply the inclusive receipt bound, and order by receipt then ID. The fake must mirror this behavior. Update any fake instantiations in `tests/application/assemble-context-events.test.ts` and `tests/application/assemble-evidence-bundle.test.ts` to satisfy the interface.

- [ ] Add pure payload narrowing and selectors returning sorted selected rows and `{ observationId, reason }` rejections. Volatility duplicate selection uses highest provider slot, then receipt time, then ID; historical samples may be expired but the anchor may not.
- [ ] Run:

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
- tests/application/assemble-context-events.test.ts
- tests/application/assemble-evidence-bundle.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/domain/derived-feature/select.test.ts tests/ports/normalized-observation-repo.test.ts
pnpm exec eslint src/ports/normalized-observation-repo.ts src/adapters/node/drizzle-normalized-observation-repo.ts tests/fakes/fake-normalized-observation-repo.ts src/domain/derived-feature/select.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/select.test.ts tests/ports/normalized-observation-repo.test.ts --max-warnings 0
pnpm exec prettier --check src/ports/normalized-observation-repo.ts src/adapters/node/drizzle-normalized-observation-repo.ts tests/fakes/fake-normalized-observation-repo.ts src/domain/derived-feature/select.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/select.test.ts tests/ports/normalized-observation-repo.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **bounded candidate query**: Candidate reads apply exact source-kind pairs and an inclusive receipt lower bound. (Test: `candidate reads filter source kind and inclusive receipt lower bound`)
- **deterministic latest selection**: Selection uses semantic time, provider slot, receipt time, then normalized ID. (Test: `selects the latest exact-scope valid row with deterministic tie breaks`)
- **dynamic expiry**: Evaluation-time expiry overrides a persisted fresh snapshot. (Test: `rejects a persisted-fresh row that expired by evaluation time`)
- **deterministic rejection**: Malformed, wrong-source, and wrong-scope rejections are stable under input permutation. (Test: `records malformed wrong-source and wrong-scope candidates deterministically`)
- **volatility deduplication**: Duplicate timestamps choose the highest slot, receipt time, then ID. (Test: `deduplicates volatility timestamps by slot receipt and id`)
- **historical sample eligibility**: Expired historical samples may contribute while the latest anchor must be fresh. (Test: `accepts historical volatility samples while requiring a fresh anchor`)
