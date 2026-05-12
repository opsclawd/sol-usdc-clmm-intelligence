# INT-TAXONOMY #6: Evidence Taxonomy, Freshness, Confidence, and Provenance

**Issue:** opsclawd/sol-usdc-clmm-intelligence#6
**Status:** Design
**Blocks:** INT-CORE #7, INT-FEATURES #8, INT-CONTEXT-A #9, INT-FLOW-B #10, INT-PERP-C #11
**Blocked by:** INT-PERSIST #5 (complete), INT-ARCH #3 (complete)

## Summary

Define the canonical signal taxonomy, freshness policy, confidence model, and provenance requirements that all collectors, features, and research briefs must satisfy. Replace raw strings in domain and ports with validated typed constructs. All writes pass through typed constructors and validation schemas. DB columns for stable enums get CHECK constraints; extensible kinds remain app-validated varchar.

## Approach

Central Registry Module (Approach A):

- Types and shared interfaces in `src/contracts/taxonomy.ts`
- Registry and policy enforcement in `src/domain/taxonomy/`
- Pure functions for freshness, confidence, provenance, and validation
- No JSON/YAML registry
- No policy logic in contracts
- New kinds require code + tests + PR

---

## 1. Type System (`src/contracts/taxonomy.ts`)

### 1.1 Stable Closed Enums (DB CHECK-enforced)

```ts
export type EvidenceFamily =
  | "clmm_state"
  | "price_quality"
  | "clmm_economics"
  | "execution_safety"
  | "market_regime"
  | "support_resistance"
  | "on_chain_flow"
  | "perp_liquidation"
  | "macro_protocol_risk";

export type SignalClass = "deterministic" | "probabilistic" | "contextual";

export type ConfidenceLevel = "low" | "medium" | "high";

export type StaleBehavior = "exclude" | "degrade_confidence" | "allow_context_only";
```

**Classification rules:**

- `deterministic` — directly observed facts or exact derivations from deterministic inputs (pool state, price feeds, fee math)
- `probabilistic` — calibrated likelihoods, forecasts, distributions, statistical estimates, or model outputs about uncertain future/current state (reserved, no active entries)
- `contextual` — narrative, LLM/research-derived interpretation, qualitative risk, macro/protocol/event context, or uncalibrated heuristic judgment

Derived artifacts inherit the weakest/most uncertain relevant class unless a registry entry explicitly defines otherwise.

### 1.2 Extensible Open Kinds (App-validated, no DB CHECK)

```ts
export type ObservationKind =
  | "pool_state"
  | "position_state"
  | "price_quote"
  | "fee_metrics"
  | "volume_metrics";

export type FeatureKind = "fee_apr" | "oracle_divergence" | "volatility_24h" | "liquidity_depth";
```

New kinds are added by appending to the union type, adding a registry entry, and submitting a PR with tests.

### 1.3 Source

```ts
export type Source =
  | "clmm-v2-bundle"
  | "jupiter-price"
  | "jupiter-price-v3"
  | "coingecko"
  | "defillama";
```

### 1.4 Provenance Types

```ts
export type ProvenanceRefType =
  | "raw_observation"
  | "normalized_observation"
  | "derived_feature"
  | "evidence_bundle"
  | "research_brief";

export interface ProvenanceRef {
  readonly refType: ProvenanceRefType;
  readonly id: number;
  readonly source: Source;
  readonly payloadHash: string;
}

export interface ProcessRef {
  readonly collector: string;
  readonly jobName: string;
  readonly pipelineRunId: string | null;
  readonly codeVersion: string | null;
  readonly modelVersion: string | null;
}

export interface Provenance {
  readonly sourceRefs: readonly ProvenanceRef[];
  readonly rawObservationRefs: readonly ProvenanceRef[];
  readonly derivedFromRefs: readonly ProvenanceRef[];
  readonly processRef: ProcessRef;
  readonly codeVersion: string;
  readonly runId: string | null;
}
```

### 1.5 Confidence Types

