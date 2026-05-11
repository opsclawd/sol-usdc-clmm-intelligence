---
title: "INT-TAXONOMY #6: Signal taxonomy patterns — registries, confidence, freshness, provenance, and Drizzle JSONB/numeric bridges"
date: 2026-05-11
category: best-practices
module: contracts-taxonomy
problem_type: best_practice
component: database
severity: medium
applies_when:
  - adding new ObservationKind or FeatureKind to the taxonomy registry
  - creating DB migrations that alter column types or add JSONB columns
  - writing Drizzle adapters that map between numeric and number types
  - implementing validation logic that must never throw
  - extending evidence pipeline tables with structured metadata
tags:
  - taxonomy
  - drizzle
  - jsonb
  - numeric-cast
  - confidence-model
  - provenance
  - signal-class
  - freshness
---

# INT-TAXONOMY #6: Signal taxonomy patterns

## Context

The SOL/USDC CLMM intelligence pipeline had no canonical signal taxonomy. Observations, features, and bundles used ad-hoc string fields (`confidence` as varchar, `inputLineage` as jsonb, `isFresh` as boolean) with no shared vocabulary for signal class, evidence family, or staleness semantics. INT-TAXONOMY #6 introduced an entire cross-cutting concern — freshness policy, confidence model, provenance validation, and kind registries — without breaking the layered monolith boundaries (INT-ARCH #3) or the Drizzle adapter pattern.

## Guidance

### 1. Co-locate contract types in `src/contracts/`, pure functions in `src/domain/`

All taxonomy types live in `src/contracts/taxonomy.ts` with zero imports from domain or adapters. All computation (freshness, confidence, provenance validation) lives in `src/domain/taxonomy/*.ts` as pure functions with no I/O, no clock injection, no env reads. The clock (`nowMs`) is always an explicit parameter.

### 2. Registry pattern: `as const satisfies Record<Kind, Entry>`

Kind-specific policy is declared once, with TypeScript enforcing exhaustiveness:

```ts
export const observationKindRegistry = {
  pool_state: { kind: "pool_state", evidenceFamily: "clmm_state", ... },
  position_state: { kind: "position_state", evidenceFamily: "clmm_state", ... },
  price_quote: { kind: "price_quote", evidenceFamily: "price_quality", ... },
  fee_metrics: { kind: "fee_metrics", evidenceFamily: "clmm_economics", ... },
  volume_metrics: { kind: "volume_metrics", evidenceFamily: "clmm_economics", ... }
} as const satisfies Record<ObservationKind, ObservationKindEntry>;
```

Adding a new `ObservationKind` union member without a registry entry is a compile error. This eliminates the "forgot to wire up the new kind" class of bugs.

### 3. Result-type validation: never throw for provenance

`validateProvenance` returns `{ valid: true } | { valid: false; reasons: readonly ProvenanceValidationError[] }`. Callers decide what to do with failures — strip, degrade, or flag. This matches the pipeline's default posture: missing data produces no bundle rather than a crash.

```ts
export type ProvenanceValidationResult =
  | { valid: true }
  | { valid: false; reasons: readonly ProvenanceValidationError[] };
```

### 4. Confidence: weighted composite with LLM redistribution

`computeConfidence` takes components + a `ConfidencePolicy` that includes weights and a `redistributeLlmWeight` flag. When `llmConfidence` is null and redistribution is on, the LLM weight fraction is rescaled across the remaining three components. Stale degradation is applied as a multiplicative factor after composite computation, keeping the two concerns separate.

### 5. Freshness: `isStale` inverts the old `isFresh`

`isStale: boolean` follows the "name booleans for the danger case" convention — `if (isStale)` reads better than `if (!isFresh)`. The `computeFreshness` function throws `FreshnessValidationError` on timestamp sanity violations but returns a result with `isStale: true` for natural staleness.

### 6. Drizzle JSONB/numeric bridge pattern

Drizzle represents `numeric(p,s)` columns as strings at runtime. Adapter `toPortRow()` must `Number()` on read; inserts must `String()` on write. JSONB columns holding structured objects need `as unknown` to bridge Drizzle's type narrowing:

```ts
// Reading from DB (toPortRow)
confidenceComposite: row.confidenceComposite ? Number(row.confidenceComposite) : null,
confidence: row.confidence as unknown as Confidence,

// Writing to DB (insert values)
confidenceComposite: row.confidenceComposite != null ? String(row.confidenceComposite) : null,
confidence: row.confidence as unknown,
```

