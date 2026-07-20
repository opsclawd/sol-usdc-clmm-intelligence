<!-- plan-review-required -->

# Deterministic MVP SOL/USDC Evidence Feature Tranche Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive and persist exactly seven auditable, versioned SOL/USDC features from bounded normalized observations, including deterministic selection, explicit availability states, conservative confidence/freshness, complete lineage, and replay-safe persistence.

**Architecture:** Add a `DerivedFeatureV1` contract in `src/contracts`, pure arithmetic/selectors/calculators under `src/domain/derived-feature`, and one application use case that performs bounded candidate reads, validates all results, and transactionally persists the tranche. Extend the normalized-observation and derived-feature repository ports only in tasks that also update every adapter and fake; expose the use case through a thin job and collector script without making external source calls or policy decisions.

**Tech Stack:** TypeScript 5.7, Zod, Vitest, Drizzle ORM, PostgreSQL, pnpm, dependency-cruiser.

---

**Goal details**

- Implement canonical feature kinds `range_location`, `distance_to_lower`, `distance_to_upper`, `oracle_dex_divergence`, `oracle_confidence_width`, `realized_volatility_1h`, and `volume_liquidity_ratio_24h`.
- Persist `AVAILABLE`, `PARTIAL`, and `UNAVAILABLE` results without fake zero values.
- Make selection, calculation, rounding, confidence, freshness, provenance, and idempotency reproducible from stored inputs and version identifiers.

**Non-goals**

- No new source collectors, HTTP calls, evidence-bundle publication, research briefs, LLM calculations, PolicyInsight synthesis, recommendations, or transaction/execution behavior.
- No deferred #8 metrics: fee APR/yield, inventory skew, fee capture, fee-to-volatility, rebalance cost, breach probability, wick/breakout/volume confirmation, liquidity cliffs, route risk, flows, perps, funding, liquidations, news, or support/resistance.
- No general feature DSL, plugin framework, JSON-scope indexes, or automatic discovery of position identities.

**Affected files (repository-relative)**

- Contracts/taxonomy: `src/contracts/derived-feature.ts`, `src/contracts/index.ts`, `src/contracts/taxonomy.ts`, `src/domain/taxonomy/registry.ts`, `src/domain/taxonomy/validation.ts`.
- Pure feature domain: `src/domain/derived-feature/index.ts`, `src/domain/derived-feature/decimal.ts`, `src/domain/derived-feature/select.ts`, `src/domain/derived-feature/assemble.ts`, `src/domain/derived-feature/range.ts`, `src/domain/derived-feature/market.ts`, `src/domain/derived-feature/volatility.ts`.
- Ports/adapters: `src/ports/normalized-observation-repo.ts`, `src/ports/feature-repo.ts`, `src/adapters/node/drizzle-normalized-observation-repo.ts`, `src/adapters/node/drizzle-feature-repo.ts`, `src/adapters/node/composition-root.ts`, `tests/fakes/fake-normalized-observation-repo.ts`, `tests/fakes/fake-feature-repo.ts`.
- Persistence: `src/db/schema/derived-features.ts`, `drizzle/0002_derived_feature_tranche.sql`, `drizzle/meta/_journal.json`, `drizzle/meta/0002_snapshot.json`.
- Orchestration/entrypoint: `src/application/derive-mvp-features.ts`, `src/jobs/derive-mvp-features-job.ts`, `src/jobs/index.ts`, `scripts/collectors/derive-mvp-features.ts`, `package.json`, `.env.example`.
- Tests/fixtures: `tests/helpers/derived-feature-fixtures.ts`, `tests/domain/derived-feature/contract.test.ts`, `tests/domain/derived-feature/decimal.test.ts`, `tests/domain/derived-feature/select.test.ts`, `tests/domain/derived-feature/assemble.test.ts`, `tests/domain/derived-feature/range.test.ts`, `tests/domain/derived-feature/market.test.ts`, `tests/domain/derived-feature/volatility.test.ts`, `tests/domain/taxonomy/registry.test.ts`, `tests/domain/taxonomy/validation.test.ts`, `tests/ports/normalized-observation-repo.test.ts`, `tests/ports/feature-repo.test.ts`, `tests/db/schema/derived-features.test.ts`, `tests/db/migrations/derived-feature-tranche.test.ts`, `tests/application/derive-mvp-features.test.ts`, `tests/scripts/derive-mvp-features.test.ts`.
- Documentation: `README.md`, `docs/architecture.md`, `docs/operator-runbook.md`.

**Global implementation rules**

- Write every named invariant test before its implementation, run it to observe the expected failure, implement only enough behavior to pass, then run the task-scoped validation commands.
- After each task, the implement loop also runs the automatic workspace gate `pnpm -r typecheck`; do not defer a required interface implementation to a later task.
- Use semantic timestamps from payloads for selection and `receivedAtUnixMs` only for coarse reads/tie-breaking. Treat `validUntilUnixMs <= evaluationAsOfUnixMs` as expired.
- Sort/de-duplicate IDs, warning codes, reason codes, and provenance refs before hashing or persistence.
- Commit each task separately with the commit message given in that task.

