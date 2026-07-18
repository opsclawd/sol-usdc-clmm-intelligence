# Task Context: Task 4

Title: Register and enrich all normalized CLMM facts

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-22
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-22
Start Commit: 354e656925912cc7e58de7220277b1694b69286d

## Task Requirements

**Files:**

- Modify: `src/contracts/taxonomy.ts`
- Modify: `src/contracts/normalized-clmm-observation.ts`
- Modify: `src/domain/taxonomy/registry.ts`
- Modify: `src/domain/taxonomy/validation.ts`
- Modify: `src/domain/taxonomy/index.ts`
- Create: `src/domain/clmm-bundle/enrich.ts`
- Modify: `src/domain/clmm-bundle/index.ts`
- Modify: `tests/domain/taxonomy/registry.test.ts`
- Modify: `tests/domain/taxonomy/validation.test.ts`
- Create: `tests/domain/clmm-bundle/enrich.test.ts`

**Behavioral invariants to test first:**

- `trigger_event and data_quality are deterministic execution_safety kinds with 60-second exclude-on-stale policies` keeps qualification records from outliving state.
- `enrichment derives family class and freshness exclusively from the registry entry` prevents adapter/application hard-coding.
- `completeness counts zero false and empty arrays as present and null as absent under weighting version clmm-bundle-completeness-v1` fixes score semantics.
- `direct facts use reliability 1 derivation 1 llm null and validated direct raw provenance` separates deterministic mapping from availability.
- `future or out-of-order timestamps fail before persistence` makes the raw row replayable instead of publishing invalid time metadata.

- [ ] **Step 1: Add failing taxonomy and enrichment tests.** Extend the explicit `ObservationKind[]` test list with `trigger_event` and `data_quality`; add exact policy assertions rather than only generic registry-shape assertions.
- [ ] **Step 2: Run `pnpm vitest run tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts tests/domain/clmm-bundle/enrich.test.ts` and confirm the new kinds/helpers fail.**
- [ ] **Step 3: Add the two source-independent observation kinds to the contract union, parser set, and registry.** Both use `execution_safety`, `deterministic`, `clmm-v2-bundle`, 60,000 ms max age, 5,000 ms skew, `exclude`, schema version 1, and the same direct-provenance/confidence policy shape as pool/position state.
- [ ] **Step 4: Add a contract-owned `EnrichedClmmObservation` shape, then implement exported versioned completeness field lists and `enrichClmmCandidates(input)` using `getObservationKindEntry`, `canonicalizePayload`, `computeFreshness`, `computeConfidence`, and `validateProvenance`.** Input supplies plain persisted-lineage fields (`id`, `source`, `payloadHash`, received/fetched times), current time, code version, and optional run ID; it must not import a repository port row. Output is `readonly EnrichedClmmObservation[]` with identical source/raw refs and an empty `derivedFromRefs`; the application can pass these structurally into `NormalizedObservationRepo.insertMany` without making domain depend on ports.
- [ ] **Step 5: Rerun the three focused test files, then run `pnpm exec eslint src/contracts/taxonomy.ts src/contracts/normalized-clmm-observation.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts src/domain/taxonomy/index.ts src/domain/clmm-bundle/enrich.ts src/domain/clmm-bundle/index.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts tests/domain/clmm-bundle/enrich.test.ts --max-warnings 0` and `pnpm exec prettier --check src/contracts/taxonomy.ts src/contracts/normalized-clmm-observation.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts src/domain/taxonomy/index.ts src/domain/clmm-bundle/enrich.ts src/domain/clmm-bundle/index.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts tests/domain/clmm-bundle/enrich.test.ts`.**
- [ ] **Step 6: Commit:** `git add src/contracts/taxonomy.ts src/contracts/normalized-clmm-observation.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts src/domain/taxonomy/index.ts src/domain/clmm-bundle/enrich.ts src/domain/clmm-bundle/index.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts tests/domain/clmm-bundle/enrich.test.ts && git commit -m "feat(taxonomy): enrich CLMM normalized facts"`.

## Repository Targets

### Expected Files

- src/contracts/taxonomy.ts
- src/contracts/normalized-clmm-observation.ts
- src/domain/taxonomy/registry.ts
- src/domain/taxonomy/validation.ts
- src/domain/taxonomy/index.ts
- src/domain/clmm-bundle/enrich.ts
- src/domain/clmm-bundle/index.ts
- tests/domain/taxonomy/registry.test.ts
- tests/domain/taxonomy/validation.test.ts
- tests/domain/clmm-bundle/enrich.test.ts

## Validation Commands

```bash
pnpm vitest run tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts tests/domain/clmm-bundle/enrich.test.ts
pnpm exec eslint src/contracts/taxonomy.ts src/contracts/normalized-clmm-observation.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts src/domain/taxonomy/index.ts src/domain/clmm-bundle/enrich.ts src/domain/clmm-bundle/index.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts tests/domain/clmm-bundle/enrich.test.ts --max-warnings 0
pnpm exec prettier --check src/contracts/taxonomy.ts src/contracts/normalized-clmm-observation.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts src/domain/taxonomy/index.ts src/domain/clmm-bundle/enrich.ts src/domain/clmm-bundle/index.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts tests/domain/clmm-bundle/enrich.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **execution safety freshness**: Trigger and data-quality facts are deterministic execution-safety observations excluded after the 60-second state horizon. (Test: `trigger_event and data_quality are deterministic execution_safety kinds with 60-second exclude-on-stale policies`)
- **registry-derived enrichment**: Family, class, confidence policy, and freshness policy come from the registry rather than caller constants. (Test: `enrichment derives family class and freshness exclusively from the registry entry`)
- **versioned completeness**: Completeness counts explicit present values and excludes null under the named v1 weighting definition. (Test: `completeness counts zero false and empty arrays as present and null as absent under weighting version clmm-bundle-completeness-v1`)
- **direct evidence confidence**: Direct facts use reliability and derivation confidence 1, null LLM confidence, and validated raw lineage. (Test: `direct facts use reliability 1 derivation 1 llm null and validated direct raw provenance`)
- **timestamp validity**: Future-skewed or out-of-order times fail enrichment before normalized persistence. (Test: `future or out-of-order timestamps fail before persistence`)