```ts
export interface ConfidenceComponents {
  readonly sourceReliability: number; // 0..1
  readonly dataCompleteness: number; // 0..1
  readonly derivationConfidence: number; // 0..1
  readonly llmConfidence: number | null; // 0..1, null for non-LLM
}

export interface ConfidenceWeights {
  readonly sourceReliability: number; // 0..1 weight
  readonly dataCompleteness: number; // 0..1 weight
  readonly derivationConfidence: number; // 0..1 weight
  readonly llmConfidence: number; // 0..1 weight, must be 0 for non-LLM
}

export interface ConfidencePolicy {
  readonly weights: ConfidenceWeights;
  readonly thresholds: ConfidenceThresholds;
  readonly redistributeLlmWeight: boolean;
}

export interface ConfidenceThresholds {
  readonly lowBelow: number; // composite < lowBelow → "low"
  readonly highAtOrAbove: number; // composite >= highAtOrAbove → "high"
  // between → "medium"
}

export type ConfidenceReason =
  | "llm_weight_redistributed"
  | "source_reliability_low"
  | "data_completeness_low"
  | "derivation_confidence_low"
  | "stale_input_degraded"
  | "required_component_missing"
  | "llm_confidence_required_but_null";

export interface Confidence {
  readonly components: ConfidenceComponents;
  readonly compositeScore: number; // derived 0..1
  readonly level: ConfidenceLevel; // derived
  readonly weightingVersion: string;
  readonly reasons: readonly ConfidenceReason[];
}
```

### 1.6 Freshness Types

```ts
export interface FreshnessPolicy {
  readonly maxObservedAgeMs: number;
  readonly maxFetchLagMs: number | null;
  readonly validForMs: number | null;
  readonly clockSkewToleranceMs: number;
  readonly staleBehavior: StaleBehavior;
}

export type FreshnessReason =
  | "expired_past_max_observed_age"
  | "expired_past_valid_for"
  | "expired_past_source_valid_until"
  | "fetch_lag_exceeded"
  | "clock_skew_violation";

export interface Freshness {
  readonly isStale: boolean;
  readonly validUntilUnixMs: number;
  readonly derivedAt: number;
  readonly policyKind: ObservationKind | FeatureKind;
  readonly reasons: readonly FreshnessReason[];
}
```

### 1.7 Provenance Requirements

```ts
export interface ProvenanceRequirements {
  readonly minRawObservationRefs: number;
  readonly minDerivedFromRefs: number;
  readonly minSourceRefs: number;
  readonly requireProcessRef: boolean;
  readonly requireCodeVersion: boolean;
  readonly requireRunId: boolean;
  readonly allowedSourceRefs: readonly Source[];
}

export type ProvenanceValidationError =
  | "insufficient_raw_observation_refs"
  | "insufficient_derived_from_refs"
  | "insufficient_source_refs"
  | "missing_process_ref"
  | "missing_code_version"
  | "missing_run_id"
  | "disallowed_source"
  | "empty_provenance";
```

### 1.8 Registry Entry Interfaces

```ts
export interface ObservationKindEntry {
  readonly kind: ObservationKind;
  readonly evidenceFamily: EvidenceFamily;
  readonly signalClass: SignalClass;
  readonly source: Source;
  readonly freshnessPolicy: FreshnessPolicy;
  readonly confidencePolicy: ConfidencePolicy;
  readonly provenanceRequirements: ProvenanceRequirements;
  readonly active: boolean;
  readonly schemaVersion: number;
}

export interface FeatureKindEntry {
  readonly kind: FeatureKind;
  readonly evidenceFamily: EvidenceFamily;
  readonly signalClass: SignalClass;
  readonly freshnessPolicy: FreshnessPolicy;
  readonly confidencePolicy: ConfidencePolicy;
  readonly provenanceRequirements: ProvenanceRequirements;
  readonly active: boolean;
  readonly schemaVersion: number;
}
```

---

## 2. Registry (`src/domain/taxonomy/registry.ts`)

### 2.1 Structure

Uses `as const satisfies Record<Kind, Entry>` for compile-time exhaustiveness. Not a Map. Each entry's `kind` field must match its object key.

### 2.2 Active Observation Kinds (3 families)

