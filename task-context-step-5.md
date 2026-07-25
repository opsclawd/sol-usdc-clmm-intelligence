# Task Context: Task 5

Title: Derive deterministic perp stress features

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

- Create: `src/domain/perp-liquidation/derive.ts`
- Modify: `src/domain/perp-liquidation/index.ts`
- Create: `tests/domain/perp-liquidation/derive.test.ts`

- [ ] **Step 1: Write failing feature tests first**

  Add named cases for rising and falling OI, zero OI baseline, positive and negative funding, positive and negative basis, mixed long/short liquidations, stale inputs, duplicate IDs, missing denominator, and cross-venue isolation. Required names:
  - `derives positive BPS for rising OI and negative BPS for falling OI`;
  - `marks OI trend unavailable when fewer than two usable samples exist`;
  - `marks liquidation cluster unavailable when no same-venue positive OI denominator exists`;
  - `does not interpret unavailable liquidation coverage as a zero liquidation cluster`;
  - `links every available feature to its selected normalized and raw observation ids`.

- [ ] **Step 2: Verify derivation tests fail**

  Run: `pnpm vitest run tests/domain/perp-liquidation/derive.test.ts`

  Expected: FAIL because the derivation functions do not exist.

- [ ] **Step 3: Implement safe decimal arithmetic and formulas**

  Reuse the repository’s integer/decimal conventions; do not derive with binary floating-point intermediate values. Round once at the output boundary:

  ```ts
  oiTrendBps = roundHalfAwayFromZero(((latestOi - earliestOi) * 10_000) / abs(earliestOi));

  annualizedFundingBps = roundHalfAwayFromZero(
    fundingRate * (24 / fundingIntervalHours) * 365 * 10_000
  );

  basisSpreadBps = roundHalfAwayFromZero(((perpPrice - spotPrice) * 10_000) / spotPrice);

  liquidationClusterBps = roundHalfAwayFromZero(
    (sumLiquidationNotional1h * 10_000) / latestSameVenueOiNotional
  );
  ```

  Require a non-zero/positive denominator as applicable and safe-integer BPS output.

- [ ] **Step 4: Implement selection, status, confidence, and lineage**

  Export one orchestration function, `derivePerpLiquidationFeatures`, which accepts normalized candidates, source coverage, evaluation time, run/code versions, and returns four `DerivedFeatureInsert` values.

  Sort observations by `observedAtUnixMs`, then ID. Use samples in `[asOf - window, asOf]`; choose earliest/latest OI in the four-hour window; sum unique liquidation event IDs in the one-hour window. An available feature uses `AVAILABLE`; usable but stale/incomplete input uses `PARTIAL`, lowers confidence, and records sorted `stale_input_degraded`; insufficient evidence uses `UNAVAILABLE` with a specific reason and no fabricated zero. Produce deterministic derivation keys from feature kind, as-of time, venue set, selected IDs, calculator version, and selection version.

- [ ] **Step 5: Run focused tests and lint**

  Run: `pnpm vitest run tests/domain/perp-liquidation/derive.test.ts`

  Expected: PASS.

  Run: `pnpm exec eslint src/domain/perp-liquidation/derive.ts src/domain/perp-liquidation/index.ts tests/domain/perp-liquidation/derive.test.ts`

  Expected: exit 0.

- [ ] **Step 6: Commit**

  ```bash
  git add src/domain/perp-liquidation/derive.ts src/domain/perp-liquidation/index.ts tests/domain/perp-liquidation/derive.test.ts
  git commit -m "feat: derive perp crowding and liquidation features"
  ```

## Repository Targets

### Expected Files

- src/domain/perp-liquidation/derive.ts
- src/domain/perp-liquidation/index.ts
- tests/domain/perp-liquidation/derive.test.ts

## Validation Commands

```bash
pnpm vitest run tests/domain/perp-liquidation/derive.test.ts
pnpm exec eslint src/domain/perp-liquidation/derive.ts src/domain/perp-liquidation/index.ts tests/domain/perp-liquidation/derive.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **OI direction**: Latest OI above the earliest sample yields positive BPS and latest OI below it yields negative BPS. (Test: `derives positive BPS for rising OI and negative BPS for falling OI`)
- **signed funding annualization**: Annualization preserves positive and negative funding direction while scaling by the declared funding interval. (Test: `preserves positive and negative funding rates through normalization and annualization`)
- **OI sample sufficiency**: Fewer than two usable OI samples cannot produce an available trend. (Test: `marks OI trend unavailable when fewer than two usable samples exist`)
- **liquidation denominator**: Liquidation intensity requires a positive OI denominator from the same venue. (Test: `marks liquidation cluster unavailable when no same-venue positive OI denominator exists`)
- **unavailable coverage is not zero**: Unavailable liquidation coverage produces UNAVAILABLE with a reason rather than a zero-valued cluster. (Test: `does not interpret unavailable liquidation coverage as a zero liquidation cluster`)
- **feature lineage**: Every available or partial feature references the selected normalized and raw observation IDs. (Test: `links every available feature to its selected normalized and raw observation ids`)
