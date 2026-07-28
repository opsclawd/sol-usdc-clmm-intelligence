# Task Context: Task 5

Title: Update derive-script validation cases to the canonical pool

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

- Modify: `tests/scripts/derive-mvp-features.test.ts` (only the nested `script validation` block, approximately lines 374-551)

- [ ] **Step 1: Replace stale pool values in the validation block**

Within `describe("script validation")`, replace every present `WHIRLPOOL_ADDRESS` value with:

```ts
WHIRLPOOL_ADDRESS: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE";
```

Keep the `should throw for missing WHIRLPOOL_ADDRESS` case without that variable so it continues to prove required configuration.

- [ ] **Step 2: Run the validation block and scoped identity checks**

Run:

```bash
pnpm exec vitest run tests/scripts/derive-mvp-features.test.ts -t "script validation"
sed -n '374,551p' tests/scripts/derive-mvp-features.test.ts | grep -F 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
! sed -n '374,551p' tests/scripts/derive-mvp-features.test.ts | grep -F 'HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw'
pnpm exec eslint tests/scripts/derive-mvp-features.test.ts
pnpm exec prettier --check tests/scripts/derive-mvp-features.test.ts
```

Expected: every nested validation case passes and the scoped block contains no stale identity.

- [ ] **Step 3: Commit the second independently tested derive-script section**

```bash
git add tests/scripts/derive-mvp-features.test.ts
git commit -m "test: align derive validation pool identity"
```

## Repository Targets

### Expected Files

- tests/scripts/derive-mvp-features.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/scripts/derive-mvp-features.test.ts -t "script validation"
sed -n '374,551p' tests/scripts/derive-mvp-features.test.ts | grep -F 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
! sed -n '374,551p' tests/scripts/derive-mvp-features.test.ts | grep -F 'HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw'
["pnpm","exec","eslint","tests/scripts/derive-mvp-features.test.ts"]
["pnpm","exec","prettier","--check","tests/scripts/derive-mvp-features.test.ts"]
```
