# Task Context: Task 4

Title: Implement exact Jupiter quote acceptance, identity, and normalization

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

- Create: `tests/fixtures/jupiter-quote.ts`
- Create: `src/domain/price-observation/jupiter.ts`
- Modify: `src/domain/price-observation/index.ts`
- Create: `tests/domain/price-observation/jupiter.test.ts`

**Provider contract:** `acceptJupiterQuote` requires configured SOL/USDC mints, `ExactIn`, `1_000_000_000` input units, positive output, context slot, and a non-empty route. `deriveJupiterSourceObservationKey` hashes `{ identityVersion: 1, inputMint, outputMint, inAmount, swapMode, contextSlot }`.

- [ ] **Step 1: Add a sanitized full quote fixture and failing tests.** Name the contract case `accepts only the deterministic one SOL ExactIn route contract`; cover wrong mints/input/swap mode, missing slot, empty route, zero output, invalid atomic strings, extra response fields retained, stable/versioned identity, exact 6/9-decimal implied price, configured 50 bps slippage, `restrictIntermediateTokens=true`, route summaries, split/multi-hop informational metadata, and `high_price_impact` above 100 bps.
- [ ] **Step 2: Run the test and confirm missing behavior.** Run `pnpm exec vitest run tests/domain/price-observation/jupiter.test.ts`; expect failure because the Jupiter module does not exist.
- [ ] **Step 3: Implement the pure Jupiter module.** Reuse only the exact decimal helpers from Task 3, preserve raw atomic strings, parse price impact as a decimal string without `Number`-based price arithmetic, and distinguish invalid/no-route acceptance errors from accepted warning metadata.
- [ ] **Step 4: Verify this task.** Run `pnpm exec vitest run tests/domain/price-observation/jupiter.test.ts tests/domain/price-observation/pyth.test.ts` and `pnpm exec eslint tests/fixtures/jupiter-quote.ts src/domain/price-observation/jupiter.ts src/domain/price-observation/index.ts tests/domain/price-observation/jupiter.test.ts`; expect all selected checks to pass.
- [ ] **Step 5: Commit.** Run `git add tests/fixtures/jupiter-quote.ts src/domain/price-observation/jupiter.ts src/domain/price-observation/index.ts tests/domain/price-observation/jupiter.test.ts && git commit -m "feat: normalize Jupiter executable quotes"`.

## Repository Targets

### Expected Files

- tests/fixtures/jupiter-quote.ts
- src/domain/price-observation/jupiter.ts
- src/domain/price-observation/index.ts
- tests/domain/price-observation/jupiter.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/domain/price-observation/jupiter.test.ts tests/domain/price-observation/pyth.test.ts
pnpm exec eslint tests/fixtures/jupiter-quote.ts src/domain/price-observation/jupiter.ts src/domain/price-observation/index.ts tests/domain/price-observation/jupiter.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **deterministic quote acceptance**: Only the configured SOL-to-USDC ExactIn one-SOL quote with positive output, context slot, and non-empty route is accepted. (Test: `accepts only the deterministic one SOL ExactIn route contract`)
- **exact implied price**: Atomic inputs and outputs are retained as strings and converted to an exact USDC-per-SOL decimal string. (Test: `converts fixed-point and atomic integer strings without binary floating-point loss`)
- **versioned Jupiter identity**: Mint pair, input amount, swap mode, and context slot determine identity independently from response key order. (Test: `uses versioned source identities and detects changed content at the same identity`)
