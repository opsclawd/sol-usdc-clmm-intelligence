# Task Context: Task 5

Title: Verify feature lineage and requested wallet scope

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

- Create: `src/domain/evidence-bundle/lineage.ts`
- Modify: `src/domain/evidence-bundle/index.ts`
- Create: `tests/domain/evidence-bundle/lineage.test.ts`

**Behavioral invariants (write these exact tests first):**

- `accepts complete raw normalized and derived lineage for the requested context`: every selected feature reference resolves and the clmm-v2 raw bundle proves the requested pair, wallet, position, and pool relationship.
- `rejects a missing normalized reference`: a referenced normalized ID absent from the bulk result is a hard typed failure, not degraded coverage.
- `rejects a missing raw parent`: every resolved normalized row must have its exact raw parent.
- `rejects provenance id source or payload hash mismatches`: persisted row fields must match the corresponding feature provenance reference exactly.
- `rejects wallet position pool or pair contradictions`: a lineage-linked clmm-v2 payload that does not contain the requested relationship fails before assembly.
- `rejects invalid clmm-v2 canonical payload`: raw canonical text must parse as JSON and pass the existing `validateClmmBundle` contract before identity checks.
- `combines pair pool and position lineage in stable order`: duplicate raw, normalized, derived, and source refs collapse by canonical identity and sort according to the pinned bundle contract.
- `does not require numeric lineage for an explicit no-input unavailable slot`: a selected unavailable feature with contract-valid no-input provenance remains auditable through its reason codes.

- [ ] **Step 1: Create fixture-driven failing tests** using real `DerivedFeatureRow`, `NormalizedObservationRow`, and `RawObservationRow` shapes. Assert typed failure codes rather than incidental error prose.
- [ ] **Step 2: Implement `verifyEvidenceLineage`.** Accept the request, seven slots, and already-loaded rows; perform no I/O. Reuse the existing clmm-v2 validator, compare every provenance reference, and return the exact stable lineage/source-ref input required by the pinned contract.

```ts
export function verifyEvidenceLineage(input: VerifyEvidenceLineageInput): VerifiedEvidenceLineage;
```

- [ ] **Step 3: Run focused checks.** Expected: contradictory or incomplete lineage never produces a verified result.

**Validation commands:**

```bash
pnpm exec vitest run tests/domain/evidence-bundle/lineage.test.ts
pnpm exec eslint src/domain/evidence-bundle/lineage.ts src/domain/evidence-bundle/index.ts tests/domain/evidence-bundle/lineage.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/evidence-bundle/lineage.ts src/domain/evidence-bundle/index.ts tests/domain/evidence-bundle/lineage.test.ts
```

**Commit:** `feat: verify evidence bundle lineage`

## Repository Targets

### Expected Files

- src/domain/evidence-bundle/lineage.ts
- src/domain/evidence-bundle/index.ts
- tests/domain/evidence-bundle/lineage.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/domain/evidence-bundle/lineage.test.ts
pnpm exec eslint src/domain/evidence-bundle/lineage.ts src/domain/evidence-bundle/index.ts tests/domain/evidence-bundle/lineage.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/evidence-bundle/lineage.ts src/domain/evidence-bundle/index.ts tests/domain/evidence-bundle/lineage.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **complete lineage**: Every selected feature reference resolves through normalized rows to raw rows proving the requested context. (Test: `accepts complete raw normalized and derived lineage for the requested context`)
- **missing normalized lineage**: A missing referenced normalized observation is a hard lineage failure. (Test: `rejects a missing normalized reference`)
- **missing raw lineage**: A missing raw parent for a resolved normalized observation is a hard lineage failure. (Test: `rejects a missing raw parent`)
- **provenance equality**: Reference ID, source, and payload hash must equal the persisted row fields. (Test: `rejects provenance id source or payload hash mismatches`)
- **requested scope proof**: The lineage-linked clmm-v2 payload must prove the requested wallet, position, pool, and pair relationship. (Test: `rejects wallet position pool or pair contradictions`)
- **raw bundle validity**: Raw canonical text must parse and pass the existing clmm-v2 bundle validator. (Test: `rejects invalid clmm-v2 canonical payload`)
- **stable lineage aggregation**: Pair-, pool-, and position-scoped references are de-duplicated and canonically ordered. (Test: `combines pair pool and position lineage in stable order`)
- **unavailable no-input lineage**: A contract-valid unavailable feature with no inputs remains represented by its explicit reasons. (Test: `does not require numeric lineage for an explicit no-input unavailable slot`)