## Task 1: Define the seven feature kinds and validated result contract

**Files:**

- Create: `src/contracts/derived-feature.ts`
- Modify: `src/contracts/taxonomy.ts`
- Modify: `src/contracts/index.ts`
- Modify: `src/domain/taxonomy/registry.ts`
- Modify: `src/domain/taxonomy/validation.ts`
- Create: `tests/domain/derived-feature/contract.test.ts`
- Modify: `tests/domain/taxonomy/registry.test.ts`
- Modify: `tests/domain/taxonomy/validation.test.ts`
- Modify: `tests/ports/feature-repo.test.ts`
- Modify: `tests/db/schema/derived-features.test.ts`

**Behavioral invariants (write these tests first):**

- `accepts an AVAILABLE feature only with a finite safe-integer value`: `AVAILABLE` requires a non-null finite safe integer; `UNAVAILABLE` requires `null`; `PARTIAL` requires a non-null finite safe integer.
- `enforces the canonical unit for every feature kind`: range location and volume/liquidity use `PPM`; the other five kinds use `BPS`.
- `enforces feature scope identity by kind`: position features require both `poolId` and `positionId`; pool ratio requires `poolId` and no `positionId`; pair features require neither position identity.
- `rejects unsorted duplicate observation ids and reason codes`: selected/rejected IDs and warning/reason arrays are strictly sorted and unique.
- `accepts unavailable no-input provenance only with a stable reason`: ref-free provenance is allowed only for `UNAVAILABLE` with at least one reason; available/partial rows must satisfy registry ref minima.
- `rejects removed placeholder feature kinds`: `fee_apr`, `oracle_divergence`, `volatility_24h`, and `liquidity_depth` no longer parse.
- `tests/ports/feature-repo.test.ts and tests/db/schema/derived-features.test.ts reference the seven canonical kinds`: both test files must be updated in Task 1 to use `range_location`, `distance_to_lower`, `distance_to_upper`, `oracle_dex_divergence`, `oracle_confidence_width`, `realized_volatility_1h`, and `volume_liquidity_ratio_24h`; they must not reference the removed placeholder kinds or defer type fixes to Tasks 8 or 9.

- [ ] **Step 1: Add failing contract and taxonomy tests.** Assert the exact seven-member set, registry families/source allowlists/freshness policies, kind-to-unit/scope rules, status/value rules, timestamps, schema version, version strings, confidence/freshness, sorted identities, metadata, and status-aware provenance. Also update `tests/ports/feature-repo.test.ts` and `tests/db/schema/derived-features.test.ts` to reference only the seven canonical feature kinds; this update must happen in Task 1, not deferred to Tasks 8 or 9, to keep `pnpm -r typecheck` green after each task.

- [ ] **Step 2: Define and export the result contract.** Use a Zod-backed runtime parser with the following public shape; keep warnings/reasons as stable snake-case strings and metadata JSON-compatible.

```ts
export const MVP_FEATURE_KINDS = [
  "range_location",
  "distance_to_lower",
  "distance_to_upper",
  "oracle_dex_divergence",
  "oracle_confidence_width",
  "realized_volatility_1h",
  "volume_liquidity_ratio_24h"
] as const;

export type FeatureStatus = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
export type FeatureUnit = "BPS" | "PPM";

export interface DerivedFeatureV1 {
  readonly schemaVersion: 1;
  readonly featureKind: FeatureKind;
  readonly status: FeatureStatus;
  readonly value: number | null;
  readonly unit: FeatureUnit;
  readonly pair: "SOL/USDC";
  readonly poolId: string | null;
  readonly positionId: string | null;
  readonly asOfUnixMs: number;
  readonly expiresAtUnixMs: number;
  readonly confidence: Confidence;
  readonly freshness: Freshness;
  readonly inputObservationIds: readonly number[];
  readonly rejectedObservationIds: readonly number[];
  readonly provenance: Provenance;
  readonly warnings: readonly string[];
  readonly reasons: readonly string[];
  readonly calculatorVersion: string;
  readonly selectionVersion: string;
  readonly calculationMetadata: Readonly<Record<string, unknown>>;
}

export function parseDerivedFeatureV1(value: unknown): DerivedFeatureV1;
```

- [ ] **Step 3: Replace placeholder taxonomy entries.** Change `FeatureKind` to the seven canonical strings and make `featureKindRegistry` exhaustive. Use `clmm_state` for the three range features, `price_quality` for divergence/confidence/volatility, and `clmm_economics` for the volume ratio; all remain deterministic and active. Allow only clmm-v2, Pyth+Jupiter, Pyth, or Orca sources as required by each formula.

- [ ] **Step 4: Run task-scoped tests and static checks.** Expected: all three test files pass, and lint/format report no issues.

**Validation commands:**

