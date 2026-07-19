# Task 6 Implementation Log

## Overview

Successfully implemented Task 6: **Preserve durable side-effect failures and map every leaf outcome**.

## Details of Work

1. **Side-Effect Recovery & Durable Errors**:
   - Created and exported `PostPersistenceOutputError` in `src/application/ingest-raw-observation.ts`.
   - Modified `ingestRawObservation` to wrap `writeCompatibilityOutput` failures in `PostPersistenceOutputError` containing the correct recovery context (`rawObservationId`, `rawOutcome`, `normalizedCount`, and `parseStatus`), preserving the original error as `cause`.
   - Verified that validation, normalization, and database persistence failures are not wrapped because their durability state is different.

2. **Failed Result Extensions**:
   - Extended the `failed` variant of `PriceSourceResult` in `src/application/price-source-result.ts` with optional durable evidence metadata (`durableEvidence` consisting of `rawObservationId` and `normalizedCount`) and an optional `hasUsableEvidence` boolean.

3. **Leaf Outcome Mappers**:
   - Implemented mapping boundaries and `redactDiagnostic(text: string): string` in `src/application/source-outcome.ts`.
   - `mapPriceSourceOutcome`: maps a `PriceSourceResult` to `SourceCollectionOutcome`.
   - `mapClmmSourceOutcome`: maps a `CollectClmmBundleResult` to `SourceCollectionOutcome`.
   - `mapSourceError`: maps a thrown error (such as `PostPersistenceOutputError`, `ClmmObservationConflictError`, or generic errors) to a failed/conflict `SourceCollectionOutcome`.
   - Handled warning mapping from source-specific structures to `{ source, code, message }` without flattening provenance.
   - Handled credential and secret redaction/truncation for error messages and conflict hashes before they cross the boundary.

4. **Testing (TDD)**:
   - Added `preserves durable evidence metadata when compatibility output fails` to `tests/application/ingest-raw-observation.test.ts`.
   - Updated existing CLMM and Jupiter compatibility snapshot write failure tests to verify that they throw, and that mapping their thrown errors yields `failed` status with `hasUsableEvidence: true`, the correct raw ID/count, and a redacted diagnostic message.
   - Added comprehensive mapper unit tests in `tests/application/source-outcome.test.ts` covering status mappings, conflict formatting, and secret redaction.
