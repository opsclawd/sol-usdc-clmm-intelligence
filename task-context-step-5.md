# Task Context: Task 5

Title: Implement the three position-range calculators

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-8
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-8
Start Commit: 5701491d28b2b8489db6ce45b5b24d87d3570a52

## Task Requirements

**Files:** Create `src/domain/derived-feature/range.ts` and `tests/domain/derived-feature/range.test.ts`; modify `src/domain/derived-feature/index.ts`.

**Behavioral invariants to test first**

- `classifies and clamps range location without hiding market state`
- `preserves signed distance outside the position range`
- `rejects invalid prices ranges and contradictory range state`
- `applies nearest integer ties away from zero after the full formula`

- [ ] Write failing tests for below/in/above range, boundaries, signed distances, rounding ties, zero width, malformed/nonpositive prices, and contradictory source classification.
- [ ] Implement pure calculators against `PositionStatePayloadV1`:

```ts
// location = clamp((current-lower)/(upper-lower), 0, 1) * 1_000_000 PPM
// lower distance = ((current-lower)/current) * 10_000 BPS
// upper distance = ((upper-current)/current) * 10_000 BPS
export function calculateRangeLocation(position: PositionStatePayloadV1): FeatureCalculation;
export function calculateDistanceToLower(position: PositionStatePayloadV1): FeatureCalculation;
export function calculateDistanceToUpper(position: PositionStatePayloadV1): FeatureCalculation;
```

Emit one classification metadata value; invalid inputs return `UNAVAILABLE`, null, and stable reasons.

- [ ] Run:

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

- **range classification and clamp**: Location clamps to zero or one million PPM while retaining the true classification. (Test: `classifies and clamps range location without hiding market state`)
- **signed range distance**: Distance remains negative outside the corresponding boundary. (Test: `preserves signed distance outside the position range`)
- **invalid range rejection**: Invalid prices, widths, labels, or contradictory state return unavailable null. (Test: `rejects invalid prices ranges and contradictory range state`)
- **range rounding**: All three formulas round exact ties away from zero after complete evaluation. (Test: `applies nearest integer ties away from zero after the full formula`)
