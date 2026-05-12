# INT-TAXONOMY #6: Implementation Plan

**Issue:** opsclawd/sol-usdc-clmm-intelligence#6
**Branch:** feat/int-taxonomy-6
**Spec:** `docs/superpowers/specs/2026-05-11-int-taxonomy-design.md`

## Overview

7 phases, each independently verifiable via `pnpm verify`. Phases 1-3 are pure TypeScript with no DB changes. Phase 4 adds DB migration. Phases 5-6 update existing code. Phase 7 is final wiring.

---

## Phase 1: Contracts — Type Definitions

**Goal:** All taxonomy types in `src/contracts/taxonomy.ts`, barrel-exported.

### Steps

1. Create `src/contracts/taxonomy.ts` with all types from spec §1.1–1.8:
   - Stable closed enums: `EvidenceFamily`, `SignalClass`, `ConfidenceLevel`, `StaleBehavior`
   - Extensible open kinds: `ObservationKind`, `FeatureKind`
   - Source: `Source`
   - Provenance: `ProvenanceRefType`, `ProvenanceRef`, `ProcessRef`, `Provenance`
   - Confidence: `ConfidenceComponents`, `ConfidenceWeights`, `ConfidencePolicy`, `ConfidenceThresholds`, `ConfidenceReason`, `Confidence`
   - Freshness: `FreshnessPolicy`, `FreshnessReason`, `Freshness`
   - Provenance requirements: `ProvenanceRequirements`, `ProvenanceValidationError`
   - Provenance validation result: `ProvenanceValidationResult`
   - Registry entries: `ObservationKindEntry`, `FeatureKindEntry`
   - Taxonomy summary: `TaxonomySummary`
2. Add `export * from "./taxonomy.js"` to `src/contracts/index.ts`

### Verification

- `pnpm verify` — typecheck confirms types are well-formed, no import errors

---

## Phase 2: Domain — Registry

**Goal:** Static `as const satisfies` registry with all active entries + registry tests.

### Steps

1. Create `src/domain/taxonomy/registry.ts`:
   - `observationKindRegistry as const satisfies Record<ObservationKind, ObservationKindEntry>`
   - `featureKindRegistry as const satisfies Record<FeatureKind, FeatureKindEntry>`
   - Entries per spec §2.2–2.3 tables
   - Helper: `getObservationKindEntry(kind: ObservationKind): ObservationKindEntry`
   - Helper: `getFeatureKindEntry(kind: FeatureKind): FeatureKindEntry`
2. Create `src/domain/taxonomy/index.ts` barrel
3. Create `tests/domain/taxonomy/registry.test.ts`:
   - Every `ObservationKind` union member has a registry entry
   - Every `FeatureKind` union member has a registry entry
   - Every entry's `kind` field matches its object key
   - Every entry's `source` is a valid `Source`
   - Every entry's `evidenceFamily` is a valid `EvidenceFamily`
   - Every entry's `signalClass` is a valid `SignalClass`
4. Update `dependency-cruiser`: relax `domain-no-output-contracts` to allow `domain → contracts/taxonomy.ts` (currently blocks `outputs|cron-config`, taxonomy is neither)

### Verification

- `pnpm verify` — typecheck + tests + boundaries

---

## Phase 3: Domain — Pure Functions (Freshness, Confidence, Provenance, Validation)

**Goal:** All pure computation functions with comprehensive tests.

### Steps

1. Create `src/domain/taxonomy/freshness.ts`:
   - `computeFreshness(timestamps, policy, nowMs): Freshness`
   - Implements spec §3.2 derivation rules
   - Throws on impossible timestamp states
2. Create `src/domain/taxonomy/confidence.ts`:
   - `computeConfidence(components, policy, weightingVersion, staleDegradation?): Confidence`
   - Implements spec §4.2 derivation rules
   - Validates weight sums, component ranges
3. Create `src/domain/taxonomy/provenance.ts`:
   - `validateProvenance(provenance, requirements, artifactKind): ProvenanceValidationResult`
   - Returns result type, never throws
4. Create `src/domain/taxonomy/validation.ts`:
   - `parseObservationKind(raw: string): ObservationKind`
   - `parseFeatureKind(raw: string): FeatureKind`
   - `parseSource(raw: string): Source`
   - `parseSignalClass(raw: string): SignalClass`
   - `parseEvidenceFamily(raw: string): EvidenceFamily`
   - `parseConfidenceLevel(raw: string): ConfidenceLevel`
   - `parseStaleBehavior(raw: string): StaleBehavior`
   - `TaxonomyValidationError` class
