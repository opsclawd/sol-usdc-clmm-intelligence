# Task Context: Task 4

Title: Assemble confidence freshness lineage and derivation identity

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-8
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-8
Start Commit: 5701491d28b2b8489db6ce45b5b24d87d3570a52

## Task Requirements

**Files:** Create `src/domain/derived-feature/assemble.ts`, `tests/helpers/derived-feature-fixtures.ts`, and `tests/domain/derived-feature/assemble.test.ts`; modify `src/domain/derived-feature/index.ts`.

**Behavioral invariants to test first**

- `derived confidence never exceeds the weakest selected input`
- `unavailable confidence has zero derivation confidence`
- `feature expiry is the minimum selected input expiry`
- `lineage contains every outcome-determining selected or rejected row`
- `derivation identity changes only when its canonical identity fields change`

- [ ] Add failing fixture-driven tests for component minima, partial degradation, unavailable confidence, expiry, empty provenance, rejected-row lineage, sorting, and hash stability.
- [ ] Implement:

```ts
export interface FeatureCalculation {
  readonly status: FeatureStatus;
  readonly value: number | null;
  readonly warnings: readonly string[];
  readonly reasons: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
}
export interface AssembledFeature {
  readonly result: DerivedFeatureV1;
  readonly derivationKey: string;
  readonly payloadHash: string;
}
export async function assembleDerivedFeature(
  input: AssembleFeatureInput
): Promise<AssembledFeature>;
```

Accept explicit evaluation time/run/code versions; compute component-wise minima, cap the composite at the weakest selected input, expire at the earliest input validity, include all outcome-determining lineage, and hash canonical identity separately from complete payload content.

- [ ] Run:

```bash
pnpm exec vitest run tests/domain/derived-feature/assemble.test.ts
pnpm exec eslint src/domain/derived-feature/assemble.ts src/domain/derived-feature/index.ts tests/helpers/derived-feature-fixtures.ts tests/domain/derived-feature/assemble.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/derived-feature/assemble.ts src/domain/derived-feature/index.ts tests/helpers/derived-feature-fixtures.ts tests/domain/derived-feature/assemble.test.ts
```

**Commit:** `feat: assemble auditable feature envelopes`

## Repository Targets

### Expected Files

- src/domain/derived-feature/assemble.ts
- src/domain/derived-feature/index.ts
- tests/helpers/derived-feature-fixtures.ts
- tests/domain/derived-feature/assemble.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/domain/derived-feature/assemble.test.ts
pnpm exec eslint src/domain/derived-feature/assemble.ts src/domain/derived-feature/index.ts tests/helpers/derived-feature-fixtures.ts tests/domain/derived-feature/assemble.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/derived-feature/assemble.ts src/domain/derived-feature/index.ts tests/helpers/derived-feature-fixtures.ts tests/domain/derived-feature/assemble.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **weakest-input confidence cap**: Derived component and composite confidence cannot exceed the weakest selected input. (Test: `derived confidence never exceeds the weakest selected input`)
- **unavailable confidence**: Missing required input forces zero derivation confidence and a stable reason. (Test: `unavailable confidence has zero derivation confidence`)
- **minimum expiry**: Feature expiry is the earliest selected input expiry, or evaluation time when unavailable. (Test: `feature expiry is the minimum selected input expiry`)
- **complete lineage**: All selected and outcome-determining rejected observations appear in canonical lineage. (Test: `lineage contains every outcome-determining selected or rejected row`)
- **canonical derivation identity**: Only canonical scope, version, input, rejection, and reason fields change derivation identity. (Test: `derivation identity changes only when its canonical identity fields change`)
