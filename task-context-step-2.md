# Task Context: Task 2

Title: Extend derived-feature persistence for Pack C kinds

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

- Modify: `src/contracts/derived-feature.ts`
- Modify: `src/db/schema/derived-features.ts`
- Modify: `tests/domain/derived-feature/contract.test.ts` (only canonical-kind, BPS-unit, and pair-scope cases)
- Modify: `tests/db/schema/derived-features.test.ts` (only the feature allowlist/unit invariant block)
- Create: `tests/db/migrations/perp-liquidation-feature-kinds.test.ts`
- Create: `drizzle/0007_perp_liquidation_feature_kinds.sql`
- Create: `drizzle/meta/0007_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Write failing contract, schema, and migration tests**

  Add one table-driven case for each new feature proving it is canonical, requires `BPS`, and requires null pool/position scope. The migration test must assert that the old allowlist and relevant BPS/scope checks are dropped and recreated with the four Pack C kinds, and that the migration contains no `DELETE`, `UPDATE`, or `TRUNCATE`.

- [ ] **Step 2: Verify focused tests fail**

  Run: `pnpm vitest run tests/domain/derived-feature/contract.test.ts tests/db/schema/derived-features.test.ts tests/db/migrations/perp-liquidation-feature-kinds.test.ts`

  Expected: FAIL because the contract and database allowlists reject Pack C features.

- [ ] **Step 3: Extend the application-level feature contract and bundle assembly**

  Add the four kinds to the canonical feature-kind set and BPS-kind set in `src/contracts/derived-feature.ts`. Keep `FeatureUnit` unchanged (`BPS | PPM`) and make the new kinds pair-scoped:

  ```ts
  const PERP_BPS_KINDS = new Set([
    "oi_trend_4h",
    "funding_rate_annualized",
    "liquidation_cluster_1h",
    "basis_spread_bps"
  ]);
  ```

  `parseDerivedFeatureV1` must reject PPM for these kinds and reject non-null `poolId` or `positionId`.

  In `src/domain/evidence-bundle/assemble.ts`, `src/domain/evidence-bundle/quality.ts`, `src/domain/evidence-bundle/select.ts`, and `src/application/assemble-evidence-bundle.ts`, update evidence bundle selection and assembly helpers to recognize the new pair-wide Pack C feature kinds alongside existing feature types. Ensure bundle selection logic queries and selects `oi_trend_4h`, `funding_rate_annualized`, `liquidation_cluster_1h`, and `basis_spread_bps` when assembling SOL/USDC evidence bundles.

- [ ] **Step 4: Update Drizzle checks and generate a forward-only migration**

  Update `chk_features_kind_allowlist`, BPS checks, and pair-wide scope checks in the schema. Run:

  `pnpm exec drizzle-kit generate --name=perp_liquidation_feature_kinds`

  Inspect the generated SQL. It may only drop/recreate check constraints; it must preserve existing rows and must not weaken status/value, uniqueness, or existing kind constraints. Ensure the generated paths are exactly `drizzle/0007_perp_liquidation_feature_kinds.sql` and `drizzle/meta/0007_snapshot.json`.

- [ ] **Step 5: Run focused tests and formatting**

  Run: `pnpm vitest run tests/domain/derived-feature/contract.test.ts tests/db/schema/derived-features.test.ts tests/db/migrations/perp-liquidation-feature-kinds.test.ts`

  Expected: PASS.

  Run: `pnpm exec prettier --check src/contracts/derived-feature.ts src/db/schema/derived-features.ts tests/domain/derived-feature/contract.test.ts tests/db/schema/derived-features.test.ts tests/db/migrations/perp-liquidation-feature-kinds.test.ts drizzle/meta/0007_snapshot.json drizzle/meta/_journal.json`

  Expected: exit 0.

- [ ] **Step 6: Commit**

  ```bash
  git add src/contracts/derived-feature.ts src/db/schema/derived-features.ts tests/domain/derived-feature/contract.test.ts tests/db/schema/derived-features.test.ts tests/db/migrations/perp-liquidation-feature-kinds.test.ts drizzle/0007_perp_liquidation_feature_kinds.sql drizzle/meta/0007_snapshot.json drizzle/meta/_journal.json
  git commit -m "feat: persist perp liquidation feature kinds"
  ```

## Repository Targets

### Expected Files

- src/contracts/derived-feature.ts
- src/db/schema/derived-features.ts
- tests/domain/derived-feature/contract.test.ts
- tests/db/schema/derived-features.test.ts
- tests/db/migrations/perp-liquidation-feature-kinds.test.ts
- drizzle/0007_perp_liquidation_feature_kinds.sql
- drizzle/meta/0007_snapshot.json
- drizzle/meta/\_journal.json

## Validation Commands

```bash
pnpm vitest run tests/domain/derived-feature/contract.test.ts tests/db/schema/derived-features.test.ts tests/db/migrations/perp-liquidation-feature-kinds.test.ts
pnpm exec prettier --check src/contracts/derived-feature.ts src/db/schema/derived-features.ts tests/domain/derived-feature/contract.test.ts tests/db/schema/derived-features.test.ts tests/db/migrations/perp-liquidation-feature-kinds.test.ts drizzle/meta/0007_snapshot.json drizzle/meta/_journal.json
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **Pack C features are pair-scoped BPS**: All four Pack C features require BPS units and null pool and position identifiers. (Test: `accepts Pack C features only as pair-scoped BPS values`)
- **migration preserves history**: The allowlist migration only replaces checks and never deletes, truncates, or rewrites existing feature rows. (Test: `broadens feature checks without rewriting historical rows`)
