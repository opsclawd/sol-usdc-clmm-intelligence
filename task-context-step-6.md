# Task Context: Task 6

Title: Implement oracle and pool market calculators

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-25
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-25
Start Commit: 72198d814d2ef33860d879741b7b7acc3b54e679

## Task Requirements

**Files:**

- Create: `src/domain/derived-feature/market.ts`
- Modify: `src/domain/derived-feature/index.ts`
- Create: `tests/domain/derived-feature/market.test.ts`

**Behavioral invariants (write these tests first):**

- `calculates absolute oracle DEX divergence only from Pyth and executable Jupiter quote`: valid inputs at no more than 30 seconds skew return BPS; pool price is never a substitute.
- `makes divergence unavailable for missing route stale input or excessive skew`: each defect returns `UNAVAILABLE`, `null`, and a stable reason.
- `retains a partial divergence value for nonfatal input quality`: wide Pyth confidence or a nonfatal Jupiter quality warning yields `PARTIAL` with the numeric value.
- `measures wide oracle confidence as partial rather than missing`: width is `confidence / price * 10_000`; halted/auction, negative confidence, or nonpositive price is unavailable.
- `accepts zero volume only with positive TVL`: zero volume yields available zero; missing volume/TVL or nonpositive TVL yields unavailable null; provider warning with both operands yields partial.

- [ ] **Step 1: Add failing golden tests** for exact divergence, exact confidence width, exact volume ratio, rounding ties, stale oracle, unavailable route, wide confidence, skew, legitimate zero volume, missing liquidity, and zero/negative liquidity.

- [ ] **Step 2: Implement the three pure calculators** with no source fallback and fixed versions.

```ts
export const MARKET_CALCULATOR_VERSIONS = {
  oracle_dex_divergence: "oracle-dex-divergence/v1",
  oracle_confidence_width: "oracle-confidence-width/v1",
  volume_liquidity_ratio_24h: "volume-liquidity-ratio-24h/v1"
} as const;

// divergence = abs(dex - oracle) / oracle * 10_000 BPS
// confidence width = confidence / oracle * 10_000 BPS
// volume/liquidity = volume24hUsdc / tvlUsdc * 1_000_000 PPM
```

- [ ] **Step 3: Run task-scoped checks.**

**Validation commands:**

```bash
pnpm exec vitest run tests/domain/derived-feature/market.test.ts
pnpm exec eslint src/domain/derived-feature/market.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/market.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/derived-feature/market.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/market.test.ts
```

**Commit:** `feat: calculate oracle and pool market features`

## Repository Targets

### Expected Files

- src/domain/derived-feature/market.ts
- src/domain/derived-feature/index.ts
- tests/domain/derived-feature/market.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/domain/derived-feature/market.test.ts
pnpm exec eslint src/domain/derived-feature/market.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/market.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/derived-feature/market.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/market.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **canonical divergence inputs**: Divergence uses only eligible Pyth and Jupiter executable-quote prices within thirty seconds. (Test: `calculates absolute oracle DEX divergence only from Pyth and executable Jupiter quote`)
- **fatal divergence quality**: Missing route, stale input, and excessive skew return unavailable null with stable reasons. (Test: `makes divergence unavailable for missing route stale input or excessive skew`)
- **nonfatal divergence quality**: Wide confidence and nonfatal quote warnings retain a partial numeric divergence. (Test: `retains a partial divergence value for nonfatal input quality`)
- **oracle width quality**: Wide confidence remains a partial measurement while invalid status, price, or confidence is unavailable. (Test: `measures wide oracle confidence as partial rather than missing`)
- **volume denominator semantics**: Zero volume is valid only with positive TVL; missing or nonpositive TVL is unavailable. (Test: `accepts zero volume only with positive TVL`)
