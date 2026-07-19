# Task Context: Task 2

Title: Define source-independent price contracts and taxonomy rules

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-23
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-23
Start Commit: 6a3197f1ad619c2594d8a693577cd6c67b3689f1

## Task Requirements

**Files:**

- Modify: `src/contracts/taxonomy.ts`
- Create: `src/contracts/normalized-price-observation.ts`
- Modify: `src/contracts/index.ts`
- Modify: `src/domain/taxonomy/registry.ts`
- Modify: `src/domain/taxonomy/confidence.ts`
- Modify: `src/domain/taxonomy/validation.ts`
- Modify: `src/domain/clmm-bundle/enrich.ts`
- Modify: `tests/domain/taxonomy/registry.test.ts`
- Modify: `tests/domain/taxonomy/confidence.test.ts`
- Modify: `tests/domain/taxonomy/validation.test.ts`
- Modify: `tests/domain/taxonomy/freshness.test.ts`
- Modify: `tests/domain/taxonomy/provenance.test.ts`
- Modify: `tests/domain/clmm-bundle/enrich.test.ts`
- Modify: `tests/helpers/taxonomy-fixtures.ts`

**Exported API changes:** Replace the inactive `price_quote` observation kind with `oracle_price` and `executable_quote`; add `pyth-hermes` and `jupiter-quote` sources; remove `ObservationKindEntry.source`; add `oracle_confidence_wide` and `high_price_impact` confidence reasons; export `OraclePricePayloadV1`, `ExecutableQuotePayloadV1`, `PriceObservationWarning`, and `PriceNormalizedCandidate`. Extend `computeConfidence` with an optional final `additionalReasons: readonly ConfidenceReason[] = []` parameter so direct-source reasons are included and deduplicated without overloading completeness semantics.

- [ ] **Step 1: Write taxonomy tests first.** Update only the observation-registry describe blocks in `tests/domain/taxonomy/registry.test.ts` with `registers source-independent price kinds with exclude-on-stale policies`, asserting Pyth 60-second/Jupiter 30-second windows, allowed provenance sources, active schema v1, and absence of singular `source`. Add confidence tests named `degrades source quality without conflating provider uncertainty with completeness` for explicit source-reliability factors and reasons. Update parser, generic freshness/provenance fixtures, and CLMM enrichment tests to use the new kinds/sources while proving CLMM completeness remains keyed only by `ClmmNormalizedCandidate["kind"]`.
- [ ] **Step 2: Run the focused tests and confirm failures.** Run `pnpm exec vitest run tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/confidence.test.ts tests/domain/taxonomy/validation.test.ts tests/domain/taxonomy/freshness.test.ts tests/domain/taxonomy/provenance.test.ts tests/domain/clmm-bundle/enrich.test.ts`; expect type/runtime failures for missing kinds, sources, reason codes, parser values, and price contracts.
- [ ] **Step 3: Add exact normalized contracts.** Store provider integer inputs as strings and define decimal strings for oracle price/confidence/bounds/ratio and quote implied price. Include pair, assets/mints/decimals, observed/source time basis, slot, exact probe/slippage/threshold, route summary, `routeAvailable: true`, and warning arrays; omit unavailable optional values rather than replacing them with zero.
- [ ] **Step 4: Implement registry, parser, confidence, and CLMM typing changes.** Remove every observation entry's singular `source`, rely on `allowedSourceRefs`, use 60,000 ms and 30,000 ms exclude policies, and let callers supply the deterministic source-quality factor and matching reason without changing completeness. Update `oracle_divergence`'s future provenance allowance to `pyth-hermes` and `jupiter-quote` without implementing the feature. Update runtime parser sets, and narrow the CLMM completeness table from all `ObservationKind` values to only CLMM candidate kinds so provider-specific logic stays out of that module.
- [ ] **Step 5: Verify this task.** Run `pnpm exec vitest run tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/confidence.test.ts tests/domain/taxonomy/validation.test.ts tests/domain/taxonomy/freshness.test.ts tests/domain/taxonomy/provenance.test.ts tests/domain/clmm-bundle/enrich.test.ts` and `pnpm exec eslint src/contracts/taxonomy.ts src/contracts/normalized-price-observation.ts src/contracts/index.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/confidence.ts src/domain/taxonomy/validation.ts src/domain/clmm-bundle/enrich.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/confidence.test.ts tests/domain/taxonomy/validation.test.ts tests/domain/taxonomy/freshness.test.ts tests/domain/taxonomy/provenance.test.ts tests/domain/clmm-bundle/enrich.test.ts tests/helpers/taxonomy-fixtures.ts`; expect all selected checks to pass.
- [ ] **Step 6: Commit.** Run `git add src/contracts/taxonomy.ts src/contracts/normalized-price-observation.ts src/contracts/index.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/confidence.ts src/domain/taxonomy/validation.ts src/domain/clmm-bundle/enrich.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/confidence.test.ts tests/domain/taxonomy/validation.test.ts tests/domain/taxonomy/freshness.test.ts tests/domain/taxonomy/provenance.test.ts tests/domain/clmm-bundle/enrich.test.ts tests/helpers/taxonomy-fixtures.ts && git commit -m "feat: define price observation taxonomy"`.

## Repository Targets

### Expected Files

- src/contracts/taxonomy.ts
- src/contracts/normalized-price-observation.ts
- src/contracts/index.ts
- src/domain/taxonomy/registry.ts
- src/domain/taxonomy/confidence.ts
- src/domain/taxonomy/validation.ts
- src/domain/clmm-bundle/enrich.ts
- tests/domain/taxonomy/registry.test.ts
- tests/domain/taxonomy/confidence.test.ts
- tests/domain/taxonomy/validation.test.ts
- tests/domain/taxonomy/freshness.test.ts
- tests/domain/taxonomy/provenance.test.ts
- tests/domain/clmm-bundle/enrich.test.ts
- tests/helpers/taxonomy-fixtures.ts

## Validation Commands

```bash
pnpm exec vitest run tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/confidence.test.ts tests/domain/taxonomy/validation.test.ts tests/domain/taxonomy/freshness.test.ts tests/domain/taxonomy/provenance.test.ts tests/domain/clmm-bundle/enrich.test.ts
pnpm exec eslint src/contracts/taxonomy.ts src/contracts/normalized-price-observation.ts src/contracts/index.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/confidence.ts src/domain/taxonomy/validation.ts src/domain/clmm-bundle/enrich.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/confidence.test.ts tests/domain/taxonomy/validation.test.ts tests/domain/taxonomy/freshness.test.ts tests/domain/taxonomy/provenance.test.ts tests/domain/clmm-bundle/enrich.test.ts tests/helpers/taxonomy-fixtures.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **price freshness policy**: Oracle observations use a 60-second publish-time window and executable quotes use a 30-second receipt-time window, both excluding stale evidence. (Test: `registers source-independent price kinds with exclude-on-stale policies`)
- **source quality is independent from completeness**: Wide oracle confidence or high quote impact changes source reliability and reason codes without changing field completeness. (Test: `degrades source quality without conflating provider uncertainty with completeness`)
