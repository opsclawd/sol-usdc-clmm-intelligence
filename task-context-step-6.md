# Task Context: Task 6

Title: Compute quality and assemble the canonical contract candidate

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-26
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-26
Start Commit: 01ac2b377c06f834207d0e8cbb30e51ebf1e1e1e

## Task Requirements

**Files:**

- Create: `src/domain/evidence-bundle/quality.ts`
- Create: `src/domain/evidence-bundle/assemble.ts`
- Modify: `src/domain/evidence-bundle/index.ts`
- Create: `tests/domain/evidence-bundle/quality.test.ts`
- Create: `tests/domain/evidence-bundle/assemble.test.ts`

**Behavioral invariants (write these exact tests first):**

- `classifies all seven fresh available slots as complete deterministic coverage`: deterministic coverage is complete, while overall coverage still records absent context and absent research brief exactly as the schema requires.
- `classifies one or multiple missing slots as partial without zero values`: missing slots carry canonical absence plus stable warnings.
- `classifies partial unavailable expired and unsupported slots distinctly`: each state contributes the upstream-mandated quality facts and warning codes.
- `refuses a zero-usable-feature bundle unless the pinned contract explicitly requires it`: the fail-closed result contains no candidate for persistence.
- `keeps bundle confidence monotonic with its usable evidence`: any aggregate required by the contract is reproducible and never exceeds the weakest summarized evidence under the pinned formula.
- `derives timestamps deterministically`: `asOf`, creation, and expiry follow the exact pinned rules, with creation supplied by immutable run context rather than an ambient clock.
- `normalizes warnings and references before mapping`: input permutations produce structurally identical candidates.
- `maps deterministic-only context and brief absence exactly`: contextual collections/sections and `researchBrief` use only the schema-authorized empty/unavailable/null representation.
- `maps exactly seven feature summaries in canonical order`: selected values, units, status, freshness, confidence, feature IDs, versions, and reasons use upstream field names without extra local fields.
- `does not include payload hash recursively unless the contract requires an envelope`: the candidate matches pinned valid fixtures before hashing.

- [ ] **Step 1: Add failing quality tests.** Encode the exact quality/coverage formula, warning vocabulary, timestamp boundary, confidence rounding, and zero-usable posture obtained from the pinned contract; do not create an intelligence-local score.
- [ ] **Step 2: Implement `classifyEvidenceBundleQuality`.** Make the rule version explicit and return only facts/fields defined by the generated contract.
- [ ] **Step 3: Add failing assembler tests.** Compare complete, missing, partial, unavailable, expired, empty-context, absent-brief, reordered-input, and zero-value cases to pinned or locally composed schema-valid fixtures.
- [ ] **Step 4: Implement `assembleEvidenceBundleCandidate`.** Accept only the validated request, seven selected slots, quality result, and verified lineage. Return `EvidenceBundleV1`-compatible data, but leave schema validation, canonicalization, hashing, and idempotency derivation to `EvidenceBundleContract`.

```ts
export function classifyEvidenceBundleQuality(input: EvidenceQualityInput): EvidenceBundleQuality;
export function assembleEvidenceBundleCandidate(
  input: AssembleEvidenceBundleInput
): EvidenceBundleV1;
```

- [ ] **Step 5: Run focused checks.** Expected: candidate structures validate in Task 1's contract tests and all permutations remain stable.

**Validation commands:**

```bash
pnpm exec vitest run tests/domain/evidence-bundle/quality.test.ts tests/domain/evidence-bundle/assemble.test.ts
pnpm exec eslint src/domain/evidence-bundle/quality.ts src/domain/evidence-bundle/assemble.ts src/domain/evidence-bundle/index.ts tests/domain/evidence-bundle/quality.test.ts tests/domain/evidence-bundle/assemble.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/evidence-bundle/quality.ts src/domain/evidence-bundle/assemble.ts src/domain/evidence-bundle/index.ts tests/domain/evidence-bundle/quality.test.ts tests/domain/evidence-bundle/assemble.test.ts
```

**Commit:** `feat: assemble deterministic evidence bundle candidate`

## Repository Targets

### Expected Files

- src/domain/evidence-bundle/quality.ts
- src/domain/evidence-bundle/assemble.ts
- src/domain/evidence-bundle/index.ts
- tests/domain/evidence-bundle/quality.test.ts
- tests/domain/evidence-bundle/assemble.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/domain/evidence-bundle/quality.test.ts tests/domain/evidence-bundle/assemble.test.ts
pnpm exec eslint src/domain/evidence-bundle/quality.ts src/domain/evidence-bundle/assemble.ts src/domain/evidence-bundle/index.ts tests/domain/evidence-bundle/quality.test.ts tests/domain/evidence-bundle/assemble.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/evidence-bundle/quality.ts src/domain/evidence-bundle/assemble.ts src/domain/evidence-bundle/index.ts tests/domain/evidence-bundle/quality.test.ts tests/domain/evidence-bundle/assemble.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **complete deterministic coverage**: Seven fresh available slots are complete deterministic coverage while context and brief remain explicitly absent overall. (Test: `classifies all seven fresh available slots as complete deterministic coverage`)
- **missing feature degradation**: One or more missing slots produce partial coverage and no numeric substitution. (Test: `classifies one or multiple missing slots as partial without zero values`)
- **distinct degraded states**: Partial, unavailable, expired, and unsupported outcomes retain distinct canonical quality facts. (Test: `classifies partial unavailable expired and unsupported slots distinctly`)
- **zero usable fail closed**: No candidate is produced when no feature is usable unless the pinned contract explicitly mandates persistence. (Test: `refuses a zero-usable-feature bundle unless the pinned contract explicitly requires it`)
- **confidence monotonicity**: Any contract-required aggregate confidence is reproducible and cannot exceed summarized evidence under the pinned formula. (Test: `keeps bundle confidence monotonic with its usable evidence`)
- **deterministic timestamps**: As-of, creation, and expiry are derived solely from explicit run context and selected evidence under pinned rules. (Test: `derives timestamps deterministically`)
- **canonical input ordering**: Warnings and references are normalized so input permutations map to identical candidates. (Test: `normalizes warnings and references before mapping`)
- **canonical optional absence**: Context and brief absence use only representations authorized by the pinned schema. (Test: `maps deterministic-only context and brief absence exactly`)
- **canonical feature summaries**: Exactly seven summaries map in canonical order with no local-only fields. (Test: `maps exactly seven feature summaries in canonical order`)
- **non-recursive hash material**: The candidate excludes its own payload hash unless the upstream contract defines a non-recursive envelope. (Test: `does not include payload hash recursively unless the contract requires an envelope`)