| Kind             | Family           | Signal Class    | Source             | maxObservedAgeMs | Stale Behavior       |
| ---------------- | ---------------- | --------------- | ------------------ | ---------------- | -------------------- |
| `pool_state`     | `clmm_state`     | `deterministic` | `clmm-v2-bundle`   | 60,000           | `exclude`            |
| `position_state` | `clmm_state`     | `deterministic` | `clmm-v2-bundle`   | 60,000           | `exclude`            |
| `price_quote`    | `price_quality`  | `deterministic` | `jupiter-price-v3` | 30,000           | `degrade_confidence` |
| `fee_metrics`    | `clmm_economics` | `deterministic` | `clmm-v2-bundle`   | 300,000          | `degrade_confidence` |
| `volume_metrics` | `clmm_economics` | `deterministic` | `clmm-v2-bundle`   | 300,000          | `degrade_confidence` |

### 2.3 Active Feature Kinds (3 families)

| Kind                | Family           | Signal Class    | Stale Behavior       |
| ------------------- | ---------------- | --------------- | -------------------- |
| `fee_apr`           | `clmm_economics` | `deterministic` | `degrade_confidence` |
| `oracle_divergence` | `price_quality`  | `deterministic` | `degrade_confidence` |
| `volatility_24h`    | `price_quality`  | `deterministic` | `allow_context_only` |
| `liquidity_depth`   | `clmm_state`     | `deterministic` | `exclude`            |

### 2.4 Reserved Families

The `EvidenceFamily` union includes 6 additional families (`execution_safety`, `market_regime`, `support_resistance`, `on_chain_flow`, `perp_liquidation`, `macro_protocol_risk`) with no registry entries yet. These are added in future issues with their own ObservationKind/FeatureKind entries.

---

## 3. Freshness Policy (`src/domain/taxonomy/freshness.ts`)

### 3.1 Core Function

```ts
export function computeFreshness(
  timestamps: {
    observedAtUnixMs: number;
    fetchedAtUnixMs: number;
    receivedAtUnixMs: number;
    sourceValidUntilUnixMs?: number;
  },
  policy: FreshnessPolicy,
  nowMs: number
): Freshness | FreshnessValidationError;
```

### 3.2 Derivation Rules

1. **Timestamp sanity**: If `observedAt > nowMs + policy.clockSkewToleranceMs` or `fetchedAt < observedAt - policy.clockSkewToleranceMs` or `receivedAtUnixMs < fetchedAt - policy.clockSkewToleranceMs`, throw `FreshnessValidationError` (impossible state).

2. **validUntil derivation**: `validUntil = min(observedAt + maxObservedAgeMs, fetchedAt + validForMs?, sourceValidUntil?)`. When `validForMs` or `sourceValidUntil` are undefined, they are **ignored** (not treated as zero). If both are undefined, `validUntil = observedAt + maxObservedAgeMs`.

3. **isStale**: `nowMs > validUntil`

4. **fetchLag check**: If `maxFetchLagMs` is defined and `fetchedAt - observedAt > maxFetchLagMs`, stale with reason `"fetch_lag_exceeded"`.

5. **staleBehavior**: From the policy, not computed. Carried on the `Freshness` result for consumers.

6. **policyKind**: Carried in output for audit/debugging.

### 3.3 Result Type

- **Impossible timestamp states** → `FreshnessValidationError` (thrown)
- **Freshness failures** (expired, fetch lag) → `Freshness` with `isStale: true` and reason codes
- **Fresh data** → `Freshness` with `isStale: false`, empty reasons

---

## 4. Confidence Policy (`src/domain/taxonomy/confidence.ts`)

### 4.1 Core Function

```ts
export function computeConfidence(
  components: ConfidenceComponents,
  policy: ConfidencePolicy,
  weightingVersion: string,
  staleDegradation?: { readonly factor: number }
): Confidence | ConfidenceValidationError;
```

### 4.2 Derivation Rules

1. **Weight sum validation**: Weights must sum to 1.0 within epsilon (1e-9). If `redistributeLlmWeight` is false and `llmConfidence` is null while `weights.llmConfidence > 0`, throw error. If `redistributeLlmWeight` is true and `llmConfidence` is null, redistribute that weight proportionally among the other 3 components.