```bash
pnpm exec vitest run tests/domain/derived-feature/contract.test.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts tests/ports/feature-repo.test.ts tests/db/schema/derived-features.test.ts
pnpm exec eslint src/contracts/derived-feature.ts src/contracts/index.ts src/contracts/taxonomy.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts tests/domain/derived-feature/contract.test.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts tests/ports/feature-repo.test.ts tests/db/schema/derived-features.test.ts --max-warnings 0
pnpm exec prettier --check src/contracts/derived-feature.ts src/contracts/index.ts src/contracts/taxonomy.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts tests/domain/derived-feature/contract.test.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts tests/ports/feature-repo.test.ts tests/db/schema/derived-features.test.ts
```

**Commit:** `feat: define deterministic feature result contract`

## Task 2: Add exact decimal and rational arithmetic

**Files:**

- Create: `src/domain/derived-feature/decimal.ts`
- Create: `src/domain/derived-feature/index.ts`
- Create: `tests/domain/derived-feature/decimal.test.ts`

**Behavioral invariants (write these tests first):**

- `parses plain signed decimals without binary floating-point conversion`: accept integer/fractional forms and normalize trailing zeroes using `bigint` coefficient/scale.
- `rejects empty exponent and non-finite decimal syntax`: reject whitespace-only, exponent notation, `NaN`, and infinities.
- `rounds rational ties away from zero`: `1/2` becomes `1`, `-1/2` becomes `-1`, and non-ties round to the nearest integer.
- `rejects zero divisors and unsafe integer outputs`: division by zero and results outside `Number.MIN_SAFE_INTEGER..Number.MAX_SAFE_INTEGER` return typed numeric failure codes.
- `rounds only after the complete scaled formula`: golden BPS/PPM cases near half-way boundaries match exact rational expectations.

- [ ] **Step 1: Write the failing arithmetic tests**, including positive/negative signs, different scales, tie cases, zero divisor, and safe-integer overflow.

- [ ] **Step 2: Implement a pure rational representation and operations.** Do not reuse `src/domain/price-observation/decimal.ts`, which is a looser normalizer; use exact `bigint` math.

```ts
export interface Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export type NumericFailure = "invalid_decimal" | "division_by_zero" | "numeric_overflow";

export function parseDecimal(value: string): Rational;
export function subtract(left: Rational, right: Rational): Rational;
export function multiply(left: Rational, right: Rational): Rational;
export function divide(left: Rational, right: Rational): Rational;
export function compare(left: Rational, right: Rational): -1 | 0 | 1;
export function roundToSafeInteger(value: Rational): number;
```

- [ ] **Step 3: Export the helpers from the feature-domain barrel** and run the focused checks.

**Validation commands:**

```bash
pnpm exec vitest run tests/domain/derived-feature/decimal.test.ts
pnpm exec eslint src/domain/derived-feature/decimal.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/decimal.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/derived-feature/decimal.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/decimal.test.ts
```

**Commit:** `feat: add exact feature arithmetic`

## Task 3: Add bounded candidate reads and pure deterministic selectors

**Files:**

- Modify: `src/ports/normalized-observation-repo.ts`
- Modify: `src/adapters/node/drizzle-normalized-observation-repo.ts`
- Modify: `tests/fakes/fake-normalized-observation-repo.ts`
- Create: `src/domain/derived-feature/select.ts`
- Modify: `src/domain/derived-feature/index.ts`
- Create: `tests/domain/derived-feature/select.test.ts`
- Modify: `tests/ports/normalized-observation-repo.test.ts`

**Behavioral invariants (write these tests first):**

- `candidate reads filter source kind and inclusive receipt lower bound`: the port performs only coarse indexed filtering and returns `(receivedAtUnixMs, id)` ascending.
- `selects the latest exact-scope valid row with deterministic tie breaks`: compare semantic time, provider slot when present, receipt time, then normalized ID.
- `rejects a persisted-fresh row that expired by evaluation time`: `isStale === false` never overrides `validUntilUnixMs <= evaluationAsOfUnixMs`.
- `records malformed wrong-source and wrong-scope candidates deterministically`: rejected IDs and reasons are stable regardless of database input order.
- `deduplicates volatility timestamps by slot receipt and id`: select the highest slot, then receipt time, then ID, sort timestamps ascending, and retain discarded IDs.
- `accepts historical volatility samples while requiring a fresh anchor`: samples inside the one-hour window may be expired at evaluation time; the latest anchor may not be.

- [ ] **Step 1: Add failing port and selector tests.** Cover pair/pool/position matching, source allowlists, malformed payloads, dynamic expiry, semantic tie breaks, out-of-order series, inclusive lookback, and duplicate timestamps.

- [ ] **Step 2: Add one bounded query method and update every implementation in the same step.** This is an exported port change and must remain atomic across the port, Drizzle adapter, and fake.

```ts
export interface NormalizedObservationCandidateQuery {
  readonly sourceKinds: readonly {
    readonly source: Source;
    readonly observationKind: ObservationKind;
  }[];
  readonly receivedAtOrAfterUnixMs: number;
}

export interface NormalizedObservationRepo {
  // existing methods remain
  listCandidates(query: NormalizedObservationCandidateQuery): Promise<NormalizedObservationRow[]>;
}
```

The Drizzle implementation must build an `OR` over source/kind pairs plus the receipt lower bound and order by receipt then ID. The fake must mirror those semantics exactly.