5. Create tests:
   - `tests/domain/taxonomy/freshness.test.ts` — timestamp sanity, validUntil, stale detection, fetch lag, undefined-handling
   - `tests/domain/taxonomy/confidence.test.ts` — weight sum, LLM redistribution, thresholds, stale degradation, component validation
   - `tests/domain/taxonomy/provenance.test.ts` — min refs, allowed sources, required fields, result type
   - `tests/domain/taxonomy/validation.test.ts` — valid parse returns typed, invalid throws
6. Update barrel `src/domain/taxonomy/index.ts`

### Verification

- `pnpm verify` — all new + existing tests pass, boundaries clean

---

## Phase 4: DB Migration — Taxonomy Columns

**Goal:** New migration adding taxonomy columns, CHECK constraints, deprecating old columns.

### Steps

1. Create `drizzle/0001_add_taxonomy_columns.sql`:
   - `normalized_observations`: ALTER TABLE ADD signal_class, evidence_family, confidence(jsonb), confidence_composite, confidence_level, valid_until_unix_ms, is_stale, stale_behavior, provenance(jsonb). Add CHECK constraints per spec §7.1. Copy `is_fresh → is_stale` (inverted). Drop `is_fresh`.
   - `derived_features`: ALTER TABLE ADD signal_class, evidence_family, confidence(jsonb), confidence_composite, confidence_level, valid_until_unix_ms, is_stale, stale_behavior, provenance(jsonb). Drop `input_lineage`.
   - `evidence_bundles`: ALTER TABLE ADD taxonomy_summary(jsonb), dominant_signal_class, confidence(jsonb), confidence_composite, confidence_level, valid_until_unix_ms, is_stale, stale_behavior, provenance(jsonb). Drop `input_lineage`.
   - `research_briefs`: ALTER TABLE ADD signal_class, evidence_family(nullable), taxonomy_summary(jsonb), confidence(jsonb), confidence_composite, confidence_level, valid_until_unix_ms, is_stale, stale_behavior, provenance(jsonb). Add CHECK `(evidence_family IS NOT NULL OR taxonomy_summary IS NOT NULL)`. Drop `confidence(varchar)`, `source_refs(jsonb)`.
2. Update `drizzle/meta/_journal.json` — add entry for `0001_add_taxonomy_columns`
3. Update Drizzle schema files to match new columns:
   - `src/db/schema/normalized-observations.ts` — add columns, remove `isFresh`, add `isStale`
   - `src/db/schema/derived-features.ts` — add columns, remove `inputLineage`, add `provenance`
   - `src/db/schema/evidence-bundles.ts` — add columns, remove `inputLineage`, add `provenance`
   - `src/db/schema/research-briefs.ts` — add columns, remove `confidence(varchar)`, `sourceRefs`, add `provenance`
4. Regenerate `drizzle/meta/0001_snapshot.json` (or update manually to reflect new schema state)

### Verification

- `pnpm verify` — typecheck passes with updated schemas
- Migration SQL is idempotent (IF NOT EXISTS / ADD IF NOT EXISTS patterns)

---

## Phase 5: Port Interfaces — Typed DTOs

**Goal:** Port interfaces use typed constructs from contracts, not raw strings.

### Steps

1. Update `src/ports/observation-repo.ts`:
   - `source: Source` (was `string`)
   - Optionally add `parseStatus: ParseStatus` if we define it
2. Update `src/ports/normalized-observation-repo.ts`:
   - Import types from `src/contracts/taxonomy.ts`
   - `source: Source`, `observationKind: ObservationKind`
   - Add: `signalClass: SignalClass`, `evidenceFamily: EvidenceFamily`, `confidence: Confidence`, `validUntilUnixMs: number`, `isStale: boolean` (replaces `isFresh`), `staleBehavior: StaleBehavior`, `provenance: Provenance`
3. Update `src/ports/feature-repo.ts`:
   - `featureKind: FeatureKind`, `confidence: Confidence` (was `string`), `provenance: Provenance` (was `inputLineage: unknown`)
   - Add: `signalClass`, `evidenceFamily`, `validUntilUnixMs`, `isStale`, `staleBehavior`