2. **Composite score**: Weighted average of present components. If `llmConfidence` is null and weight is redistributed, compute over the remaining three.

3. **Level**: Ternary from `ConfidenceThresholds` in the policy entry. Default thresholds: `lowBelow: 0.4`, `highAtOrAbove: 0.7`.

4. **Reason codes**: Typed `ConfidenceReason` union. Collected during computation (e.g., `"llm_weight_redistributed"`, `"source_reliability_low"` when any component < 0.3).

5. **Stale degradation**: Optional input. If provided, `factor` must be in [0, 1] (validated). Composite is multiplied by factor, `"stale_input_degraded"` added to reasons.

6. **Component range validation**: All component values must be in [0, 1] (null only for `llmConfidence`). Weight values must be in [0, 1]. Violations throw `ConfidenceValidationError`.

---

## 5. Provenance Validation (`src/domain/taxonomy/provenance.ts`)

### 5.1 Core Function

```ts
export type ArtifactKind = ObservationKind | FeatureKind | "evidence_bundle" | "research_brief";

export function validateProvenance(
  provenance: {
    sourceRefs: readonly ProvenanceRef[];
    rawObservationRefs: readonly ProvenanceRef[];
    derivedFromRefs: readonly ProvenanceRef[];
    processRef: ProcessRef;
    codeVersion: string;
    runId: string | null;
  },
  requirements: ProvenanceRequirements,
  artifactKind: ArtifactKind
): ProvenanceValidationResult;

export type ProvenanceValidationResult =
  | { valid: true }
  | { valid: false; reasons: readonly ProvenanceValidationError[] };
```

### 5.2 Behavior

- Returns result type, never throws. Provenance validation failures are data quality issues, not program errors.
- `allowedSourceRefs`: Only listed sources can produce this artifact kind. E.g., `pool_state` observations must come from `clmm-v2-bundle`.
- `minRawObservationRefs`, `minDerivedFromRefs`, `minSourceRefs`: Minimum reference counts enforced. Features derived from observations must reference them.
- `requireProcessRef`, `requireCodeVersion`, `requireRunId`: When true, these fields must be non-null. Process and code version are required for all generated artifacts.
- Application use cases treat `valid: false` as **hard write rejection** — no persistence if provenance validation fails.

---

## 6. Validation Module (`src/domain/taxonomy/validation.ts`)

### 6.1 Parse Functions (I/O Boundary)

```ts
export function parseObservationKind(raw: string): ObservationKind;
export function parseFeatureKind(raw: string): FeatureKind;
export function parseSource(raw: string): Source;
export function parseSignalClass(raw: string): SignalClass;
export function parseEvidenceFamily(raw: string): EvidenceFamily;
export function parseConfidenceLevel(raw: string): ConfidenceLevel;
export function parseStaleBehavior(raw: string): StaleBehavior;
```

These throw `TaxonomyValidationError` for unknown values. They are used at I/O boundaries (DB reads, JSON parsing) to convert raw strings to typed values. Internally, code works with union types directly — no re-validation.

### 6.2 Registry Self-Validation Tests

- Every `ObservationKind` in the union type has a registry entry
- Every `FeatureKind` in the union type has a registry entry
- Every entry's `kind` field matches its object key
- Every entry's `source` is a valid `Source`
- Every entry's `evidenceFamily` is a valid `EvidenceFamily`
- Every entry's `signalClass` is a valid `SignalClass`
- Only active entries are used at runtime (inactive ones exist for reserved kinds)

---

## 7. DB Migration

### 7.1 New Columns

**`normalized_observations`:**

- `signal_class VARCHAR(16) NOT NULL` — CHECK: `'deterministic'`, `'probabilistic'`, `'contextual'`
- `evidence_family VARCHAR(32) NOT NULL` — CHECK: the 9 families
- `observation_kind VARCHAR(64) NOT NULL` — no CHECK (extensible)
- `confidence JSONB NOT NULL DEFAULT '{}'::jsonb` — full confidence object
- `confidence_composite NUMERIC(5,4)` — materialized, CHECK `(confidence_composite >= 0 AND confidence_composite <= 1)`
- `confidence_level VARCHAR(8)` — materialized, CHECK: `'low'`, `'medium'`, `'high'`
- `valid_until_unix_ms BIGINT` — materialized freshness
- `is_stale BOOLEAN NOT NULL DEFAULT false` — materialized (migrated from `is_fresh`, inverted)
- `stale_behavior VARCHAR(24)` — materialized from registry policy, CHECK: `'exclude'`, `'degrade_confidence'`, `'allow_context_only'`
- `provenance JSONB NOT NULL DEFAULT '{}'::jsonb` — structured lineage

