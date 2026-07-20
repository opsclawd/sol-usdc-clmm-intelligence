# Implementation Log: Task 11

## Task: Expose derivation through the Node runtime job and script

**Date:** 2026-07-20
**Commit:** b576d6f

## Changes Made

### New Files

1. **src/jobs/derive-mvp-features-job.ts** - Thin job that:
   - Obtains a run ID from `RunIdFactory`
   - Accepts `poolId`, `positionIds`, and optional `codeVersion` in request
   - Delegates directly to `deriveMvpFeatures`
   - Binds only clock, normalized repo, feature repo, run ID

2. **scripts/collectors/derive-mvp-features.ts** - Operator script that:
   - Reads pool identity from `WHIRLPOOL_ADDRESS`
   - Parses `INTELLIGENCE_POSITION_IDS` (comma-separated, trim/filter/de-dupe)
   - Uses `INTELLIGENCE_CODE_VERSION ?? "development"`
   - Prints JSON counts/warnings
   - Always closes DB connection

3. **tests/scripts/derive-mvp-features.test.ts** - Tests covering:
   - `runtime persistence exposes all three repositories from one connection`
   - `deriveMvpFeaturesJob thin job performs no publication or source collection`
   - Position ID parsing and validation
   - Environment variable validation

### Modified Files

1. **src/jobs/index.ts** - Added export for `deriveMvpFeaturesJob`
2. **package.json** - Added `"derive:mvp": "tsx scripts/collectors/derive-mvp-features.ts"`
3. **.env.example** - Added `INTELLIGENCE_POSITION_IDS=` environment variable

### Notes

- The `featureRepo` was already present in the `Persistence` interface in `composition-root.ts` (verified no diff)
- The job delegates to the existing `deriveMvpFeatures` from `src/application/derive-mvp-features.ts`
- All 10 tests pass
- Lint and format checks pass

---

# Implementation Log: Task 12

## Task: Document feature semantics and operator usage

**Date:** 2026-07-20

## Changes Made

### Modified Files

1. **README.md** - Added "Deterministic feature tranche (INT-FEATURES #8)" section documenting:
   - The seven canonical feature kinds with unit, scope, and calculator version
   - Authority boundary (LLM cannot invent/override/approximate these values)
   - Deferred feature list (backlog after #8)

2. **docs/architecture.md** - Added "Deterministic Feature Derivation" section documenting:
   - Reproducibility rules (exact rational arithmetic, ties-away-from-zero rounding)
   - All seven formulas (range_location, distance_to_lower/upper, oracle_dex_divergence, oracle_confidence_width, realized_volatility_1h, volume_liquidity_ratio_24h)
   - Volatility window parameters (1h inclusive, 10-sample min, 45-min span min, 10-min gap max)
   - Selection ordering (slot desc, observedAt desc, receivedAt desc, ID asc)
   - Duplicate handling, confidence cap, freshness minimum, lineage/derivation-key semantics

3. **docs/operator-runbook.md** - Added "MVP Feature Derivation" section documenting:
   - Required env vars (WHIRLPOOL_ADDRESS, INTELLIGENCE_POSITION_IDS, INTELLIGENCE_CODE_VERSION)
   - Migration precondition (abort if derived_features has rows)
   - Pre-flight SQL checks
   - Example invocation with available and unavailable response formats
   - Output artifacts and replay behavior
   - Clarification that unavailable evidence is stored but is not a numeric publication candidate

### Validation

- `pnpm exec prettier --check README.md docs/architecture.md docs/operator-runbook.md` — all pass
- `pnpm typecheck` — passes
- `pnpm test` — 839 tests pass

### Notes

- All documentation is read-only; no implementation code was changed
- Task 12 scope was documentation only (Steps 1-4 of the task requirements)
