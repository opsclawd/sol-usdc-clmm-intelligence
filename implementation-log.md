# Implementation Log - Task 8

## Overview

Implemented Task 8: Bind the core job and operator command.

## Implementation Details

1. **Tests First (TDD)**: Created `tests/scripts/core-collection.test.ts` verifying all requirements and behavioral invariants:
   - `creates one context then binds clmm pyth jupiter and orca leaves` - verifies job creates one context and binds the collectors to it.
   - `prints every source outcome and exits by derived overall status` - verifies script prints source outcomes and exits non-zero for FAILED/UNAVAILABLE.
   - `closes the database once after all source outcomes settle` - verifies the database connection closes exactly once.
   - `reports cleanup failure without rewriting committed source outcomes` - verifies cleanup close failures report redacted errors without rewriting outcomes.
2. **Implementation**:
   - Created `src/jobs/core-collection-job.ts` to implement `coreCollectionJob` and `runCoreCollectionJob` which sets up the context once and binds all four core collectors (CLMM bundle, Pyth hermes, Jupiter quote, Orca public API) and passes them to `collectCore`.
   - Modified `src/jobs/index.ts` to export the new job functions.
   - Created `scripts/collectors/core-collection.ts` to orchestrate node runtime setup, job run, JSON stringification, status-derived process exits, database closing, and redacted cleanup errors.
   - Modified `package.json` to register `"collect:core": "tsx scripts/collectors/core-collection.ts"`.
3. **Verification**:
   - `pnpm exec vitest run tests/scripts/core-collection.test.ts` passed successfully.
   - ESLint and Prettier check runs have been fully satisfied.
   - `pnpm boundaries` dependency check passed successfully.