**`derived_features`:**

- `signal_class VARCHAR(16) NOT NULL` — CHECK as above
- `evidence_family VARCHAR(32) NOT NULL` — CHECK as above
- `feature_kind VARCHAR(64) NOT NULL` — no CHECK (extensible)
- `confidence JSONB NOT NULL DEFAULT '{}'::jsonb`
- `confidence_composite NUMERIC(5,4)` — materialized, CHECK range
- `confidence_level VARCHAR(8)` — materialized, CHECK levels
- `valid_until_unix_ms BIGINT` — materialized
- `is_stale BOOLEAN NOT NULL DEFAULT false`
- `stale_behavior VARCHAR(24)` — materialized, CHECK
- `provenance JSONB NOT NULL DEFAULT '{}'::jsonb`

**`evidence_bundles`:**

- `taxonomy_summary JSONB` — aggregate family/class distribution across members (e.g., `{"families": {"clmm_state": 3, "price_quality": 2}, "dominant_class": "deterministic"}`)
- `dominant_signal_class VARCHAR(16) NOT NULL` — CHECK levels (most frequent class among members)
- `confidence JSONB NOT NULL DEFAULT '{}'::jsonb`
- `confidence_composite NUMERIC(5,4)` — materialized, CHECK range
- `confidence_level VARCHAR(8)` — materialized, CHECK levels
- `valid_until_unix_ms BIGINT` — materialized
- `is_stale BOOLEAN NOT NULL DEFAULT false`
- `stale_behavior VARCHAR(24)` — materialized, CHECK
- `provenance JSONB NOT NULL DEFAULT '{}'::jsonb`

**`research_briefs`:**

- `signal_class VARCHAR(16) NOT NULL` — CHECK levels
- `evidence_family VARCHAR(32)` — nullable; null for multi-family briefs
- `taxonomy_summary JSONB` — required when `evidence_family` is null
- `confidence JSONB NOT NULL DEFAULT '{}'::jsonb`
- `confidence_composite NUMERIC(5,4)` — materialized, CHECK range
- `confidence_level VARCHAR(8)` — materialized, CHECK levels
- `valid_until_unix_ms BIGINT` — materialized
- `is_stale BOOLEAN NOT NULL DEFAULT false`
- `stale_behavior VARCHAR(24)` — materialized, CHECK
- `provenance JSONB NOT NULL DEFAULT '{}'::jsonb`
- **CHECK constraint**: `(evidence_family IS NOT NULL OR taxonomy_summary IS NOT NULL)`

### 7.2 Deprecated/Migrated Columns

- `normalized_observations.is_fresh` → migrated to `is_stale` (inverted boolean). Drop `is_fresh` after migration.
- `derived_features.input_lineage` → replaced by `provenance JSONB`. Drop `input_lineage` after migration.

### 7.3 Kind Name Migration

Existing `observation_kind` values using kebab-case (`pool-snapshot`) must be migrated to snake_case (`pool_state`) as part of this migration. Same for `feature_kind` values (`fee-apr` → `fee_apr`). `source` values with hyphens (`clmm-v2-bundle`, `jupiter-price-v3`) retain hyphens — they are source identifiers, not kind names.

---

## 8. Port Interface Changes

### 8.1 Typed DTOs Replace Raw Strings

All port interfaces that accept observation/feature/bundle/brief data must accept validated typed objects, not raw strings. Drizzle adapters bridge from typed domain objects to DB varchar/jsonb columns.

**`NormalizedObservationInsert/Row`:**

