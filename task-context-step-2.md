# Task Context: Task 2

Title: Add exact decimal and rational arithmetic

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-8
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-8
Start Commit: 5701491d28b2b8489db6ce45b5b24d87d3570a52

## Task Requirements

**Files:** Create `src/domain/derived-feature/decimal.ts`, `src/domain/derived-feature/index.ts`, and `tests/domain/derived-feature/decimal.test.ts`.

**Behavioral invariants to test first**

- `parses plain signed decimals without binary floating-point conversion`
- `rejects empty exponent and non-finite decimal syntax`
- `rounds rational ties away from zero`
- `rejects zero divisors and unsafe integer outputs`
- `rounds only after the complete scaled formula`

- [ ] Write failing tests for signs/scales, invalid syntax, ties, zero divisor, overflow, and golden BPS/PPM boundaries.
- [ ] Implement exact `bigint` rational math:

```ts
export interface Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}
export type NumericFailure = "invalid_decimal" | "division_by_zero" | "numeric_overflow";
export function parseDecimal(value: string): Rational | NumericFailure;
export function subtract(left: Rational, right: Rational): Rational;
export function multiply(left: Rational, right: Rational): Rational;
export function divide(left: Rational, right: Rational): Rational | NumericFailure;
export function compare(left: Rational, right: Rational): -1 | 0 | 1;
export function roundToSafeInteger(value: Rational): number | NumericFailure;
```

Normalize signs/denominators, never parse through `number`, and round nearest with exact halves away from zero.

- [ ] Export the helpers and run:

```bash
pnpm exec vitest run tests/domain/derived-feature/decimal.test.ts
pnpm exec eslint src/domain/derived-feature/decimal.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/decimal.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/derived-feature/decimal.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/decimal.test.ts
```

**Commit:** `feat: add exact feature arithmetic`

## Repository Targets

### Expected Files

- src/domain/derived-feature/decimal.ts
- src/domain/derived-feature/index.ts
- tests/domain/derived-feature/decimal.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/domain/derived-feature/decimal.test.ts
pnpm exec eslint src/domain/derived-feature/decimal.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/decimal.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/derived-feature/decimal.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/decimal.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **exact decimal parsing**: Plain signed decimals become exact bigint rationals without binary floating-point conversion. (Test: `parses plain signed decimals without binary floating-point conversion`)
- **invalid numeric syntax**: Exponent and non-finite syntax is rejected. (Test: `rejects empty exponent and non-finite decimal syntax`)
- **tie rounding**: Exact half values round away from zero. (Test: `rounds rational ties away from zero`)
- **numeric safety**: Zero division and unsafe integer conversion return typed failures. (Test: `rejects zero divisors and unsafe integer outputs`)
- **single final rounding**: Scaled formulas round only after all exact rational operations. (Test: `rounds only after the complete scaled formula`)
