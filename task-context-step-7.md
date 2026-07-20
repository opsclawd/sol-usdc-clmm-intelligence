# Task Context: Task 7

Title: Implement one-hour realized volatility

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

- Create: `src/domain/derived-feature/volatility.ts`
- Modify: `src/domain/derived-feature/index.ts`
- Create: `tests/domain/derived-feature/volatility.test.ts`

**Behavioral invariants (write these tests first):**

- `computes nonannualized one hour realized volatility from ordered log returns`: use `sqrt(sum(log(p[i]/p[i-1])^2)) * 10_000`, no mean subtraction or time scaling.
- `uses the inclusive one-hour window and deterministic duplicate winner`: `[anchor - 3_600_000, anchor]`, minimum 10 distinct samples, highest slot/receipt/ID per duplicate timestamp.
- `is unavailable below minimum coverage`: fewer than 10 samples or less than 45 minutes first-to-last returns exact coverage reason and null.
- `is unavailable when any adjacent gap exceeds ten minutes`: exactly 10 minutes passes; greater than 10 minutes fails.
- `is unavailable for nonpositive or nonfinite price math`: conversion/log failures never persist `NaN` or infinity.

- [ ] **Step 1: Add failing tests** using a hand-computed golden series plus inclusive boundary, insufficient count, insufficient span, exact/over maximum gap, duplicates, out-of-order input, and invalid prices.

- [ ] **Step 2: Implement the pure calculator.** Validate exact decimal strings as positive before converting to finite numbers for `Math.log`; round only the final nonnegative BPS result and record sample count, first/last timestamp, max gap, and discarded duplicate IDs.

```ts
export const REALIZED_VOLATILITY_1H_VERSION = "realized-volatility-1h/v1";
export const VOLATILITY_WINDOW_MS = 3_600_000;
export const VOLATILITY_MIN_SAMPLES = 10;
export const VOLATILITY_MIN_SPAN_MS = 2_700_000;
export const VOLATILITY_MAX_GAP_MS = 600_000;
```

- [ ] **Step 3: Run task-scoped checks.**

**Validation commands:**

```bash
pnpm exec vitest run tests/domain/derived-feature/volatility.test.ts
pnpm exec eslint src/domain/derived-feature/volatility.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/volatility.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/derived-feature/volatility.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/volatility.test.ts
```

**Commit:** `feat: calculate one hour realized volatility`

## Repository Targets

### Expected Files

- src/domain/derived-feature/volatility.ts
- src/domain/derived-feature/index.ts
- tests/domain/derived-feature/volatility.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/domain/derived-feature/volatility.test.ts
pnpm exec eslint src/domain/derived-feature/volatility.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/volatility.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/derived-feature/volatility.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/volatility.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **nonannualized log-return volatility**: The one-hour feature is sqrt of summed squared adjacent log returns, scaled to BPS without annualization or mean subtraction. (Test: `computes nonannualized one hour realized volatility from ordered log returns`)
- **window and duplicate policy**: The window is inclusive and duplicate timestamp winners follow slot, receipt, then ID. (Test: `uses the inclusive one-hour window and deterministic duplicate winner`)
- **minimum coverage**: At least ten distinct samples and forty-five minutes of span are required. (Test: `is unavailable below minimum coverage`)
- **maximum gap**: An adjacent gap of ten minutes passes while any larger gap is unavailable. (Test: `is unavailable when any adjacent gap exceeds ten minutes`)
- **finite positive prices**: Nonpositive prices or nonfinite log-return calculations return unavailable null. (Test: `is unavailable for nonpositive or nonfinite price math`)
