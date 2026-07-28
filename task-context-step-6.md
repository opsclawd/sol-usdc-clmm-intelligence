# Task Context: Task 6

Title: Update bundle runtime and job fixtures to the canonical pool

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

- Modify: `tests/scripts/assemble-evidence-bundle.test.ts` (shared `VALID_REQUEST`, plus the runtime and job describe blocks through approximately line 595)

- [ ] **Step 1: Update the shared request and job lineage fixtures**

In the shared `VALID_REQUEST` and both cases under `job forwards an explicit immutable assembly request unchanged`, replace the stale pool ID in feature rows, raw payloads, `makePoolData`, and `makePositionData` with:

```text
Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE
```

Every pool identity participating in a single case must match so the test continues to exercise forwarding and lineage rather than wrong-pool rejection.

- [ ] **Step 2: Run only the runtime/job subset and inspect its range**

Run:

```bash
pnpm exec vitest run tests/scripts/assemble-evidence-bundle.test.ts -t "runtime composes the bundle repository|job forwards an explicit immutable assembly request unchanged"
sed -n '80,595p' tests/scripts/assemble-evidence-bundle.test.ts | grep -F 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
! sed -n '80,595p' tests/scripts/assemble-evidence-bundle.test.ts | grep -F 'HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw'
pnpm exec eslint tests/scripts/assemble-evidence-bundle.test.ts
pnpm exec prettier --check tests/scripts/assemble-evidence-bundle.test.ts
```

Expected: runtime and job tests pass and their shared-fixture section has one consistent canonical pool.

- [ ] **Step 3: Commit the first independently tested bundle section**

```bash
git add tests/scripts/assemble-evidence-bundle.test.ts
git commit -m "test: update bundle job pool fixtures"
```

## Repository Targets

### Expected Files

- tests/scripts/assemble-evidence-bundle.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/scripts/assemble-evidence-bundle.test.ts -t "runtime composes the bundle repository|job forwards an explicit immutable assembly request unchanged"
sed -n '80,595p' tests/scripts/assemble-evidence-bundle.test.ts | grep -F 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
! sed -n '80,595p' tests/scripts/assemble-evidence-bundle.test.ts | grep -F 'HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw'
["pnpm","exec","eslint","tests/scripts/assemble-evidence-bundle.test.ts"]
["pnpm","exec","prettier","--check","tests/scripts/assemble-evidence-bundle.test.ts"]
```