- `source: Source` (was `string`)
- `observationKind: ObservationKind` (was `string`)
- `signalClass: SignalClass` (new)
- `evidenceFamily: EvidenceFamily` (new)
- `confidence: Confidence` (new, replaces raw string)
- `validUntilUnixMs: number` (new)
- `isStale: boolean` (replaces `isFresh: boolean`)
- `staleBehavior: StaleBehavior` (new)
- `provenance: Provenance` (new)

**`DerivedFeatureInsert/Row`:**

- `featureKind: FeatureKind` (was `string`)
- `signalClass: SignalClass` (new)
- `evidenceFamily: EvidenceFamily` (new)
- `confidence: Confidence` (replaces `string`)
- `validUntilUnixMs: number` (new)
- `isStale: boolean` (new)
- `staleBehavior: StaleBehavior` (new)
- `provenance: Provenance` (replaces `inputLineage: unknown`)

**`EvidenceBundleInsert/Row`:**

- `taxonomySummary: TaxonomySummary` (new)
- `dominantSignalClass: SignalClass` (new)
- `confidence: Confidence` (new)
- `validUntilUnixMs: number` (new)
- `isStale: boolean` (new)
- `staleBehavior: StaleBehavior` (new)
- `provenance: Provenance` (new)

**`ResearchBriefInsert/Row`:**

- `signalClass: SignalClass` (new)
- `evidenceFamily?: EvidenceFamily` (new, nullable)
- `taxonomySummary?: TaxonomySummary` (new, required when `evidenceFamily` is null)
- `confidence: Confidence` (new)
- `validUntilUnixMs: number` (new)
- `isStale: boolean` (new)
- `staleBehavior: StaleBehavior` (new)
- `provenance: Provenance` (new)

### 8.2 New Port Type

```ts
export interface TaxonomySummary {
  readonly families: Partial<Record<EvidenceFamily, number>>;
  readonly dominantClass: SignalClass;
}
```

---

## 9. Architecture Boundaries

```
src/contracts/taxonomy.ts          — types, interfaces, union types
src/domain/taxonomy/registry.ts    — static as-const-satisfies registry
src/domain/taxonomy/freshness.ts   — computeFreshness() pure function
src/domain/taxonomy/confidence.ts  — computeConfidence() pure function
src/domain/taxonomy/provenance.ts  — validateProvenance() pure function
src/domain/taxonomy/validation.ts  — parse*() boundary functions
src/domain/taxonomy/index.ts       — barrel export
```

**Dependency rule:** `src/ports/` may import types from `src/contracts/taxonomy.ts` but must never import from `src/domain/taxonomy/`. Domain may import from contracts. Adapters bridge between domain types and DB columns.

**`dependency-cruiser` rule:** New rule enforcing `ports → contracts` only (no `ports → domain`) for taxonomy imports.

---

## 10. Testing Requirements

- Registry exhaustiveness: every union type member has a registry entry, every entry's `kind` matches its key
- Freshness derivation: timestamp sanity, validUntil computation, stale detection, fetch lag, undefined-handling
- Confidence derivation: weight sum validation, LLM redistribution, threshold levels, stale degradation, component range validation
- Provenance validation: minimum refs, allowed sources, required fields, result type (not throw)
- Parse functions: valid values return typed, unknown values throw `TaxonomyValidationError`
- DB migration: CHECK constraints on stable enums, no CHECK on extensible kinds
- Port interface: typed DTOs accepted, raw strings rejected at compile time

---

## 11. Acceptance Criteria (from issue #6)

- [ ] Every future observation/feature/brief can carry a consistent signal family, confidence, freshness, and provenance model
- [ ] Deterministic metrics and LLM/context signals are represented differently (SignalClass) rather than collapsed into one generic bucket
- [ ] Examples exist for at least one deterministic metric (fee_apr), one contextual risk item (placeholder for macro_protocol_risk), and one LLM summary (research_brief with contextual class)
- [ ] Validation prevents impossible freshness/confidence states
- [ ] Docs explain how this taxonomy maps to the research report

---

## 12. Out of Scope

- Source-specific collectors (INT-CORE #7)
- Policy synthesis (regime-engine)
- UI rendering
- Probabilistic model implementations (signal class is reserved but no active entries)
- LLM research brief generation (INT-BRIEFS #12)
- Evidence bundle publication (INT-PUBLISH #13)
