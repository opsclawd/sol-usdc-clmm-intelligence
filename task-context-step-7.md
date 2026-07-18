# Task Context: Task 7

Title: Add atomic idempotent normalized batch insertion

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

- Modify: `src/ports/normalized-observation-repo.ts`
- Modify: `src/ports/index.ts`
- Modify: `src/adapters/node/drizzle-normalized-observation-repo.ts`
- Modify: `tests/fakes/fake-normalized-observation-repo.ts`
- Modify: `tests/ports/normalized-observation-repo.test.ts`
- Modify: `tests/adapters/node/drizzle-observation-repos.integration.test.ts`

**Behavioral invariants to test first:**

- `insertMany inserts every row or exposes none when one row fails` defines transaction-level atomicity.
- `insertMany replay for the same raw kind and payload hash returns existing rows without duplicates` makes crash recovery safe.
- `equal normalized content from distinct raw observations creates distinct rows` preserves direct lineage.
- `insertMany returns rows in input order across inserted and replayed members` gives deterministic orchestration results.

- [ ] **Step 1: Add fake contract tests and normalized integration cases before changing the interface.** Give the fake an explicit fail-at-index hook that rolls back its staged batch so application tests can prove all-or-nothing visibility.
- [ ] **Step 2: Run `pnpm vitest run tests/ports/normalized-observation-repo.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts` and confirm missing batch behavior fails.**
- [ ] **Step 3: Add `insertMany(rows: readonly NormalizedObservationInsert[]): Promise<NormalizedObservationRow[]>` to `NormalizedObservationRepo` and update both implementations in this same task.** The Drizzle implementation must use `db.transaction`, conflict on `(rawObservationId, observationKind, payloadHash)`, reload conflicts with that same identity, and preserve input order. Retain `insert` only if existing consumers still need it; if retained, implement it through a one-row batch so semantics cannot diverge.
- [ ] **Step 4: Rerun focused tests, then run `pnpm exec eslint src/ports/normalized-observation-repo.ts src/ports/index.ts src/adapters/node/drizzle-normalized-observation-repo.ts tests/fakes/fake-normalized-observation-repo.ts tests/ports/normalized-observation-repo.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts --max-warnings 0` and `pnpm exec prettier --check src/ports/normalized-observation-repo.ts src/ports/index.ts src/adapters/node/drizzle-normalized-observation-repo.ts tests/fakes/fake-normalized-observation-repo.ts tests/ports/normalized-observation-repo.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts`.**
- [ ] **Step 5: Commit:** `git add src/ports/normalized-observation-repo.ts src/ports/index.ts src/adapters/node/drizzle-normalized-observation-repo.ts tests/fakes/fake-normalized-observation-repo.ts tests/ports/normalized-observation-repo.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts && git commit -m "feat(persist): insert normalized observations atomically"`.

## Repository Targets

### Expected Files

- src/ports/normalized-observation-repo.ts
- src/ports/index.ts
- src/adapters/node/drizzle-normalized-observation-repo.ts
- tests/fakes/fake-normalized-observation-repo.ts
- tests/ports/normalized-observation-repo.test.ts
- tests/adapters/node/drizzle-observation-repos.integration.test.ts

## Validation Commands

```bash
pnpm vitest run tests/ports/normalized-observation-repo.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts
pnpm exec eslint src/ports/normalized-observation-repo.ts src/ports/index.ts src/adapters/node/drizzle-normalized-observation-repo.ts tests/fakes/fake-normalized-observation-repo.ts tests/ports/normalized-observation-repo.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts --max-warnings 0
pnpm exec prettier --check src/ports/normalized-observation-repo.ts src/ports/index.ts src/adapters/node/drizzle-normalized-observation-repo.ts tests/fakes/fake-normalized-observation-repo.ts tests/ports/normalized-observation-repo.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **normalized batch atomicity**: A failed member prevents every row in that attempted batch from becoming visible. (Test: `insertMany inserts every row or exposes none when one row fails`)
- **normalized replay idempotency**: Replaying the same raw, kind, and payload identity returns existing rows without duplicates. (Test: `insertMany replay for the same raw kind and payload hash returns existing rows without duplicates`)
- **historical lineage separation**: Equal normalized content from different raw rows remains distinct history. (Test: `equal normalized content from distinct raw observations creates distinct rows`)
- **batch result ordering**: Returned rows preserve input order whether inserted or recovered. (Test: `insertMany returns rows in input order across inserted and replayed members`)
