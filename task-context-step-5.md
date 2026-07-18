# Task Context: Task 5

Title: Migrate raw and normalized observation identities

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

- Modify: `src/db/schema/raw-observations.ts`
- Modify: `src/db/schema/normalized-observations.ts`
- Create: `drizzle/0001_clmm_observation_identity.sql`
- Create: `drizzle/meta/0001_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Modify: `tests/db/schema/raw-observations.test.ts`
- Modify: `tests/db/schema/normalized-observations.test.ts`
- Create: `tests/db/migrations/clmm-observation-identity.test.ts`

**Behavioral invariants to test first:**

- `raw identity is unique by source and source_observation_key while source and payload_hash remains a non-unique lookup index` separates replay identity from content equality.
- `normalized identity is unique by raw_observation_id observation_kind and payload_hash` preserves direct lineage across equal historical facts.
- `legacy raw rows receive deterministic non-null 64-character identity keys before the not-null constraint is applied` makes migration safe for populated tables.
- `normalized foreign key remains on-delete restrict` protects lineage.

- [ ] **Step 1: Extend schema tests and add a migration-text regression test that checks the ordered backfill/constraint/index operations by named statement fragments.** The migration test must read only `drizzle/0001_clmm_observation_identity.sql`.
- [ ] **Step 2: Change Drizzle schemas: add `sourceObservationKey` as a `.text().nullable()` column (NOT NULL enforced only by the migration after safe backfill, keeping `$inferInsert` compatible with the existing adapter until Task 6), replace `uniq_raw_obs_source_payload_hash` with `uniq_raw_obs_source_observation_key`, add non-unique `idx_raw_obs_source_payload_hash`, and replace normalized uniqueness with `uniq_norm_obs_raw_kind_hash`.**
- [ ] **Step 3: Generate the named migration with `pnpm db:generate -- --name clmm_observation_identity`, then edit only the generated SQL needed for populated-table safety.** Add the column nullable, backfill with a deterministic 64-character versioned legacy key derived from source, observed timestamp, and payload hash (for example two differently salted built-in `md5` results concatenated), then set `NOT NULL`, drop old unique indexes, and create replacements. Do not require a new PostgreSQL extension.
- [ ] **Step 4: Run `pnpm vitest run tests/db/schema/raw-observations.test.ts tests/db/schema/normalized-observations.test.ts tests/db/migrations/clmm-observation-identity.test.ts` and expect pass.**
- [ ] **Step 5: Run `pnpm exec prettier --check src/db/schema/raw-observations.ts src/db/schema/normalized-observations.ts drizzle/meta/0001_snapshot.json drizzle/meta/_journal.json tests/db/schema/raw-observations.test.ts tests/db/schema/normalized-observations.test.ts tests/db/migrations/clmm-observation-identity.test.ts` and ESLint on the TypeScript files in that same list.**
- [ ] **Step 6: Commit:** `git add src/db/schema/raw-observations.ts src/db/schema/normalized-observations.ts drizzle/0001_clmm_observation_identity.sql drizzle/meta/0001_snapshot.json drizzle/meta/_journal.json tests/db/schema/raw-observations.test.ts tests/db/schema/normalized-observations.test.ts tests/db/migrations/clmm-observation-identity.test.ts && git commit -m "feat(db): migrate observation replay identities"`.

## Repository Targets

### Expected Files

- src/db/schema/raw-observations.ts
- src/db/schema/normalized-observations.ts
- drizzle/0001_clmm_observation_identity.sql
- drizzle/meta/0001_snapshot.json
- drizzle/meta/\_journal.json
- tests/db/schema/raw-observations.test.ts
- tests/db/schema/normalized-observations.test.ts
- tests/db/migrations/clmm-observation-identity.test.ts

## Validation Commands

```bash
pnpm vitest run tests/db/schema/raw-observations.test.ts tests/db/schema/normalized-observations.test.ts tests/db/migrations/clmm-observation-identity.test.ts
pnpm exec eslint src/db/schema/raw-observations.ts src/db/schema/normalized-observations.ts tests/db/schema/raw-observations.test.ts tests/db/schema/normalized-observations.test.ts tests/db/migrations/clmm-observation-identity.test.ts --max-warnings 0
pnpm exec prettier --check src/db/schema/raw-observations.ts src/db/schema/normalized-observations.ts drizzle/meta/0001_snapshot.json drizzle/meta/_journal.json tests/db/schema/raw-observations.test.ts tests/db/schema/normalized-observations.test.ts tests/db/migrations/clmm-observation-identity.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **raw identity constraints**: Source identity is unique while equal content remains legal under different identities. (Test: `raw identity is unique by source and source_observation_key while source and payload_hash remains a non-unique lookup index`)
- **normalized lineage identity**: Normalized uniqueness includes the originating raw observation. (Test: `normalized identity is unique by raw_observation_id observation_kind and payload_hash`)
- **legacy backfill safety**: Every legacy row receives a deterministic 64-character key before the column becomes required. (Test: `legacy raw rows receive deterministic non-null 64-character identity keys before the not-null constraint is applied`)
- **restrictive lineage deletion**: Raw observations referenced by normalized rows cannot be deleted by cascade. (Test: `normalized foreign key remains on-delete restrict`)
