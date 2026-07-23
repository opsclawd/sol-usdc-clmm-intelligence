# Task Context: Task 2

Title: Implement pure validation, normalization, equivalence, and enrichment

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-27
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-27
Start Commit: 8d258115c27c92c40909384db9d08dca77ae3750

## Task Requirements

**Files:**

- Create: `src/domain/support-resistance/validate.ts`
- Create: `src/domain/support-resistance/normalize.ts`
- Create: `src/domain/support-resistance/identity.ts`
- Create: `src/domain/support-resistance/enrich.ts`
- Create: `src/domain/support-resistance/index.ts`
- Create: `tests/fixtures/support-resistance.ts`
- Create: `tests/domain/support-resistance/validate.test.ts`
- Create: `tests/domain/support-resistance/normalize.test.ts`
- Create: `tests/domain/support-resistance/identity.test.ts`
- Create: `tests/domain/support-resistance/enrich.test.ts`

**Exported API changes:** add pure exported functions `acceptSupportResistanceSnapshot`, `normalizeSupportResistanceClaims`, `deriveSupportResistanceSourceObservationKey`, `deriveSupportResistanceEquivalenceKey`, and `enrichSupportResistanceClaim`, plus their input/output/error types. Existing signatures remain unchanged.

- [ ] **Step 1: Add fixtures and failing validation/normalization tests.**

  Build one reusable snapshot fixture containing a support point and resistance zone. Write these exact cases first:
  - `accepts a bounded SOL/USDC snapshot and trims retained extracts to 500 characters`
  - `rejects the wrong pair invalid timestamps and out-of-range source reliability`
  - `normalizes an explicit point without zone fields`
  - `normalizes ordered zone bounds without a point field`
  - `does not fabricate a normalized claim when a source claim has no numeric level`
  - `rejects mixed point and zone fields and inverted or non-positive bounds`
  - `adds explicit warnings for missing references invalidation rules and ambiguity`

  Validation must clone only the allowlisted fields from the unknown response. It must never retain arbitrary provider keys or a full article body. Normalize strings by trimming, deduplicate/sort thesis codes, invalidation conditions, warnings, and references, while preserving explicit point-versus-zone semantics.

- [ ] **Step 2: Run validation/normalization tests and confirm they fail.**

  Run: `pnpm exec vitest run tests/domain/support-resistance/validate.test.ts tests/domain/support-resistance/normalize.test.ts`

  Expected: FAIL because the pure domain modules do not exist.

- [ ] **Step 3: Implement strict acceptance and normalization.**

  `acceptSupportResistanceSnapshot(input: unknown)` must require a non-empty provider/run identity, `SOL/USDC`, finite integer timestamps, an array of claims, arrays for source references whose present entries are non-empty strings, and reliability in `[0, 1]`; return a newly built bounded snapshot rather than the original object. Empty reference arrays remain representable and produce `missing_source_reference` during normalization. `normalizeSupportResistanceClaims(snapshot)` must return both accepted payloads and rejected claim diagnostics so a missing level becomes unavailable/degraded rather than fabricated.

  Use the following deterministic level validation:

  ```ts
  if (claim.levelType === "point") {
    accept only Number.isFinite(levelUsdcPerSol) && levelUsdcPerSol > 0;
    reject any supplied zone bound;
  }
  if (claim.levelType === "zone") {
    accept only finite positive lower/upper bounds with lower < upper;
    reject any supplied point value;
  }
  otherwise reject with "missing_level";
  ```

  Preserve a source-supplied expiry even when already expired; do not rewrite it to a future time.

- [ ] **Step 4: Add failing identity/equivalence tests.**

  Write exact cases:
  - `derives a source observation key from provider and provider run identity`
  - `groups only materially equivalent claims from the same provider run`
  - `keeps point and zone assertions distinct`
  - `keeps different sides timeframes theses providers and runs distinct`

  The equivalence key must canonicalize exactly: provider ID, provider run ID, pair, side, level type, point or both zone bounds, timeframe, and sorted thesis codes. Do not include warnings, prose extract, source URL order, or invalidation prose, because those do not change the asserted technical level; do include provider/run so cross-source claims remain independent.

- [ ] **Step 5: Implement deterministic identity and within-run grouping.**

  Hash canonical identity objects with the existing `canonicalizePayload`; group duplicates in original claim order, retain one normalized payload, and append `duplicate_equivalent_claim`. The source observation key must be a stable hash-derived `providerId:providerRunId` identity and must not include fetched time, so exact source-run replays hit the existing raw uniqueness boundary.

- [ ] **Step 6: Add failing enrichment tests.**

  Write exact cases:
  - `enriches a fresh claim with contextual taxonomy confidence and direct raw provenance`
  - `caps confidence at source quality and completeness`
  - `marks an expired claim stale and degrades confidence for context-only use`

  Assert `sourceValidUntilUnixMs` is passed to `computeFreshness`, provenance contains the raw observation ref and process metadata, stale payloads gain `stale_observation`, and normalized payload hashes are computed after warnings are finalized.