- [ ] **Step 3: Implement pure payload narrowing and selectors.** Return selected rows and structured rejected candidates; do not import ports, DB, environment, clock, or adapters.

```ts
export interface CandidateRejection {
  readonly observationId: number;
  readonly reason: string;
}

export interface Selection<T> {
  readonly selected: readonly T[];
  readonly rejected: readonly CandidateRejection[];
}

export const SELECTION_VERSION = "mvp-feature-selection/v1";
```

- [ ] **Step 4: Run the selector/port checks.** Expected: stable results for all permutations of the same candidates.

**Validation commands:**

```bash
pnpm exec vitest run tests/domain/derived-feature/select.test.ts tests/ports/normalized-observation-repo.test.ts
pnpm exec eslint src/ports/normalized-observation-repo.ts src/adapters/node/drizzle-normalized-observation-repo.ts tests/fakes/fake-normalized-observation-repo.ts src/domain/derived-feature/select.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/select.test.ts tests/ports/normalized-observation-repo.test.ts --max-warnings 0
pnpm exec prettier --check src/ports/normalized-observation-repo.ts src/adapters/node/drizzle-normalized-observation-repo.ts tests/fakes/fake-normalized-observation-repo.ts src/domain/derived-feature/select.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/select.test.ts tests/ports/normalized-observation-repo.test.ts
```

**Commit:** `feat: select bounded feature inputs deterministically`

## Task 4: Assemble confidence freshness lineage and derivation identity

**Files:**

- Create: `src/domain/derived-feature/assemble.ts`
- Modify: `src/domain/derived-feature/index.ts`
- Create: `tests/helpers/derived-feature-fixtures.ts`
- Create: `tests/domain/derived-feature/assemble.test.ts`

**Behavioral invariants (write these tests first):**

- `derived confidence never exceeds the weakest selected input`: use component-wise minima, apply registry weights and partial factor, then cap the composite at the lowest input composite.
- `unavailable confidence has zero derivation confidence`: missing input produces low confidence with `required_component_missing` and never fabricates high confidence.
- `feature expiry is the minimum selected input expiry`: available/partial freshness uses the earliest input validity; unavailable expires at evaluation time.
- `lineage contains every outcome-determining selected or rejected row`: normalized refs are ID-sorted and raw/source refs are flattened, de-duplicated, and sorted.
- `derivation identity changes only when its canonical identity fields change`: schema/kind/scope/versions/selected IDs/outcome-determining rejected IDs/reasons determine `derivationKey`; complete result content separately determines `payloadHash`.

- [ ] **Step 1: Add failing fixture-driven tests** for confidence caps, partial degradation, missing-input confidence, expiry, empty/no-input provenance, rejected-row lineage, canonical sorting, and hash stability.

- [ ] **Step 2: Implement assembly helpers** that accept explicit `evaluationAsOfUnixMs`, `runId`, and `codeVersion`; never read a clock or environment directly.

```ts
export interface FeatureCalculation {
  readonly status: FeatureStatus;
  readonly value: number | null;
  readonly warnings: readonly string[];
  readonly reasons: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface AssembledFeature {
  readonly result: DerivedFeatureV1;
  readonly derivationKey: string;
  readonly payloadHash: string;
}

export function assembleDerivedFeature(input: AssembleFeatureInput): AssembledFeature;
```

Use the existing canonical content hashing utility, explicit process ref `{ collector: "deterministic-feature-derivation", jobName: "derive-mvp-features", pipelineRunId, codeVersion, modelVersion: null }`, and status-aware provenance checks before returning.

- [ ] **Step 3: Export assembly types/functions and run focused checks.**

**Validation commands:**

```bash
pnpm exec vitest run tests/domain/derived-feature/assemble.test.ts
pnpm exec eslint src/domain/derived-feature/assemble.ts src/domain/derived-feature/index.ts tests/helpers/derived-feature-fixtures.ts tests/domain/derived-feature/assemble.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/derived-feature/assemble.ts src/domain/derived-feature/index.ts tests/helpers/derived-feature-fixtures.ts tests/domain/derived-feature/assemble.test.ts
```

**Commit:** `feat: assemble auditable feature envelopes`

## Task 5: Implement the three position-range calculators

**Files:**

- Create: `src/domain/derived-feature/range.ts`
- Modify: `src/domain/derived-feature/index.ts`
- Create: `tests/domain/derived-feature/range.test.ts`

**Behavioral invariants (write these tests first):**

- `classifies and clamps range location without hiding market state`: below is `0 PPM`, in-range is exact, above is `1_000_000 PPM`, with boundary/classification metadata.
- `preserves signed distance outside the position range`: distance-to-lower is negative below lower; distance-to-upper is negative above upper.
- `rejects invalid prices ranges and contradictory range state`: nonpositive prices, `upper <= lower`, malformed labels, or source `rangeState` disagreement produce `UNAVAILABLE` and `null`.
- `applies nearest integer ties away from zero after the full formula`: all three golden fixtures have exact integer BPS/PPM values.

- [ ] **Step 1: Add failing golden tests** for below/in/above, exact boundaries, signed distances, decimal rounding ties, zero-width range, malformed/nonpositive prices, and contradictory source classification.

