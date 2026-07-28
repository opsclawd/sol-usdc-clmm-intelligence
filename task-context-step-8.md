# Task Context: Task 8

Title: Update bundle replay fixtures to the canonical pool

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-47
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-47
Start Commit: 519075961cf25d1b70b677a37ec123ad7f5ba213

## Task Requirements

**Files:**

- Modify: `tests/scripts/assemble-evidence-bundle.test.ts` (only `replaying the same input file preserves run and creation identity`, approximately lines 909-1122)

- [ ] **Step 1: Update replay input and lineage pool IDs**

Within `describe("replaying the same input file preserves run and creation identity")`, replace the stale pool ID in input data, feature candidates, raw payloads, `makePoolData`, and `makePositionData` with:

```text
Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE
```

Keep run identity, creation time, replay outcome, and persistence assertions unchanged.

- [ ] **Step 2: Run only the replay describe block and inspect its range**

Run:

```bash
pnpm exec vitest run tests/scripts/assemble-evidence-bundle.test.ts -t "replaying the same input file preserves run and creation identity"
sed -n '909,1122p' tests/scripts/assemble-evidence-bundle.test.ts | grep -F 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
! sed -n '909,1122p' tests/scripts/assemble-evidence-bundle.test.ts | grep -F 'HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw'
pnpm exec eslint tests/scripts/assemble-evidence-bundle.test.ts
pnpm exec prettier --check tests/scripts/assemble-evidence-bundle.test.ts
```

Expected: the replay test passes and the scoped describe block contains no stale pool identity.

- [ ] **Step 3: Commit the final independently tested bundle section**

```bash
git add tests/scripts/assemble-evidence-bundle.test.ts
git commit -m "test: align bundle replay pool identity"
```

### Tests to add or update

- Add three parser cases in `tests/domain/pool-statistics/orca.test.ts` for non-first selection, absent configured address, and non-array `data`.
- Update `tests/application/collect-orca-pool-statistics.test.ts` to assert the exact endpoint, encoded plural `addresses` parameter, `stats=24h`, timeout, attempt count, pre-persistence rejection, null optional metrics, and unchanged replay/conflict behavior.
- Update `tests/fixtures/orca-pool.ts` to emit `{ data: [pool] }` and the canonical address.
- Keep `tests/domain/pool-statistics/enrich.test.ts` unchanged but execute it as a compatibility check for fixture/parser consumers.
- Update only pool identity values in the scoped sections of `tests/scripts/derive-mvp-features.test.ts` and `tests/scripts/assemble-evidence-bundle.test.ts`; do not weaken their existing assertions.

### Dedicated validation phase commands

After all implementation tasks and their automatic workspace typecheck gates complete, run:

```bash
pnpm verify
git grep -n 'HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw' -- .env.example README.md docs/operator-runbook.md resources/sources.yaml src tests || true
git grep -n '/public/pool' -- src tests resources || true
```

Expected: `pnpm verify` passes; the stale-address search returns no matches in implementation, tests, configuration, or operator docs; the dead endpoint search returns no matches in active source, tests, or resource declarations.

For the issue's live acceptance criterion, an operator with an intentionally configured writable intelligence database and safe non-production environment must update local `WHIRLPOOL_ADDRESS` to the canonical value, then run:

```bash
pnpm collect:core
```

Expected: the printed `orca` outcome is successful (`accepted` or `identical_replay`) rather than 404/unavailable, and volume/fee values are sourced from the explicit 24-hour stats response. This command performs database writes and must not be run against an unintended environment.

### Risk areas

- The live endpoint may change field names beyond the wrapper described by the approved design. In particular, token, timestamp, slot, TVL, or stats fields must not be guessed or translated without verified evidence.
- Returning the first array member would silently associate evidence with the wrong pool; exact address matching is mandatory even when the API appears filtered.
- Omitting `stats=24h` would make every volume/fee value absent. The URL test and source catalog must pin this query parameter.
- `encodeURIComponent(poolAddress)` prevents malformed query values while preserving normal base58 addresses.
- `OrcaPoolResponse.data` is an exported breaking structural type change. All current consumers must compile in the same task; `src/domain/pool-statistics/index.ts` is a pass-through export and should remain unchanged.
- The collector persists raw and normalized observations. Live validation is irreversible at the database level and must use an explicitly selected safe environment.
- Existing deployments retain their local stale address until an operator changes it. Documentation must state this migration requirement.
- The two script test files are large. Restrict each mechanical change to its named describe block and do not combine unrelated cleanup.

### Stop conditions

- Abort implementation if the verified live `/pools?addresses=<canonical-address>&stats=24h` payload does not expose the fields required by `OrcaPoolData`; revise the design with captured evidence instead of fabricating or silently coercing values.
- Abort live validation if the database target, schema permissions, canonical pool address, or non-production safety of the environment cannot be confirmed.
- Abort and re-plan if endpoint support requires a second API request, pagination, authentication changes, a repository-port change, a database migration, or a normalized contract change; each is outside this plan.
- Stop before committing if a changed file contains unrelated user work that cannot be cleanly preserved.
- Stop if the canonical address does not validate as the SOL/USDC pair under the configured SOL and USDC mints.

## Repository Targets

### Expected Files

- tests/scripts/assemble-evidence-bundle.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/scripts/assemble-evidence-bundle.test.ts -t "replaying the same input file preserves run and creation identity"
sed -n '909,1122p' tests/scripts/assemble-evidence-bundle.test.ts | grep -F 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
! sed -n '909,1122p' tests/scripts/assemble-evidence-bundle.test.ts | grep -F 'HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw'
["pnpm","exec","eslint","tests/scripts/assemble-evidence-bundle.test.ts"]
["pnpm","exec","prettier","--check","tests/scripts/assemble-evidence-bundle.test.ts"]
```