4. Update `src/ports/bundle-repo.ts`:
   - Add: `taxonomySummary: TaxonomySummary`, `dominantSignalClass: SignalClass`, `confidence: Confidence`, `validUntilUnixMs`, `isStale`, `staleBehavior`, `provenance: Provenance` (replaces `inputLineage`)
5. Update `src/ports/brief-repo.ts`:
   - Add: `signalClass: SignalClass`, `evidenceFamily?: EvidenceFamily`, `taxonomySummary?: TaxonomySummary`, `confidence: Confidence` (replaces `string`), `validUntilUnixMs`, `isStale`, `staleBehavior`, `provenance: Provenance` (replaces `sourceRefs`)
6. Add `dependency-cruiser` rule: `ports-no-domain` — ports cannot import from `src/domain/taxonomy/` (only `src/contracts/taxonomy.ts`)

### Verification

- `pnpm verify` — compile errors expected in adapters/fakes until Phase 6

---

## Phase 6: Adapters, Fakes, and Tests — Bridge the Gap

**Goal:** All adapters and fakes implement updated port interfaces, all tests pass.

### Steps

1. Update Drizzle adapters:
   - `drizzle-normalized-observation-repo.ts` — `toPortRow()` maps new columns, `isFresh → isStale`, parse/bridge typed fields
   - `drizzle-feature-repo.ts` — `toPortRow()` maps new columns, `inputLineage → provenance`
   - `drizzle-bundle-repo.ts` — `toPortRow()` maps new columns, `inputLineage → provenance`
   - `drizzle-brief-repo.ts` — `toPortRow()` maps new columns, `sourceRefs → provenance`
   - Each adapter bridges typed domain objects (Source, ObservationKind, etc.) to DB varchar/jsonb columns by passing through string values (union types are string subtypes)
2. Update fake repos:
   - `fake-normalized-observation-repo.ts` — implement new fields, invert isFresh → isStale
   - `fake-feature-repo.ts` — implement new fields, replace inputLineage with provenance
   - `fake-bundle-repo.ts` — implement new fields, replace inputLineage with provenance
   - `fake-brief-repo.ts` — implement new fields, replace sourceRefs with provenance
3. Update existing test data to use typed values:
   - `"pool-snapshot"` → `"pool_state"` (kind name migration)
   - `"fee-apr"` → `"fee_apr"`
   - `"jupiter-price"` → `"jupiter-price"` (source keeps hyphens)
   - Update `isFresh: true` → `isStale: false`
   - Add minimum required new fields to test data
4. Update DB schema tests to cover new columns
5. Update port tests to verify new typed interfaces

### Verification

- `pnpm verify` — all 61+ tests pass, 0 boundary violations

---

## Phase 7: Final Wiring and Verification

**Goal:** Integration verification, acceptance criteria check, edge cases.

### Steps

1. Add `ParseStatus` type to `src/contracts/taxonomy.ts` (if not added in Phase 1) — `"pending" | "parsed" | "failed"`
2. Verify `dependency-cruiser` includes `ports-no-domain` rule
3. Run full `pnpm verify`
4. Add integration-level test: create a full `NormalizedObservationInsert` with all taxonomy fields, insert via fake repo, verify all fields present
5. Verify kind name migration: grep for any remaining kebab-case kind names (except source hyphens)
6. Verify acceptance criteria from spec §11

### Verification

- `pnpm verify` — final green
- No remaining `is_fresh` / `isFresh` references (only `is_stale` / `isStale`)
- No remaining `input_lineage` / `inputLineage` references (only `provenance`)
- No remaining kebab-case kind names (pool-snapshot, fee-apr)
- All CHECK constraints in migration SQL match spec §7.1

---

## File Change Summary

### New Files (10)

| File                                       | Phase |
| ------------------------------------------ | ----- |
| `src/contracts/taxonomy.ts`                | 1     |
| `src/domain/taxonomy/registry.ts`          | 2     |
| `src/domain/taxonomy/index.ts`             | 2     |
| `src/domain/taxonomy/freshness.ts`         | 3     |
| `src/domain/taxonomy/confidence.ts`        | 3     |
| `src/domain/taxonomy/provenance.ts`        | 3     |
| `src/domain/taxonomy/validation.ts`        | 3     |
| `drizzle/0001_add_taxonomy_columns.sql`    | 4     |
| `drizzle/meta/0001_snapshot.json`          | 4     |
| `tests/domain/taxonomy/registry.test.ts`   | 2     |
| `tests/domain/taxonomy/freshness.test.ts`  | 3     |
| `tests/domain/taxonomy/confidence.test.ts` | 3     |
| `tests/domain/taxonomy/provenance.test.ts` | 3     |
| `tests/domain/taxonomy/validation.test.ts` | 3     |