- [ ] **Step 2: Implement the pure calculators** against `PositionStatePayloadV1`, returning `FeatureCalculation` and the fixed versions below.

```ts
export const RANGE_CALCULATOR_VERSIONS = {
  range_location: "range-location/v1",
  distance_to_lower: "distance-to-lower/v1",
  distance_to_upper: "distance-to-upper/v1"
} as const;

// location = clamp((current - lower) / (upper - lower), 0, 1) * 1_000_000
// lower distance = ((current - lower) / current) * 10_000
// upper distance = ((upper - current) / current) * 10_000
```

Emit exactly one classification value among `below_range_clamped`, `in_range`, `above_range_clamped`, `at_lower_boundary`, and `at_upper_boundary`; boundary clamping remains `AVAILABLE` when all inputs are sound.

- [ ] **Step 3: Run task-scoped checks.**

**Validation commands:**

```bash
pnpm exec vitest run tests/domain/derived-feature/range.test.ts
pnpm exec eslint src/domain/derived-feature/range.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/range.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/derived-feature/range.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/range.test.ts
```

**Commit:** `feat: calculate position range features`

## Task 6: Implement oracle and pool market calculators

**Files:**

- Create: `src/domain/derived-feature/market.ts`
- Modify: `src/domain/derived-feature/index.ts`
- Create: `tests/domain/derived-feature/market.test.ts`

**Behavioral invariants (write these tests first):**

- `calculates absolute oracle DEX divergence only from Pyth and executable Jupiter quote`: valid inputs at no more than 30 seconds skew return BPS; pool price is never a substitute.
- `makes divergence unavailable for missing route stale input or excessive skew`: each defect returns `UNAVAILABLE`, `null`, and a stable reason.
- `retains a partial divergence value for nonfatal input quality`: wide Pyth confidence or a nonfatal Jupiter quality warning yields `PARTIAL` with the numeric value.
- `measures wide oracle confidence as partial rather than missing`: width is `confidence / price * 10_000`; halted/auction, negative confidence, or nonpositive price is unavailable.
- `accepts zero volume only with positive TVL`: zero volume yields available zero; missing volume/TVL or nonpositive TVL yields unavailable null; provider warning with both operands yields partial.

- [ ] **Step 1: Add failing golden tests** for exact divergence, exact confidence width, exact volume ratio, rounding ties, stale oracle, unavailable route, wide confidence, skew, legitimate zero volume, missing liquidity, and zero/negative liquidity.

- [ ] **Step 2: Implement the three pure calculators** with no source fallback and fixed versions.

```ts
export const MARKET_CALCULATOR_VERSIONS = {
  oracle_dex_divergence: "oracle-dex-divergence/v1",
  oracle_confidence_width: "oracle-confidence-width/v1",
  volume_liquidity_ratio_24h: "volume-liquidity-ratio-24h/v1"
} as const;

// divergence = abs(dex - oracle) / oracle * 10_000 BPS
// confidence width = confidence / oracle * 10_000 BPS
// volume/liquidity = volume24hUsdc / tvlUsdc * 1_000_000 PPM
```

- [ ] **Step 3: Run task-scoped checks.**

**Validation commands:**

```bash
pnpm exec vitest run tests/domain/derived-feature/market.test.ts
pnpm exec eslint src/domain/derived-feature/market.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/market.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/derived-feature/market.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/market.test.ts
```

**Commit:** `feat: calculate oracle and pool market features`

## Task 7: Implement one-hour realized volatility

**Files:**

- Create: `src/domain/derived-feature/volatility.ts`
- Modify: `src/domain/derived-feature/index.ts`
- Create: `tests/domain/derived-feature/volatility.test.ts`

**Behavioral invariants (write these tests first):**

- `computes nonannualized one hour realized volatility from ordered log returns`: use `sqrt(sum(log(p[i]/p[i-1])^2)) * 10_000`, no mean subtraction or time scaling.
- `uses the inclusive one-hour window and deterministic duplicate winner`: `[anchor - 3_600_000, anchor]`, minimum 10 distinct samples, highest slot/receipt/ID per duplicate timestamp.
- `is unavailable below minimum coverage`: fewer than 10 samples or less than 45 minutes first-to-last returns exact coverage reason and null.
- `is unavailable when any adjacent gap exceeds ten minutes`: exactly 10 minutes passes; greater than 10 minutes fails.
- `is unavailable for nonpositive or nonfinite price math`: conversion/log failures never persist `NaN` or infinity.

- [ ] **Step 1: Add failing tests** using a hand-computed golden series plus inclusive boundary, insufficient count, insufficient span, exact/over maximum gap, duplicates, out-of-order input, and invalid prices.

- [ ] **Step 2: Implement the pure calculator.** Validate exact decimal strings as positive before converting to finite numbers for `Math.log`; round only the final nonnegative BPS result and record sample count, first/last timestamp, max gap, and discarded duplicate IDs.

