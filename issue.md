# assemble:bundle: unresolved inputLineage references and missing required assessment warnings

## Goal

Fix the remaining contract-compliance gaps in `pnpm assemble:bundle`, discovered while verifying it end-to-end on the deployment target after fixing #61, #62 (lineage), and #63 (timestamp format). With all three of those fixed, assembly still fails `CONTRACT_ERROR` on two distinct, unrelated issues.

## Findings

Live-verified via a debug script calling `assembleEvidenceBundleJob` directly against the deployed database, after clearing test data and running a fresh `collect:core` → `derive:mvp` cycle:

**1. Unresolved `inputLineage` references** — every deterministic feature fails validation:

```
"Unresolved lineage reference: row-1" at /deterministicFeatures/feat-range_location-1/inputLineage
"Unresolved lineage reference: row-2" at /deterministicFeatures/feat-distance_to_lower-2/inputLineage
... (one per feature, including "missing" for unavailable features like feat-oi_trend_4h-missing)
```

`buildDeterministicFeature` (`src/domain/evidence-bundle/assemble.ts`) sets `inputLineage: [`row-${rowId}`]`, but nothing in the bundle appears to register a matching `sourceReferences` entry with a resolvable ID for these `row-N` references — the pinned contract schema apparently requires `inputLineage` entries to resolve against `sourceReferences`/lineage IDs actually present in the bundle.

**2. Missing required assessment warnings** — when `contextPresent`/`briefPresent` are false (the common case when context/perp/on-chain-flow collectors haven't populated data for a given evaluation window, or a research brief hasn't been generated):

```
"Missing CONTEXTUAL_EVIDENCE_UNAVAILABLE warning" at /assessment/warnings
"Missing RESEARCH_BRIEF_UNAVAILABLE warning" at /assessment/warnings
```

The pinned contract apparently requires these specific warning codes in `assessment.warnings` under these conditions, but `buildBundleAssessment`/`buildBundleProvenance` (or wherever `quality.warnings` is populated) doesn't add them.

## Context

This is likely because `assemble:bundle` has essentially never been exercised end-to-end against real, non-synthetic data before — it's not wired into any scheduled cron job (`cron/jobs.yaml` only runs `context-events`, `news-evidence`, `on-chain-flow`, `perp-liquidation`), and existing unit tests use fixtures that don't exercise the pinned contract schema's stricter cross-referencing rules.

## Acceptance Criteria

- `pnpm assemble:bundle <request>` succeeds (or fails only for genuine data-availability reasons, not contract-shape violations) against a real evaluation window with a mix of available/unavailable features and no context/brief present.
- Every `inputLineage` reference in a deterministic feature resolves against the bundle's own lineage/source-reference data.
- `assessment.warnings` includes `CONTEXTUAL_EVIDENCE_UNAVAILABLE` and `RESEARCH_BRIEF_UNAVAILABLE` whenever `contextPresent`/`briefPresent` are false, matching whatever the pinned `evidence-bundle.v1` schema actually requires.
- Regression tests added for both, following the pattern established in #61/#62/#63 (a real bug the existing fixtures didn't catch — verify any new test actually fails against the pre-fix code).

## Open Questions

None.
