# Task Context: Task 5

Title: Implement the three position-range calculators

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

- Create: `src/domain/derived-feature/range.ts`
- Modify: `src/domain/derived-feature/index.ts`
- Create: `tests/domain/derived-feature/range.test.ts`

**Behavioral invariants (write these tests first):**

- `classifies and clamps range location without hiding market state`: below is `0 PPM`, in-range is exact, above is `1_000_000 PPM`, with boundary/classification metadata.
- `preserves signed distance outside the position range`: distance-to-lower is negative below lower; distance-to-upper is negative above upper.
- `rejects invalid prices ranges and contradictory range state`: nonpositive prices, `upper <= lower`, malformed labels, or source `rangeState` disagreement produce `UNAVAILABLE` and `null`.
- `applies nearest integer ties away from zero after the full formula`: all three golden fixtures have exact integer BPS/PPM values.

- [ ] **Step 1: Add failing golden tests** for below/in/above, exact boundaries, signed distances, decimal rounding ties, zero-width range, malformed/nonpositive prices, and contradictory source classification.

- [ ] **Step 2: Implement the pure calculators** against `PositionStatePayloadV1`, returning `FeatureCalculation` and the fixed versions below.

```ts
export const RANGE_CALCULATOR_VERSIONS = {
  range_location: "range-location/v1",
  distance_to_lower: "distance-to-lower/v1",
  distance_to_upper: "distance-to-upper/v1"
} as const;

// location = clamp((current - lower) / (upper - lower), 0, 1) * 1_000_000
// lower distance = ((current - lower) / current) * 10_000
// upper distance = ((upper - current) / current) * 10_000
```

Emit exactly one classification value among `below_range_clamped`, `in_range`, `above_range_clamped`, `at_lower_boundary`, and `at_upper_boundary`; boundary clamping remains `AVAILABLE` when all inputs are sound.

- [ ] **Step 3: Run task-scoped checks.**

**Validation commands:**

```bash
pnpm exec vitest run tests/domain/derived-feature/range.test.ts
pnpm exec eslint src/domain/derived-feature/range.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/range.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/derived-feature/range.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/range.test.ts
```

**Commit:** `feat: calculate position range features`

## Repository Targets

### Expected Files

- src/domain/derived-feature/range.ts
- src/domain/derived-feature/index.ts
- tests/domain/derived-feature/range.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/domain/derived-feature/range.test.ts
pnpm exec eslint src/domain/derived-feature/range.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/range.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/derived-feature/range.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/range.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **range clamp classification**: Location clamps to zero or one million PPM while metadata distinguishes below, in, above, and exact boundaries. (Test: `classifies and clamps range location without hiding market state`)
- **signed distances**: Boundary distance remains signed outside the range and is never clamped. (Test: `preserves signed distance outside the position range`)
- **invalid range unavailable**: Malformed/nonpositive prices, invalid range width, and contradictory rangeState return unavailable null. (Test: `rejects invalid prices ranges and contradictory range state`)
- **range rounding**: All range metrics apply nearest integer ties-away-from-zero after the complete formula. (Test: `applies nearest integer ties away from zero after the full formula`)
