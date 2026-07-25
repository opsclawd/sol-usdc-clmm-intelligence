# Task Context: Task 6

Title: Implement oracle and pool market calculators

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-8
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-8
Start Commit: 5701491d28b2b8489db6ce45b5b24d87d3570a52

## Task Requirements

**Files:** Create `src/domain/derived-feature/market.ts` and `tests/domain/derived-feature/market.test.ts`; modify `src/domain/derived-feature/index.ts`.

**Behavioral invariants to test first**

- `calculates absolute oracle DEX divergence only from Pyth and executable Jupiter quote`
- `makes divergence unavailable for missing route stale input or excessive skew`
- `retains a partial divergence value for nonfatal input quality`
- `measures wide oracle confidence as partial rather than missing`
- `accepts zero volume only with positive TVL`

- [ ] Write failing golden tests for all three formulas, ties, stale/missing inputs, route availability, 30-second skew, wide confidence, zero volume, and invalid TVL.
- [ ] Implement:

```ts
// abs(dex-oracle)/oracle * 10_000 BPS
export function calculateOracleDexDivergence(
  oracle: OraclePricePayloadV1,
  quote: DexQuotePayloadV1
): FeatureCalculation;
// confidence/oracle * 10_000 BPS
export function calculateOracleConfidenceWidth(oracle: OraclePricePayloadV1): FeatureCalculation;
// volume24hUsdc/tvlUsdc * 1_000_000 PPM
export function calculateVolumeLiquidityRatio24h(pool: PoolStatisticsPayloadV1): FeatureCalculation;
```

Never substitute pool price for Jupiter; preserve numeric values as `PARTIAL` for nonfatal quality warnings, and use null `UNAVAILABLE` results for missing/invalid operands.

- [ ] Run:

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

- **source-specific divergence**: Divergence uses only Pyth oracle and executable Jupiter quote within allowed skew. (Test: `calculates absolute oracle DEX divergence only from Pyth and executable Jupiter quote`)
- **fatal divergence quality**: Missing route, stale input, or excessive skew yields unavailable null. (Test: `makes divergence unavailable for missing route stale input or excessive skew`)
- **nonfatal divergence quality**: Nonfatal warnings retain a numeric partial result. (Test: `retains a partial divergence value for nonfatal input quality`)
- **oracle width status**: Wide valid confidence is partial while invalid oracle operands are unavailable. (Test: `measures wide oracle confidence as partial rather than missing`)
- **zero volume semantics**: Zero volume is available only when TVL is positive. (Test: `accepts zero volume only with positive TVL`)
