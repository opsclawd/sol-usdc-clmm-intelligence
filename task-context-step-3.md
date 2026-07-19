# Task Context: Task 3

Title: Implement exact Pyth acceptance, identity, and normalization

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-23
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-23
Start Commit: 6a3197f1ad619c2594d8a693577cd6c67b3689f1

## Task Requirements

**Files:**

- Create: `tests/fixtures/pyth-price-update.ts`
- Create: `src/domain/price-observation/decimal.ts`
- Create: `src/domain/price-observation/pyth.ts`
- Create: `src/domain/price-observation/index.ts`
- Create: `tests/domain/price-observation/pyth.test.ts`

**Provider contract:** `acceptPythEnvelope` validates exactly one configured feed update while returning the complete original response for raw storage. `derivePythSourceObservationKey` hashes `{ identityVersion: 1, feedId, publishTimeUnixSeconds }`. `normalizePythPrice` rejects non-positive price and emits exact decimal bounds and ratio bps.

- [ ] **Step 1: Add a sanitized full Hermes fixture and failing tests.** Cover feed mismatch, missing parsed price, invalid integer strings/exponent/time, optional slot, extra envelope fields retained, key-order-stable identity, identity-field changes, negative exponent conversion, exact lower/upper bounds, and no precision loss. Name the arithmetic case `converts fixed-point and atomic integer strings without binary floating-point loss` and the identity case `uses versioned source identities and detects changed content at the same identity`.
- [ ] **Step 2: Run the test and confirm missing modules.** Run `pnpm exec vitest run tests/domain/price-observation/pyth.test.ts`; expect failure because the Pyth and decimal modules do not exist.
- [ ] **Step 3: Implement minimal pure helpers.** Use Zod for shape/string constraints, `BigInt` plus decimal-string shift/division helpers for exact output, canonical hashing for identity, and warning `oracle_confidence_wide` when the absolute confidence-to-price ratio exceeds 100 bps. Never import ports, clocks, or adapters.
- [ ] **Step 4: Verify this task.** Run `pnpm exec vitest run tests/domain/price-observation/pyth.test.ts tests/domain/content-hash.test.ts` and `pnpm exec eslint tests/fixtures/pyth-price-update.ts src/domain/price-observation/decimal.ts src/domain/price-observation/pyth.ts src/domain/price-observation/index.ts tests/domain/price-observation/pyth.test.ts`; expect all selected checks to pass.
- [ ] **Step 5: Commit.** Run `git add tests/fixtures/pyth-price-update.ts src/domain/price-observation/decimal.ts src/domain/price-observation/pyth.ts src/domain/price-observation/index.ts tests/domain/price-observation/pyth.test.ts && git commit -m "feat: normalize Pyth oracle prices"`.

## Repository Targets

### Expected Files

- tests/fixtures/pyth-price-update.ts
- src/domain/price-observation/decimal.ts
- src/domain/price-observation/pyth.ts
- src/domain/price-observation/index.ts
- tests/domain/price-observation/pyth.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/domain/price-observation/pyth.test.ts tests/domain/content-hash.test.ts
pnpm exec eslint tests/fixtures/pyth-price-update.ts src/domain/price-observation/decimal.ts src/domain/price-observation/pyth.ts src/domain/price-observation/index.ts tests/domain/price-observation/pyth.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **exact fixed-point arithmetic**: Pyth integer price, confidence, exponent, bounds, and ratio become canonical decimal strings without binary floating-point arithmetic. (Test: `converts fixed-point and atomic integer strings without binary floating-point loss`)
- **versioned Pyth identity**: Object key ordering does not alter identity, while feed ID or publish time changes do; changed response content under one identity remains conflict-detectable. (Test: `uses versioned source identities and detects changed content at the same identity`)