```ts
export const REALIZED_VOLATILITY_1H_VERSION = "realized-volatility-1h/v1";
export const VOLATILITY_WINDOW_MS = 3_600_000;
export const VOLATILITY_MIN_SAMPLES = 10;
export const VOLATILITY_MIN_SPAN_MS = 2_700_000;
export const VOLATILITY_MAX_GAP_MS = 600_000;
```

- [ ] **Step 3: Run task-scoped checks.**

**Validation commands:**

```bash
pnpm exec vitest run tests/domain/derived-feature/volatility.test.ts
pnpm exec eslint src/domain/derived-feature/volatility.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/volatility.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/derived-feature/volatility.ts src/domain/derived-feature/index.ts tests/domain/derived-feature/volatility.test.ts
```

**Commit:** `feat: calculate one hour realized volatility`

## Task 8: Migrate and constrain derived-feature storage

**Files:**

- Modify: `src/db/schema/derived-features.ts`
- Create: `drizzle/0002_derived_feature_tranche.sql`
- Modify: `drizzle/meta/_journal.json`
- Create: `drizzle/meta/0002_snapshot.json`
- Modify: `tests/db/schema/derived-features.test.ts`
- Create: `tests/db/migrations/derived-feature-tranche.test.ts`

**Behavioral invariants (write these tests first):**

- `migration aborts when historical derived feature rows exist`: precondition failure is explicit; the migration never guesses statuses or deletes/relabels rows.
- `database status and value constraints exclude fake availability`: unavailable requires null; available/partial require non-null.
- `database unit kind and scope checks mirror the contract`: exact seven-kind allowlist, canonical units, and required position/pool identities are enforced.
- `database replay identity is feature kind plus derivation key`: replace the old kind/payload unique index without losing the separate payload hash.

- [ ] **Step 1: Add failing schema/migration tests** for every new column/check/index and statement ordering (precondition before alterations; old unique index dropped before replacement).

- [ ] **Step 2: Update the Drizzle schema** with non-null `status`, `unit`, `pair`, calculator/selection versions, integer arrays for selected/rejected IDs, `derivationKey`, non-null structured payload, optional pool/position IDs, and all contract-mirroring checks.

- [ ] **Step 3: Generate and then edit migration artifacts.** Start from `pnpm db:generate`, retain generated snapshot/journal consistency, and make SQL fail safely if `derived_features` contains rows before adding non-null columns. The target identity is:

```sql
CREATE UNIQUE INDEX "uniq_features_kind_derivation_key"
ON "intelligence"."derived_features" ("feature_kind", "derivation_key");
```

Do not backfill invented values, truncate, or delete historical rows.

- [ ] **Step 4: Run the two focused persistence-definition tests and format checks.**

**Validation commands:**

```bash
pnpm exec vitest run tests/db/schema/derived-features.test.ts tests/db/migrations/derived-feature-tranche.test.ts
pnpm exec eslint src/db/schema/derived-features.ts tests/db/schema/derived-features.test.ts tests/db/migrations/derived-feature-tranche.test.ts --max-warnings 0
pnpm exec prettier --check src/db/schema/derived-features.ts drizzle/meta/_journal.json drizzle/meta/0002_snapshot.json tests/db/schema/derived-features.test.ts tests/db/migrations/derived-feature-tranche.test.ts
```

**Commit:** `feat: constrain derived feature persistence`

## Task 9: Make derived-feature batch persistence transactional and idempotent

**Files:**

- Modify: `src/ports/feature-repo.ts`
- Modify: `src/adapters/node/drizzle-feature-repo.ts`
- Modify: `tests/fakes/fake-feature-repo.ts`
- Modify: `tests/ports/feature-repo.test.ts`

**Behavioral invariants (write these tests first):**

- `insertMany persists all rows or exposes none`: any batch failure rolls back the entire batch.
- `insertMany replay returns existing rows in caller order`: conflict recovery works for all-conflict and mixed insert/conflict batches.
- `same derivation identity deduplicates sequential and concurrent replay`: feature kind plus derivation key is the sole replay identity.
- `changed scope inputs versions or reasons produce distinct rows`: distinct derivation keys preserve history even when payload values match.

- [ ] **Step 1: Rewrite the small port contract test with the new required row shape**, then add batch atomicity, input-order, replay, and identity-change cases.

- [ ] **Step 2: Change the port and every implementation together.** Add `insertMany` and derivation-key lookup in the same task as Drizzle and fake changes; retain `insert` as a one-row wrapper if useful.

```ts
export interface DerivedFeatureRepo {
  insert(row: DerivedFeatureInsert): Promise<DerivedFeatureRow>;
  insertMany(rows: readonly DerivedFeatureInsert[]): Promise<DerivedFeatureRow[]>;
  findByDerivationKey(
    featureKind: FeatureKind,
    derivationKey: string
  ): Promise<DerivedFeatureRow | undefined>;
  findByKind(featureKind: FeatureKind, sinceUnixMs: number): Promise<DerivedFeatureRow[]>;
}
```

Map all new persisted fields explicitly. Follow the normalized-observation adapter's transaction/conflict-recovery pattern, but key maps by `featureKind:derivationKey` and preserve caller order.

- [ ] **Step 3: Run focused port checks and static checks.**

