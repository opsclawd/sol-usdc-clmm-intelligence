# Task Context: Task 7

Title: Implement one-hour realized volatility

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-8
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-8
Start Commit: 5701491d28b2b8489db6ce45b5b24d87d3570a52

## Task Requirements

**Files:** Create `src/domain/derived-feature/volatility.ts` and `tests/domain/derived-feature/volatility.test.ts`; modify `src/domain/derived-feature/index.ts`.

**Behavioral invariants to test first**

- `computes nonannualized one hour realized volatility from ordered log returns`
- `uses the inclusive one-hour window and deterministic duplicate winner`
- `is unavailable below minimum coverage`
- `is unavailable when any adjacent gap exceeds ten minutes`
- `is unavailable for nonpositive or nonfinite price math`

- [ ] Write failing tests using a hand-computed series plus inclusive boundaries, fewer than 10 samples, under 45-minute span, exact/over 10-minute gaps, duplicates, out-of-order input, and invalid prices.
- [ ] Implement `sqrt(sum(log(p[i]/p[i-1])^2)) * 10_000`, rounded once at the end, with:

```ts
export const VOLATILITY_WINDOW_MS = 3_600_000;
export const VOLATILITY_MIN_SAMPLES = 10;
export const VOLATILITY_MIN_SPAN_MS = 2_700_000;
export const VOLATILITY_MAX_GAP_MS = 600_000;
export function calculateRealizedVolatility1h(
  observations: readonly PriceObservation[]
): FeatureCalculation;
```

Validate exact decimal strings as positive before finite-number log conversion and record coverage/duplicate metadata.

- [ ] Run:

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

- **volatility formula**: The result is the square root of summed squared adjacent log returns, scaled to BPS. (Test: `computes nonannualized one hour realized volatility from ordered log returns`)
- **inclusive window**: The one-hour window is inclusive and duplicate timestamps have a deterministic winner. (Test: `uses the inclusive one-hour window and deterministic duplicate winner`)
- **minimum coverage**: At least ten samples spanning at least 45 minutes are required. (Test: `is unavailable below minimum coverage`)
- **maximum gap**: Adjacent gaps over ten minutes make the result unavailable. (Test: `is unavailable when any adjacent gap exceeds ten minutes`)
- **finite positive prices**: Nonpositive or nonfinite price math never emits a numeric feature. (Test: `is unavailable for nonpositive or nonfinite price math`)