- [ ] **Step 7: Implement enrichment with existing taxonomy primitives.**

  Build direct provenance from the raw row using source `technical-analysis-api`, collector `http-support-resistance-source`, job `support-resistance-enrichment`, code version, and pipeline run ID. Compute completeness from presence of references and invalidation conditions; use the source reliability directly, derivation confidence `1`, and no LLM confidence. After `computeConfidence`, cap the composite at `Math.min(sourceReliability, dataCompleteness)`, rederive the level with the registry thresholds, and add `contextual_source_quality_cap_applied` when the cap changes the score. Apply the stale factor before that cap so expiry can only reduce confidence. Pass `{ factor: 0.5 }` for stale claims and validate provenance against the new taxonomy entry.

- [ ] **Step 8: Run focused verification.**

  Run: `pnpm exec vitest run tests/domain/support-resistance/validate.test.ts tests/domain/support-resistance/normalize.test.ts tests/domain/support-resistance/identity.test.ts tests/domain/support-resistance/enrich.test.ts`

  Expected: PASS for all named point, zone, missing, equivalence, freshness, confidence, and provenance cases.

  Run: `pnpm exec eslint src/domain/support-resistance tests/domain/support-resistance tests/fixtures/support-resistance.ts --max-warnings 0`

  Expected: exit 0.

  Run: `pnpm exec prettier --check src/domain/support-resistance tests/domain/support-resistance tests/fixtures/support-resistance.ts`

  Expected: all listed paths use Prettier formatting.

- [ ] **Step 9: Commit the pure domain slice.**

  ```bash
  git add src/domain/support-resistance tests/domain/support-resistance tests/fixtures/support-resistance.ts
  git commit -m "feat: normalize support resistance claims"
  ```

## Repository Targets

### Expected Files

- src/domain/support-resistance/validate.ts
- src/domain/support-resistance/normalize.ts
- src/domain/support-resistance/identity.ts
- src/domain/support-resistance/enrich.ts
- src/domain/support-resistance/index.ts
- tests/fixtures/support-resistance.ts
- tests/domain/support-resistance/validate.test.ts
- tests/domain/support-resistance/normalize.test.ts
- tests/domain/support-resistance/identity.test.ts
- tests/domain/support-resistance/enrich.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/domain/support-resistance/validate.test.ts tests/domain/support-resistance/normalize.test.ts tests/domain/support-resistance/identity.test.ts tests/domain/support-resistance/enrich.test.ts
pnpm exec eslint src/domain/support-resistance tests/domain/support-resistance tests/fixtures/support-resistance.ts --max-warnings 0
pnpm exec prettier --check src/domain/support-resistance tests/domain/support-resistance tests/fixtures/support-resistance.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **bounded-retention**: Accepted snapshots contain only allowlisted fields and retained extracts are capped at 500 characters. (Test: `accepts a bounded SOL/USDC snapshot and trims retained extracts to 500 characters`)
- **invalid-snapshot-rejection**: Wrong pair, invalid timestamps, or source reliability outside zero through one is rejected before persistence. (Test: `rejects the wrong pair invalid timestamps and out-of-range source reliability`)
- **point-preservation**: An explicit point normalizes with its point value and no zone fields. (Test: `normalizes an explicit point without zone fields`)
- **zone-preservation**: An explicit ordered zone normalizes with lower and upper bounds and no point field. (Test: `normalizes ordered zone bounds without a point field`)
- **missing-level-unavailable**: A retained source claim without an explicit point or complete zone yields a rejected diagnostic and no normalized numeric claim. (Test: `does not fabricate a normalized claim when a source claim has no numeric level`)
- **malformed-level-rejection**: Mixed point/zone fields, non-positive values, and inverted zones are rejected. (Test: `rejects mixed point and zone fields and inverted or non-positive bounds`)
- **explicit-ambiguity**: Missing references, missing invalidation rules, and source ambiguity become explicit warning codes. (Test: `adds explicit warnings for missing references invalidation rules and ambiguity`)
- **stable-source-run-identity**: Raw source identity is derived from provider and provider run, independent of collection time. (Test: `derives a source observation key from provider and provider run identity`)
- **same-run-equivalence-only**: Only claims with equal provider, run, pair, side, type, bounds, timeframe, and thesis identity group together. (Test: `groups only materially equivalent claims from the same provider run`)
- **point-zone-equivalence-separation**: A point and a zone never share an equivalence identity even when their numeric values touch. (Test: `keeps point and zone assertions distinct`)
- **cross-source-disagreement-preserved**: Different sides, timeframes, theses, providers, or runs always produce distinct equivalence keys. (Test: `keeps different sides timeframes theses providers and runs distinct`)
- **fresh-contextual-enrichment**: Fresh claims receive contextual taxonomy metadata, confidence, and direct raw provenance. (Test: `enriches a fresh claim with contextual taxonomy confidence and direct raw provenance`)
- **source-quality-confidence-cap**: Confidence composition reflects and cannot bypass the claim source reliability and completeness inputs. (Test: `caps confidence at source quality and completeness`)
- **expired-context-only**: Expired claims remain persisted contextual evidence but are stale, warned, and confidence-degraded. (Test: `marks an expired claim stale and degrades confidence for context-only use`)
