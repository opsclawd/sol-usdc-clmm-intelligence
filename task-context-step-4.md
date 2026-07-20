# Task Context: Task 4

Title: Assemble confidence freshness lineage and derivation identity

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

- Create: `src/domain/derived-feature/assemble.ts`
- Modify: `src/domain/derived-feature/index.ts`
- Create: `tests/helpers/derived-feature-fixtures.ts`
- Create: `tests/domain/derived-feature/assemble.test.ts`

**Behavioral invariants (write these tests first):**

- `derived confidence never exceeds the weakest selected input`: use component-wise minima, apply registry weights and partial factor, then cap the composite at the lowest input composite.
- `unavailable confidence has zero derivation confidence`: missing input produces low confidence with `required_component_missing` and never fabricates high confidence.
- `feature expiry is the minimum selected input expiry`: available/partial freshness uses the earliest input validity; unavailable expires at evaluation time.
- `lineage contains every outcome-determining selected or rejected row`: normalized refs are ID-sorted and raw/source refs are flattened, de-duplicated, and sorted.
- `derivation identity changes only when its canonical identity fields change`: schema/kind/scope/versions/selected IDs/outcome-determining rejected IDs/reasons determine `derivationKey`; complete result content separately determines `payloadHash`.

- [ ] **Step 1: Add failing fixture-driven tests** for confidence caps, partial degradation, missing-input confidence, expiry, empty/no-input provenance, rejected-row lineage, canonical sorting, and hash stability.

- [ ] **Step 2: Implement assembly helpers** that accept explicit `evaluationAsOfUnixMs`, `runId`, and `codeVersion`; never read a clock or environment directly.

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

export function assembleDerivedFeature(input: AssembleFeatureInput): AssembledFeature;
```

Use the existing canonical content hashing utility, explicit process ref `{ collector: "deterministic-feature-derivation", jobName: "derive-mvp-features", pipelineRunId, codeVersion, modelVersion: null }`, and status-aware provenance checks before returning.

- [ ] **Step 3: Export assembly types/functions and run focused checks.**

**Validation commands:**

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

- **weakest-input confidence cap**: A feature composite cannot exceed the lowest selected input composite after policy and partial degradation. (Test: `derived confidence never exceeds the weakest selected input`)
- **unavailable confidence**: Unavailable results use zero derivation confidence, low level, and a required-component reason. (Test: `unavailable confidence has zero derivation confidence`)
- **minimum expiry**: Available and partial expiry is the earliest selected validity while unavailable expiry is evaluation time. (Test: `feature expiry is the minimum selected input expiry`)
- **complete outcome lineage**: Every selected or outcome-determining rejected normalized row contributes sorted normalized, raw, and source lineage. (Test: `lineage contains every outcome-determining selected or rejected row`)
- **canonical derivation identity**: Only the documented identity fields affect derivationKey while complete result content affects payloadHash. (Test: `derivation identity changes only when its canonical identity fields change`)