**Validation commands:**

```bash
pnpm exec vitest run tests/ports/feature-repo.test.ts
pnpm exec eslint src/ports/feature-repo.ts src/adapters/node/drizzle-feature-repo.ts tests/fakes/fake-feature-repo.ts tests/ports/feature-repo.test.ts --max-warnings 0
pnpm exec prettier --check src/ports/feature-repo.ts src/adapters/node/drizzle-feature-repo.ts tests/fakes/fake-feature-repo.ts tests/ports/feature-repo.test.ts
```

**Commit:** `feat: persist feature batches idempotently`

## Task 10: Orchestrate the complete derivation use case

**Files:**

- Create: `src/application/derive-mvp-features.ts`
- Create: `tests/application/derive-mvp-features.test.ts`

**Behavioral invariants (write these tests first):**

- `derives three features per requested position and four shared features once`: output order is caller position order with range kind order, then divergence, confidence width, volatility, and volume ratio.
- `validates the complete tranche before the first insert`: a programmer-invalid result throws and writes zero rows; expected unavailable outcomes are valid rows and do persist.
- `uses one explicit evaluation time for all selection and expiry decisions`: clock is read once and no calculator reads it independently.
- `loads bounded candidates without source calls`: use only `NormalizedObservationRepo.listCandidates` for clmm-v2 position, Pyth oracle series, Jupiter executable quote, and Orca 24h pool statistics.
- `replay returns persisted identities without duplicates`: identical scope, inputs, versions, rejected outcome rows, and reasons return existing IDs.

- [ ] **Step 1: Add failing application tests** for output count/order, available/partial/unavailable mixtures, candidate window requests, lineage, confidence/expiry propagation, all-before-insert validation, replay, and changed-input/version identity.

- [ ] **Step 2: Implement the use case with explicit request/dependency contracts.** Parse the injected ISO clock once, require a non-empty de-duplicated position list and non-empty pool ID, read enough receipt history for the one-hour window plus a documented safety margin, then select/calculate/assemble/parse every result before one `insertMany` call.

```ts
export interface DeriveMvpFeaturesRequest {
  readonly pair: "SOL/USDC";
  readonly poolId: string;
  readonly positionIds: readonly string[];
  readonly pipelineRunId: string;
  readonly codeVersion: string;
}

export interface DeriveMvpFeaturesDeps {
  readonly clock: Clock;
  readonly normalizedObservationRepo: NormalizedObservationRepo;
  readonly featureRepo: DerivedFeatureRepo;
}

export interface DeriveMvpFeaturesResult {
  readonly rows: readonly DerivedFeatureRow[];
  readonly counts: Readonly<Record<FeatureStatus, number>>;
  readonly warnings: readonly string[];
}

export async function deriveMvpFeatures(
  deps: DeriveMvpFeaturesDeps,
  request: DeriveMvpFeaturesRequest
): Promise<DeriveMvpFeaturesResult>;
```

- [ ] **Step 3: Run the focused application checks.** Expected failures from data quality are persisted unavailable results; repository/contract failures reject without partial persistence.

**Validation commands:**

```bash
pnpm exec vitest run tests/application/derive-mvp-features.test.ts
pnpm exec eslint src/application/derive-mvp-features.ts tests/application/derive-mvp-features.test.ts --max-warnings 0
pnpm exec prettier --check src/application/derive-mvp-features.ts tests/application/derive-mvp-features.test.ts
```

**Commit:** `feat: orchestrate deterministic feature derivation`

## Task 11: Expose derivation through the Node runtime job and script

**Files:**

- Modify: `src/adapters/node/composition-root.ts`
- Create: `src/jobs/derive-mvp-features-job.ts`
- Modify: `src/jobs/index.ts`
- Create: `scripts/collectors/derive-mvp-features.ts`
- Create: `tests/scripts/derive-mvp-features.test.ts`
- Modify: `package.json`
- Modify: `.env.example`

**Behavioral invariants (write these tests first):**

- `script prints deterministic status counts and sorted warnings after persistence`: available/partial/unavailable data outcomes exit zero.
- `script fails for missing scope malformed position list or infrastructure failure`: configuration/contract/database failures set a nonzero exit code and never claim a successful derivation.
- `runtime persistence exposes all three repositories from one connection`: raw, normalized, and derived repositories share the lazily initialized DB connection.
- `job performs no publication or source collection`: it binds only clock, normalized repo, feature repo, run ID, and request metadata.

- [ ] **Step 1: Add failing script tests** with a dependency-injected runner for successful mixed status output, empty/malformed `INTELLIGENCE_POSITION_IDS`, missing pool ID, database failure, and connection close failure.

- [ ] **Step 2: Extend runtime composition and add the thin job.** Add `featureRepo` to the exported `Persistence` required-member shape and instantiate `DrizzleFeatureRepo` beside the existing repositories. The job obtains a run ID and delegates directly to `deriveMvpFeatures`.

