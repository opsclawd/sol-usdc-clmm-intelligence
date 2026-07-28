# Task Context: Task 3

Title: Document the canonical Orca pool default

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

- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/operator-runbook.md`
- Reference only: `tests/fixtures/orca-pool.ts`

- [ ] **Step 1: Replace operator-facing stale pool identities**

Replace every operator-facing occurrence of:

```text
HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw
```

with:

```text
Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE
```

in `.env.example`, `README.md`, and `docs/operator-runbook.md`. This includes both `ORCA_SOL_USDC_WHIRLPOOL` and `WHIRLPOOL_ADDRESS`, as well as pool IDs in example payloads. Add this exact sentence next to the operator-runbook variable description:

```text
Existing deployments must update their local pool variables; changes to `.env.example` do not rewrite an existing `.env`.
```

- [ ] **Step 2: Verify only the changed configuration and documentation sections**

Run:

```bash
sed -n '48,68p' .env.example | grep -F 'ORCA_SOL_USDC_WHIRLPOOL=Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
sed -n '48,68p' .env.example | grep -F 'WHIRLPOOL_ADDRESS=Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
sed -n '325,340p' README.md | grep -F 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
sed -n '555,570p' README.md | grep -F 'ORCA_SOL_USDC_WHIRLPOOL=Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
sed -n '55,66p' docs/operator-runbook.md | grep -F 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
sed -n '318,330p' docs/operator-runbook.md | grep -F 'WHIRLPOOL_ADDRESS=Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
sed -n '416,428p' docs/operator-runbook.md | grep -F 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
git diff --check -- .env.example README.md docs/operator-runbook.md
```

Expected: every scoped example reports the canonical address and `git diff --check` reports no whitespace errors.

- [ ] **Step 3: Commit the operator-default update**

```bash
git add .env.example README.md docs/operator-runbook.md
git commit -m "docs: set canonical Orca SOL USDC pool"
```

## Repository Targets

### Expected Files

- .env.example
- README.md
- docs/operator-runbook.md

### Reference Files

- tests/fixtures/orca-pool.ts

## Validation Commands

```bash
sed -n '48,68p' .env.example | grep -F 'ORCA_SOL_USDC_WHIRLPOOL=Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
sed -n '48,68p' .env.example | grep -F 'WHIRLPOOL_ADDRESS=Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
sed -n '325,340p' README.md | grep -F 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
sed -n '555,570p' README.md | grep -F 'ORCA_SOL_USDC_WHIRLPOOL=Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
sed -n '55,66p' docs/operator-runbook.md | grep -F 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
sed -n '318,330p' docs/operator-runbook.md | grep -F 'WHIRLPOOL_ADDRESS=Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
sed -n '416,428p' docs/operator-runbook.md | grep -F 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
git diff --check -- .env.example README.md docs/operator-runbook.md
```
