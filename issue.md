# feat: assemble and persist deterministic EvidenceBundle v1

## Summary

Assemble and persist a strict, versioned deterministic-only `EvidenceBundle v1` from the current normalized observations and derived features, using the canonical Regime Engine evidence contract.

This is a PR-sized child of #13. It ends at durable bundle creation inside the intelligence repository. It does not send HTTP requests to Regime Engine, implement publish retries, create publish-attempt records, generate an LLM brief, or synthesize final `PolicyInsight` output.

## Why

Bundle assembly and outbound publishing are distinct concerns. Separating them provides a stable, replayable evidence artifact that can be validated against the Regime Engine contract before network behavior is introduced. It also lets the deterministic vertical slice proceed without waiting for contextual collector packs or LLM research briefs.

## Canonical contract dependency

The implementation must consume the exact machine-readable contract delivered by `opsclawd/regime-engine#58`.

Before this issue is executed, update this issue body with:

```text
Regime Engine contract commit: <merged SHA>
Schema path: <repository-relative path>
Schema version: evidence-bundle.v1
Schema SHA-256: <hash>
Valid fixture path: <repository-relative path>
```

Do not infer or recreate the downstream schema from prose. The Regime Engine JSON Schema and fixtures are the contract source of truth.

## Required deterministic-only semantics

`EvidenceBundle v1` must support the initial vertical slice without contextual or LLM evidence:

- deterministic features are present when available;
- contextual evidence collections may be empty;
- contextual evidence sections may use the canonical unavailable/empty representation defined by the Regime Engine contract;
- `researchBrief` must be nullable or use the canonical explicit unavailable representation;
- absence of a research brief must not prevent bundle validation, persistence, or later publishing;
- quality/coverage metadata must state that contextual and LLM evidence are absent rather than pretending the bundle is fully comprehensive.

## Bundle input selection

Add an application use case that selects the evidence inputs deterministically for one SOL/USDC position context.

Selection must account for:

- pair identity;
- wallet/position/Whirlpool identity where required by the canonical schema;
- supported feature kinds and calculator versions;
- freshness and expiry;
- latest valid feature result with deterministic tie-breaking;
- explicit inclusion of `AVAILABLE` features;
- documented handling of `PARTIAL` and `UNAVAILABLE` features;
- source coverage and missing-feature warnings;
- complete input lineage.

The initial required feature coverage is the seven-feature tranche from #25:

- `RANGE_LOCATION`;
- `DISTANCE_TO_LOWER`;
- `DISTANCE_TO_UPPER`;
- `ORACLE_DEX_DIVERGENCE`;
- `ORACLE_CONFIDENCE_WIDTH`;
- `REALIZED_VOLATILITY_1H`;
- `VOLUME_LIQUIDITY_RATIO_24H`.

A missing feature must produce explicit degraded/partial coverage according to deterministic rules; it must not be replaced with zero.

## Bundle identity and hashing

Define and document deterministic bundle identity using the canonical Regime Engine contract semantics.

At minimum preserve:

- `schemaVersion`;
- source identity;
- run/correlation identity;
- pair;
- position context when required;
- `asOf`, creation, and expiry timestamps;
- deterministic feature summaries;
- quality, confidence, freshness, coverage, and warnings;
- source refs/provenance;
- raw observation IDs, normalized observation IDs, and derived feature IDs or their canonical lineage representation;
- canonical payload hash;
- deterministic idempotency identity.

Canonicalization and hashing must exactly match the Regime Engine contract. The implementation must not invent a repository-local hash algorithm that the ingest service cannot reproduce.

## Quality and coverage

Compute bundle quality deterministically from the selected feature results and the canonical contract rules.

The bundle must distinguish at least:

- complete deterministic feature coverage;
- partial feature coverage;
- stale/expired inputs;
- unavailable feature inputs;
- absent contextual evidence;
- absent research brief;
- contract-invalid state.

Any aggregate confidence or coverage score must be reproducible from documented inputs and rules. Do not use an LLM to assign quality or confidence.

## Persistence and idempotency

- Persist the complete validated bundle in `evidence_bundles`.
- Preserve the exact canonical payload used to calculate the hash.
- Rebuilding a bundle from the same schema version, source/run identity, position context, selected inputs, and payload must be idempotent or deterministically deduplicated.
- The same logical idempotency identity with different canonical content must produce an explicit conflict rather than overwrite the prior bundle.
- Changed inputs or a changed schema/calculator version must remain historically auditable.

## Validation

Bundle creation must validate against the pinned Regime Engine JSON Schema before persistence.

Tests must consume the canonical valid and invalid fixtures from Regime Engine or a pinned exact copy with documented provenance. Avoid parallel handwritten validation rules that can drift from the schema.

## Scope

In scope:

- deterministic bundle input selection;
- mapping derived features and lineage into the canonical `EvidenceBundle v1` contract;
- empty/unavailable contextual-evidence handling;
- nullable/unavailable research-brief handling;
- deterministic quality/coverage calculation;
- canonical serialization and hashing;
- JSON Schema validation;
- evidence-bundle persistence and idempotency/conflict handling;
- fixtures, tests, docs, and replay examples.

Out of scope:

- outbound HTTP publishing;
- authentication headers or Regime Engine endpoint configuration;
- retry/backoff behavior;
- `publish_attempts` persistence;
- LLM research-brief generation;
- contextual collector packs;
- evidence selection or final policy synthesis inside Regime Engine;
- clmm-v2 UI or execution behavior.

## Guardrails

- Publish evidence, never final `PolicyInsight` output.
- Bundle assembly reads persisted normalized/derived data; it does not call source APIs directly.
- The Regime Engine schema is the contract authority.
- Missing evidence remains explicitly missing/degraded, never fabricated.
- A research brief is optional for the deterministic MVP bundle.
- Bundle creation introduces no execution authority.

## Acceptance criteria

- [ ] The implementation is pinned to the merged Regime Engine `EvidenceBundle v1` JSON Schema, commit, path, and hash recorded in this issue.
- [ ] A deterministic-only bundle with empty contextual evidence and no research brief validates successfully under the canonical contract.
- [ ] The seven #25 feature kinds are selected and mapped deterministically when fresh and available.
- [ ] Missing, partial, stale, and unavailable feature inputs produce explicit coverage/quality warnings and never fake zero values.
- [ ] Bundle timestamps, expiry, confidence, coverage, provenance, source refs, and lineage are populated deterministically.
- [ ] Canonical serialization and payload hashing match the Regime Engine fixtures/contract tests.
- [ ] The complete schema-valid bundle is persisted in `evidence_bundles`.
- [ ] Identical rebuilds are idempotent or deterministically deduplicated, while conflicting content for the same idempotency identity is rejected explicitly.
- [ ] Tests cover complete deterministic coverage, one missing feature, multiple missing features, stale feature input, unavailable feature input, nullable brief, empty contextual evidence, exact replay, conflicting replay, schema mismatch, and invalid canonical fixture.
- [ ] No outbound HTTP publisher or LLM call is introduced.

## Parent

Child of #13.

## Blocked by

- #25
- opsclawd/regime-engine#58

The publisher in parent #13 must later consume the persisted bundle produced here rather than rebuilding evidence ad hoc during an HTTP request.