### 7. Snake_case for kind identifiers

Use `pool_state`, `fee_apr`, `oracle_divergence` — not kebab-case like `fee-apr`. This aligns with TypeScript identifier ergonomics and SQL column naming conventions simultaneously.

### 8. EvidenceFamily: 9 defined, 3 active

The contract defines all 9 families for forward compatibility, but only `clmm_state`, `price_quality`, and `clmm_economics` have active registry entries. `active: boolean` on each entry lets you add future families to the union type without wiring them into the pipeline until they're ready.

## Why This Matters

- **Exhaustiveness** is enforced at compile time. Adding a kind without a registry entry or a component without a policy is a type error, not a runtime surprise.
- **Pure functions** in domain make the taxonomy logic trivially testable (no mocks, no DB, no clock). All 4 domain modules have deterministic tests.
- **Result types over exceptions** for provenance means the pipeline's "produce no bundle on degradation" posture is naturally expressible without try/catch sprawl.
- **Inverted polarity** (`isStale` not `isFresh`) follows the "name booleans for the danger case" convention.
- **Numeric/string bridge** is a Drizzle gotcha that will bite every adapter writer. Documenting it prevents silent data corruption bugs.

## When to Apply

- When extending the taxonomy with new `ObservationKind` or `FeatureKind` values — add to both the union type and the registry.
- When adding new `EvidenceFamily` values — define them in the contract, add registry entries only when active.
- When adding new DB columns that hold structured JSON — use the `as unknown` bridge pattern.
- When writing adapter `toPortRow`/`toDbRow` for `numeric(p,s)` columns — always `Number()`/`String()`.
- When building new validation logic — prefer result types over throws for expected failure modes.
- When extending pipeline tables (INT-CORE #7, INT-FEATURES #8) — consume the taxonomy types from `src/contracts/taxonomy.ts`.

## Examples

### Registry exhaustiveness enforcement

```ts
// Adding a new ObservationKind to the union without a registry entry:
// type ObservationKind = ... | "pool_tvl"
// ❌ Compile error: 'pool_tvl' is missing from observationKindRegistry

// Correct: add both the union member AND the registry entry:
export const observationKindRegistry = {
  pool_state: { ... },
  // ... existing entries
  pool_tvl: { kind: "pool_tvl", evidenceFamily: "clmm_state", signalClass: "deterministic", ... }
} as const satisfies Record<ObservationKind, ObservationKindEntry>;
```

### Drizzle numeric bridge in adapter

```ts
// toPortRow — DB strings → domain numbers/objects
compositeScore: row.confidenceComposite ? Number(row.confidenceComposite) : null,
confidence: row.confidence as unknown as Confidence,

// insert — domain numbers → DB strings
confidenceComposite: row.confidenceComposite != null ? String(row.confidenceComposite) : null,
confidence: row.confidence as unknown,
```

### Provenance validation (result type, no throw)

```ts
const result = validateProvenance(provenance, requirements, "normalized_observation");
if (!result.valid) {
  // result.reasons: readonly ProvenanceValidationError[]
  // Caller decides: strip offending refs, degrade confidence, or discard bundle
}
```

## Related

- [Drizzle Persistence Infrastructure](../database-issues/drizzle-persistence-infrastructure-2026-05-10.md) — schema conventions, FK constraints, role provisioning
- [Script-first to Layered Monolith Refactor](script-first-to-layered-monolith-refactor-2026-05-10.md) — architectural layering that taxonomy modules follow
- [Replace Legacy Collector with Bundle Consumer](replace-legacy-multi-call-collector-with-bundle-consumer-2026-05-10.md) — ClmmBundle is the canonical `"clmm-v2-bundle"` Source in the taxonomy registry
- GitHub #5 (INT-PERSIST) — DB persistence layer that taxonomy columns extend
- GitHub #7 (INT-CORE) — will consume ObservationKind, Source, Provenance, and Freshness types
- GitHub #8 (INT-FEATURES) — will consume FeatureKind, Confidence, and Provenance types
- GitHub #12 (INT-BRIEFS) — will consume TaxonomySummary, SignalClass, EvidenceFamily
- GitHub #13 (INT-PUBLISH) — will consume TaxonomySummary, Provenance, Confidence for bundle publication
