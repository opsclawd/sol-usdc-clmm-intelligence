# Task Context: Task 4

Title: Update derive-script primary cases to the canonical pool

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

- Modify: `tests/scripts/derive-mvp-features.test.ts` (only the `derive-mvp-features script` cases before the nested `script validation` block, approximately lines 252-373)

- [ ] **Step 1: Replace stale `WHIRLPOOL_ADDRESS` values in the scoped cases**

Within the two top-level cases named `script prints deterministic status counts and sorted warnings after persistence` and `script fails for missing scope malformed position list or infrastructure failure`, replace each configured pool value with:

```ts
WHIRLPOOL_ADDRESS: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE";
```

Do not change the missing-variable fixture or any assertions; this task updates fixture identity only.

- [ ] **Step 2: Run only the changed test cases and section checks**

Run:

```bash
pnpm exec vitest run tests/scripts/derive-mvp-features.test.ts -t "script prints deterministic status counts|script fails for missing scope"
sed -n '252,373p' tests/scripts/derive-mvp-features.test.ts | grep -F 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
! sed -n '252,373p' tests/scripts/derive-mvp-features.test.ts | grep -F 'HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw'
pnpm exec eslint tests/scripts/derive-mvp-features.test.ts
pnpm exec prettier --check tests/scripts/derive-mvp-features.test.ts
```

Expected: the two selected cases pass, the scoped section contains the canonical address and no stale address, and file lint/format checks pass.

- [ ] **Step 3: Commit the first independently tested derive-script section**

```bash
git add tests/scripts/derive-mvp-features.test.ts
git commit -m "test: update derive script pool fixtures"
```

## Repository Targets

### Expected Files

- tests/scripts/derive-mvp-features.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/scripts/derive-mvp-features.test.ts -t "script prints deterministic status counts|script fails for missing scope"
sed -n '252,373p' tests/scripts/derive-mvp-features.test.ts | grep -F 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
! sed -n '252,373p' tests/scripts/derive-mvp-features.test.ts | grep -F 'HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw'
["pnpm","exec","eslint","tests/scripts/derive-mvp-features.test.ts"]
["pnpm","exec","prettier","--check","tests/scripts/derive-mvp-features.test.ts"]
```