### Modified Files (18)

| File                                                       | Phase | Changes                                                            |
| ---------------------------------------------------------- | ----- | ------------------------------------------------------------------ |
| `src/contracts/index.ts`                                   | 1     | Add taxonomy barrel                                                |
| `.dependency-cruiser.cjs`                                  | 2,5   | Relax domain→contracts for taxonomy; add ports-no-domain rule      |
| `drizzle/meta/_journal.json`                               | 4     | Add 0001 migration entry                                           |
| `src/db/schema/normalized-observations.ts`                 | 4     | Add taxonomy columns, remove isFresh, add isStale                  |
| `src/db/schema/derived-features.ts`                        | 4     | Add taxonomy columns, remove inputLineage, add provenance          |
| `src/db/schema/evidence-bundles.ts`                        | 4     | Add taxonomy columns, remove inputLineage, add provenance          |
| `src/db/schema/research-briefs.ts`                         | 4     | Add taxonomy columns, remove confidence/sourceRefs, add provenance |
| `src/ports/observation-repo.ts`                            | 5     | Source type                                                        |
| `src/ports/normalized-observation-repo.ts`                 | 5     | Full taxonomy DTO update                                           |
| `src/ports/feature-repo.ts`                                | 5     | Full taxonomy DTO update                                           |
| `src/ports/bundle-repo.ts`                                 | 5     | Full taxonomy DTO update                                           |
| `src/ports/brief-repo.ts`                                  | 5     | Full taxonomy DTO update                                           |
| `src/adapters/node/drizzle-normalized-observation-repo.ts` | 6     | Bridge new fields                                                  |
| `src/adapters/node/drizzle-feature-repo.ts`                | 6     | Bridge new fields                                                  |
| `src/adapters/node/drizzle-bundle-repo.ts`                 | 6     | Bridge new fields                                                  |
| `src/adapters/node/drizzle-brief-repo.ts`                  | 6     | Bridge new fields                                                  |
| `tests/fakes/fake-normalized-observation-repo.ts`          | 6     | New fields                                                         |
| `tests/fakes/fake-feature-repo.ts`                         | 6     | New fields                                                         |
| `tests/fakes/fake-bundle-repo.ts`                          | 6     | New fields                                                         |
| `tests/fakes/fake-brief-repo.ts`                           | 6     | New fields                                                         |
| `tests/db/schema/normalized-observations.test.ts`          | 6     | New columns                                                        |
| `tests/db/schema/derived-features.test.ts`                 | 6     | New columns                                                        |
| `tests/db/schema/evidence-bundles.test.ts`                 | 6     | New columns                                                        |
| `tests/db/schema/research-briefs.test.ts`                  | 6     | New columns                                                        |
| `tests/ports/normalized-observation-repo.test.ts`          | 6     | Updated types                                                      |
| `tests/ports/feature-repo.test.ts`                         | 6     | Updated types                                                      |
| `tests/ports/bundle-repo.test.ts`                          | 6     | Updated types                                                      |
| `tests/ports/brief-repo.test.ts`                           | 6     | Updated types                                                      |
| `src/application/collect-backend-snapshot.ts`              | 7     | Verify kind name usage (file paths use hyphens, not DB kinds)      |

---

## Risk Mitigation

- **Phase 5→6 breakage:** Phase 5 will intentionally break adapters/fakes at typecheck level. Phase 6 immediately follows to fix them. No intermediate commit should be pushed with broken typecheck.
- **Migration idempotency:** All ALTER TABLE statements use `ADD IF NOT EXISTS`. Column additions are safe additive changes.
- **Backward compatibility:** Old columns (`is_fresh`, `input_lineage`, `confidence(varchar)`, `source_refs`) are dropped in the migration. No rolling back without a down-migration (not in scope).
- **Drizzle snapshot:** Must be manually updated to reflect post-0001 schema state. `drizzle-kit generate` may not work correctly for ALTER TABLE migrations.
