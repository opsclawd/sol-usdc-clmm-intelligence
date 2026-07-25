# Task Context: Task 8

Title: Migrate and constrain derived-feature storage

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-8
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-8
Start Commit: 5701491d28b2b8489db6ce45b5b24d87d3570a52

## Task Requirements

**Files:** Modify `src/db/schema/derived-features.ts`, `drizzle/meta/_journal.json`, and `tests/db/schema/derived-features.test.ts`; create `drizzle/0002_derived_feature_tranche.sql`, `drizzle/meta/0002_snapshot.json`, and `tests/db/migrations/derived-feature-tranche.test.ts`.

**Behavioral invariants to test first**

- `migration aborts when historical derived feature rows exist`
- `database status and value constraints exclude fake availability`
- `database unit kind and scope checks mirror the contract`
- `database replay identity is feature kind plus derivation key`

- [ ] Add failing schema/migration tests for new columns, every check/index, and safe statement ordering.
- [ ] Add non-null status/unit/pair/versions/ID arrays/derivation key/structured payload, optional scope IDs, warnings/reasons, and contract-mirroring checks to Drizzle.
- [ ] Run `pnpm db:generate`, retain generated snapshot/journal consistency, then edit SQL so a precondition block aborts if any row exists before adding non-null columns. Drop the old kind/payload unique index and create `uniq_features_kind_derivation_key` on `(feature_kind, derivation_key)`; never backfill or delete.
- [ ] Run:

```bash
pnpm exec vitest run tests/db/schema/derived-features.test.ts tests/db/migrations/derived-feature-tranche.test.ts
pnpm exec eslint src/db/schema/derived-features.ts tests/db/schema/derived-features.test.ts tests/db/migrations/derived-feature-tranche.test.ts --max-warnings 0
pnpm exec prettier --check src/db/schema/derived-features.ts drizzle/meta/_journal.json drizzle/meta/0002_snapshot.json tests/db/schema/derived-features.test.ts tests/db/migrations/derived-feature-tranche.test.ts
```

**Commit:** `feat: constrain derived feature persistence`

## Repository Targets

### Expected Files

- src/db/schema/derived-features.ts
- drizzle/0002_derived_feature_tranche.sql
- drizzle/meta/\_journal.json
- drizzle/meta/0002_snapshot.json
- tests/db/schema/derived-features.test.ts
- tests/db/migrations/derived-feature-tranche.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/db/schema/derived-features.test.ts tests/db/migrations/derived-feature-tranche.test.ts
pnpm exec eslint src/db/schema/derived-features.ts tests/db/schema/derived-features.test.ts tests/db/migrations/derived-feature-tranche.test.ts --max-warnings 0
pnpm exec prettier --check src/db/schema/derived-features.ts drizzle/meta/_journal.json drizzle/meta/0002_snapshot.json tests/db/schema/derived-features.test.ts tests/db/migrations/derived-feature-tranche.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **safe migration precondition**: Historical feature rows abort migration before any alteration. (Test: `migration aborts when historical derived feature rows exist`)
- **database status value consistency**: Database checks require null unavailable values and non-null available or partial values. (Test: `database status and value constraints exclude fake availability`)
- **database contract parity**: Kind, unit, and scope checks mirror the runtime contract. (Test: `database unit kind and scope checks mirror the contract`)
- **database replay identity**: The unique replay key is feature kind plus derivation key. (Test: `database replay identity is feature kind plus derivation key`)