- [ ] **Step 3: Add the operator script and configuration.** Read pool identity from `WHIRLPOOL_ADDRESS` (already used by collection), parse comma-separated `INTELLIGENCE_POSITION_IDS` by trim/filter/de-duplicate while rejecting an empty result, use `INTELLIGENCE_CODE_VERSION ?? "development"`, print JSON counts/warnings, always close the DB, and add:

```json
{
  "scripts": {
    "derive:mvp": "tsx scripts/collectors/derive-mvp-features.ts"
  }
}
```

- [ ] **Step 4: Run the focused entrypoint checks.**

**Validation commands:**

```bash
pnpm exec vitest run tests/scripts/derive-mvp-features.test.ts
pnpm exec eslint src/adapters/node/composition-root.ts src/jobs/derive-mvp-features-job.ts src/jobs/index.ts scripts/collectors/derive-mvp-features.ts tests/scripts/derive-mvp-features.test.ts --max-warnings 0
pnpm exec prettier --check src/adapters/node/composition-root.ts src/jobs/derive-mvp-features-job.ts src/jobs/index.ts scripts/collectors/derive-mvp-features.ts tests/scripts/derive-mvp-features.test.ts package.json
```

**Commit:** `feat: expose deterministic feature derivation job`

## Task 12: Document feature semantics and operator usage

**Files:**

- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/operator-runbook.md`

- [ ] **Step 1: Update feature inventory and authority boundary.** List exactly the seven canonical kinds, units, scopes, calculator versions, deterministic-evidence-only role, and the complete deferred #8 feature list.

- [ ] **Step 2: Document reproducibility rules.** Include nearest-integer/ties-away-from-zero rounding, exact range/oracle/pool formulas, the Pyth-only nonannualized volatility formula, inclusive one-hour window, 10-sample/45-minute/10-minute-gap thresholds, duplicate handling, confidence cap, freshness minimum, and lineage/derivation-key semantics.

- [ ] **Step 3: Add operator examples.** Document `WHIRLPOOL_ADDRESS`, `INTELLIGENCE_POSITION_IDS`, `INTELLIGENCE_CODE_VERSION`, migration precondition, `pnpm derive:mvp`, one available response, one unavailable response, and that unavailable evidence is stored but is not a numeric publication candidate.

- [ ] **Step 4: Run documentation formatting checks.**

**Validation commands:**

```bash
pnpm exec prettier --check README.md docs/architecture.md docs/operator-runbook.md
```

**Commit:** `docs: explain deterministic feature tranche`

**Tests to add or update**

- Contract/taxonomy: exact feature set; status/value, kind/unit, scope, time, sorted-ID, version, and provenance validation.
- Arithmetic: plain-decimal parsing, exact rational operations, ties-away-from-zero rounding, zero division, overflow.
- Selection: exact scope/source, semantic/tie-break ordering, dynamic expiry, malformed rows, volatility ordering/duplicates/history.
- Calculators: all issue acceptance cases plus golden units/rounding for all seven features.
- Assembly: confidence cap, partial/unavailable confidence, expiry, lineage, canonical hashes.
- Persistence: migration precondition/checks/indexes and transaction/order/replay behavior.
- Application/CLI: tranche cardinality/order, validate-before-write, replay, status output, configuration and infrastructure failures.

**Risk areas**

- The migration assumes `intelligence.derived_features` has no historical rows. Its precondition must abort instead of inventing data.
- JSON payload identities are not indexed; bounded receipt reads must stay conservative enough for one-hour coverage without becoming unbounded.
- Persisted `isStale` is a snapshot; selectors must also compare expiry to the single evaluation time.
- `Math.log` is intentionally floating point. The version string, selected price strings, metadata, and final integer value are the audit boundary.
- Unavailable no-input outcomes need scope/reasons in the derivation key or unrelated operational failures can collapse.
- Transaction conflict recovery must preserve caller order under sequential and concurrent replay.
- Pyth confidence width, evidence confidence, and availability status are distinct concepts and must not be conflated.

**Stop conditions**

- Abort the migration if any existing derived-feature row is present or any historical feature kind cannot be classified safely; do not rewrite/delete it.
- Stop if normalized source payloads on this branch do not match the #22/#23/#24 contracts assumed by the selectors; revise the design/plan instead of adding silent fallbacks.
- Stop if implementing either repository method would leave any adapter, fake, or required-member consumer uncompilable after the task's automatic `pnpm -r typecheck` gate.
- Stop before persistence if any assembled result fails `parseDerivedFeatureV1` or status-aware provenance validation; do not persist a partial tranche.
- Stop on database transaction failure or conflict recovery that cannot find the winning row; never return a partially ordered/partially persisted batch.
- Stop if an operator invocation lacks a pool ID or at least one explicit position ID; do not discover positions implicitly.
- Stop if a requested change would call external sources, publish evidence, make policy decisions, or authorize execution; those are outside this issue.

**Plan-level acceptance**

- Each implementation task owns its focused tests and exact validation commands; there is no standalone validation task.
- Tasks 3 and 9 keep each port change with all adapters/fakes. Task 11 keeps the `Persistence` required-member change with its concrete construction and callers.
- The dedicated validate phase after all tasks should run the repository-standard `pnpm verify`; this is intentionally not a task in this plan.
