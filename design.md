# Design Document: Fix assemble:bundle Validation Errors

## The Problem Being Solved and Why It Matters

The `pnpm assemble:bundle` process fails end-to-end validation against the strict `evidence-bundle.v1` JSON contract schema due to two independent issues:

1. **Unresolved `inputLineage` references:** `buildDeterministicFeature` blindly assigns `["row-${rowId}"]` (and `["missing"]` for missing features) to the `inputLineage` field. The strict schema requires every ID in `inputLineage` to resolve to a valid `referenceId` present in the bundle's `sourceReferences` array. Currently, `sourceReferences` only registers `raw-N` IDs (raw external sources), causing resolution failures for the internal `row-N` IDs.
2. **Missing required assessment warnings:** When context or research briefs are missing, the `quality.ts` module fails to emit the required warning codes (`CONTEXTUAL_EVIDENCE_UNAVAILABLE` and `RESEARCH_BRIEF_UNAVAILABLE`), which the contract expects.

Fixing this is critical because the pipeline cannot produce usable evidence bundles for downstream consumers (like `regime-engine`) without conforming strictly to the evidence contract.

## Key Design Decisions and Trade-offs Considered

### Issue 1: Resolving `inputLineage`

- **Option A: Register `row-N` and `missing` as internal bundle sources.**
  We could simply add every derived feature's row ID to the `sourceReferences` array as an `internal_bundle` source type.
  _Trade-offs:_ Easiest to implement. However, it pollutes the evidence bundle's source references with internal database row IDs, obscuring the actual raw external data sources.
- **Option B: Precise raw-source tracking per feature.**
  Update `verifyEvidenceLineage` to return a mapping of `featureKind -> raw-N IDs` and use this in `buildDeterministicFeature`.
  _Trade-offs:_ Most architecturally pure, as features correctly point to the exact external facts they derived from. However, it requires modifying the `VerifiedEvidenceLineage` domain interface and adds complexity.
- **Option C: Global raw-source fallback with an explicit unavailable reference.** (Recommended)
  Assign the complete list of the bundle's external `raw-N` source IDs to the `inputLineage` of all available deterministic features. For missing features, we define a canonical `feature_unavailable` reference in `sourceReferences` and point to it.
  _Trade-offs:_ Pragmatic. It properly points features to external sources (satisfying downstream needs) without overcomplicating the domain boundaries for a 1-to-1 exact mapping.

### Issue 2: Injecting Required Assessment Warnings

- **Option A:** Add the warnings inside `assemble.ts` during bundle synthesis.
- **Option B:** Add the warnings inside `quality.ts` (specifically `buildWarnings`), where all other bundle quality warnings are constructed. (Recommended)
  _Trade-offs:_ `quality.ts` is the authoritative domain module for assessing evidence completeness. It already receives `contextPresent` and `briefPresent` as arguments, making it the perfect place to emit these warnings.

## Proposed Approach with Rationale

### 1. Fix Lineage Resolution (Option C)

- Update `assemble.ts` to extract all `referenceId`s from the generated `sourceReferences`.
- In `buildDeterministicFeature`, if the feature is `available` or `partial`, assign its `inputLineage` to the collected array of bundle source IDs.
- For `missing` or `unavailable` features, we need a resolvable reference. We will inject a distinct source reference into the bundle: `{ referenceId: "feature_unavailable", sourceType: "internal_bundle", locator: "unavailable", observedAt: <timestamp> }`.
- Missing features will assign `["feature_unavailable"]` to their `inputLineage`.
- _Rationale:_ This ensures perfect schema resolution while pointing downstream consumers to the actual raw facts (the `raw-N` IDs) rather than internal database artifacts.

### 2. Fix Assessment Warnings

- Update `buildWarnings` in `src/domain/evidence-bundle/quality.ts` to explicitly check `contextPresent` and `briefPresent`.
- If `!contextPresent`, push a warning object with `code: "CONTEXTUAL_EVIDENCE_UNAVAILABLE"`.
- If `!briefPresent`, push a warning object with `code: "RESEARCH_BRIEF_UNAVAILABLE"`.
- _Rationale:_ This centralizes all quality and completeness logic within the domain boundaries established in `quality.ts`.

## Assumptions Made

1. Downstream consumers (`regime-engine`) do not require 1-to-1 exact tracking of which specific `raw-N` observation produced which deterministic feature, as long as the feature points to valid external sources within the bundle.
2. The schema allows `"internal_bundle"` as a `sourceType` for placeholder lineage references (like `"feature_unavailable"`).
3. The exact phrasing of the missing assessment warnings (`affectedFamilies`, `message` text) does not need to match a strict enum outside of the `code` itself.

## What is in Scope and Explicitly Out of Scope

**In Scope:**

- Modifying `assemble.ts` to correctly populate `inputLineage` with resolvable IDs.
- Adding `"feature_unavailable"` to `sourceReferences` for missing features.
- Modifying `quality.ts` to append required context and brief warnings.
- Writing regression tests that verify the new behavior against the schema.

**Out of Scope:**

- Changing the database schema or `DerivedFeatureRow` definitions.
- Refactoring `lineage.ts` to produce precise sub-graph mappings of feature-to-raw lineage.
- Making policy decisions about how `regime-engine` interprets these warnings.

## Risks or Concerns Identified from Code Analysis

- **Missing slot schema compliance:** `inputLineage` in the strict contract schema is typed as a tuple with at least one element (`[Identifier128, ...Identifier128[]]`). By using `"feature_unavailable"`, we ensure we never pass an empty array, which would cause an independent schema validation error.
- **Global source referencing:** If a bundle aggregates a massive number of raw observations (e.g., hundreds), copying all those IDs into the `inputLineage` of every single deterministic feature might bloat the JSON payload. However, since evaluation windows are scoped and limited, the number of sources per bundle is expected to be small.
