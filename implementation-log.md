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
