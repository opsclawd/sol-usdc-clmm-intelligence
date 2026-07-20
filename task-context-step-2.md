# Task Context: Task 2

Title: Add exact decimal and rational arithmetic

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

- Create: `src/domain/derived-feature/decimal.ts`
- Create: `src/domain/derived-feature/index.ts`
- Create: `tests/domain/derived-feature/decimal.test.ts`

**Behavioral invariants (write these tests first):**

- `parses plain signed decimals without binary floating-point conversion`: accept integer/fractional forms and normalize trailing zeroes using `bigint` coefficient/scale.
- `rejects empty exponent and non-finite decimal syntax`: reject whitespace-only, exponent notation, `NaN`, and infinities.
- `rounds rational ties away from zero`: `1/2` becomes `1`, `-1/2` becomes `-1`, and non-ties round to the nearest integer.
- `rejects zero divisors and unsafe integer outputs`: division by zero and results outside `Number.MIN_SAFE_INTEGER..Number.MAX_SAFE_INTEGER` return typed numeric failure codes.
- `rounds only after the complete scaled formula`: golden BPS/PPM cases near half-way boundaries match exact rational expectations.

- [ ] **Step 1: Write the failing arithmetic tests**, including positive/negative signs, different scales, tie cases, zero divisor, and safe-integer overflow.

- [ ] **Step 2: Implement a pure rational representation and operations.** Do not reuse `src/domain/price-observation/decimal.ts`, which is a looser normalizer; use exact `bigint` math.

```ts
export interface Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export type NumericFailure = "invalid_decimal" | "division_by_zero" | "numeric_overflow";

export function parseDecimal(value: string): Rational;
export function subtract(left: Rational, right: Rational): Rational;
export function multiply(left: Rational, right: Rational): Rational;
export function divide(left: Rational, right: Rational): Rational;
export function compare(left: Rational, right: Rational): -1 | 0 | 1;
export function roundToSafeInteger(value: Rational): number;
```

- [ ] **Step 3: Export the helpers from the feature-domain barrel** and run the focused checks.

**Validation commands:**

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
- **strict decimal syntax**: Empty, exponent, NaN, and infinite syntax is rejected. (Test: `rejects empty exponent and non-finite decimal syntax`)
- **ties away from zero**: Half-way rationals round to the nearest integer away from zero. (Test: `rounds rational ties away from zero`)
- **safe numeric output**: Zero divisors and values outside the JavaScript safe-integer range fail explicitly. (Test: `rejects zero divisors and unsafe integer outputs`)
- **single final rounding**: Scaling formulas round only after all rational operations are complete. (Test: `rounds only after the complete scaled formula`)
