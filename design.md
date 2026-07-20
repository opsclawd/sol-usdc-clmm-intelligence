# Deterministic MVP SOL/USDC Evidence Feature Tranche

**Issue:** #25

**Status:** Design

**Date:** 2026-07-19

**Parent:** #8

**Dependencies:** #22, #23, and #24 are present on the current branch

## Summary

Add the first complete normalized-observation-to-derived-feature vertical slice. A new application use case will load bounded candidate observations, pass them to pure deterministic selectors, calculate exactly seven versioned features, propagate freshness, confidence, and complete lineage, and persist auditable `AVAILABLE`, `PARTIAL`, or `UNAVAILABLE` results.

The seven canonical stored identifiers follow the repository's established lowercase snake-case convention. They map one-to-one to the issue's uppercase names:

| Issue name                   | Canonical `FeatureKind`      | Scope    | Unit  |
| ---------------------------- | ---------------------------- | -------- | ----- |
| `RANGE_LOCATION`             | `range_location`             | position | `PPM` |
| `DISTANCE_TO_LOWER`          | `distance_to_lower`          | position | `BPS` |
| `DISTANCE_TO_UPPER`          | `distance_to_upper`          | position | `BPS` |
| `ORACLE_DEX_DIVERGENCE`      | `oracle_dex_divergence`      | pair     | `BPS` |
| `ORACLE_CONFIDENCE_WIDTH`    | `oracle_confidence_width`    | pair     | `BPS` |
| `REALIZED_VOLATILITY_1H`     | `realized_volatility_1h`     | pair     | `BPS` |
| `VOLUME_LIQUIDITY_RATIO_24H` | `volume_liquidity_ratio_24h` | pool     | `PPM` |

The issue names are not persisted as a second alias set. One canonical spelling avoids split registries and ambiguous queries.

## Problem and why it matters

The repository now durably ingests the prerequisite facts:

- clmm-v2 `position_state` observations contain position range bounds and current price;
- Pyth `oracle_price` observations contain an exact decimal price and confidence width;
- Jupiter `executable_quote` observations contain an amount-specific implied price and route availability;
- Orca `pool_statistics` observations contain documented 24-hour volume and TVL semantics.

Those facts are individually auditable, but downstream systems should not repeatedly reinterpret source payloads or implement financial formulas independently. Doing so would create formula drift, inconsistent stale-data handling, fake zero fallbacks, and evidence that cannot be reproduced after code changes.

The MVP tranche establishes the missing derivation boundary: source normalization remains source-specific, feature selection and arithmetic become deterministic code, and every stored result names the exact normalized rows and calculator version that produced it. This lets the later evidence-bundle stage consume stable features without making this repository a policy engine.

## Codebase findings that shape the design

1. The layered monolith already has the correct dependency direction. Contracts belong in `src/contracts`, pure work in `src/domain`, repository orchestration in `src/application`, and Drizzle in `src/adapters/node` and `src/db`. Calculators must not import ports, clocks, environment readers, or database types.
2. `FeatureKind` and `featureKindRegistry` are exhaustively typed with `as const satisfies Record<FeatureKind, FeatureKindEntry>`. The current four feature kinds are placeholders; no feature derivation application use case exists. The new registry should contain the seven MVP kinds, not claim that deferred placeholders such as `fee_apr` or `volatility_24h` are active.
3. `derived_features` currently has nullable `value` and generic JSONB fields but no first-class status, unit, scope, calculator version, or normalized-input identity. Its unique key `(feature_kind, payload_hash)` is useful but insufficiently expressive for formula-version and input-set idempotency.
4. `NormalizedObservationRepo` queries by source/kind and receipt time. Pair, pool, position, and semantic `asOf` values live inside JSON payloads. Therefore SQL can perform a coarse bounded read, but the final choice must be a pure, unit-tested selector over typed candidates.
5. `findFreshByKind` only checks the persisted `is_stale` flag. A row that was fresh at ingestion may have expired since then. Derivation must compare `validUntilUnixMs` with the explicit evaluation time and cannot silently trust that query.
6. Exact provider values are already normalized as decimal strings for Pyth, Jupiter, Orca, and CLMM price labels. The existing CLMM contract also carries a binary floating-point `currentPrice`, but feature math should prefer `currentPriceLabel`, `lowerPriceLabel`, and `upperPriceLabel` to avoid needless precision loss.
7. Existing provenance can represent the required chain: feature `derivedFromRefs` can point to normalized rows, while `rawObservationRefs` and `sourceRefs` can be flattened from those rows. No new source calls or raw records are needed.
8. Existing confidence and freshness helpers are pure and registry-driven, but they were designed around available artifacts. Feature derivation needs an explicit result envelope and status-aware provenance rules so a legitimate missing-input result can be persisted without inventing a source reference.

## Goals

- Implement exactly the seven MVP feature kinds as pure, versioned calculations.
- Make selection deterministic, visible, and independently unit-testable.
- Persist available, degraded-but-usable, and unavailable outcomes without fake zeros.
- Preserve exact normalized input IDs plus raw/source lineage.
- Ensure a replay of the same derivation identity returns the existing row, while a formula/version/input change creates a new row.
- Document enough sampling and rounding detail to reproduce golden fixtures.

## Non-goals

- No new source collectors or changes to upstream APIs.
- No fee APR, inventory, expected fee capture, fee-to-volatility, rebalance-cost, breach-probability, wick, breakout, volume-confirmation, liquidity-cliff, route-risk, flow, perp, funding, liquidation, news, support/resistance, or LLM-derived feature.
- No evidence-bundle construction or publication.
- No research briefs, PolicyInsight synthesis, recommendations, or policy decisions.
- No clmm-v2 UI or execution changes, wallet operations, quote sizing for a real trade, transaction construction, signing, or submission.
- No general feature DSL or plugin framework.

## Design decisions

### 1. Introduce one typed feature result envelope

Add a `DerivedFeatureV1` discriminated contract containing:

- `schemaVersion: 1`;
- canonical `featureKind`;
- `status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE"`;
- `value: number | null` and `unit: "BPS" | "PPM"`;
- `pair: "SOL/USDC"`, optional `poolId`, and position identity for the three position-scoped kinds;
- `asOfUnixMs` and `expiresAtUnixMs`;
- `confidence` and immutable freshness state;
- sorted `inputObservationIds` and `rejectedObservationIds`;
- complete `provenance`;
- sorted warning/reason codes;
- `calculatorVersion` and `selectionVersion`;
- calculation metadata needed to reproduce the result, such as range classification or volatility sample coverage.

The status invariant is strict:

- `AVAILABLE` has a non-null finite value and all required inputs are fresh, valid, and complete.
- `PARTIAL` has a non-null finite value, but at least one input has a nonfatal quality degradation. Examples are an Orca provider warning with both required fields present or a wide Pyth confidence interval used by divergence. `PARTIAL` never means “we guessed a missing operand.”
- `UNAVAILABLE` always has `value: null`. Missing, expired, malformed, semantically inconsistent, insufficient-window, invalid-range, and zero/negative-denominator cases land here.

Below-range and above-range positions are valid market states, not missing data. Their range features remain `AVAILABLE` unless another input defect exists, with explicit classification warnings that disambiguate a clamped zero or one.

Runtime validation should parse the result before persistence and enforce the status/value, unit/kind, and scope/kind relationships. Expected data failures return an `UNAVAILABLE` result; programmer violations of the result contract throw and prevent persistence.

### 2. Keep database reads coarse and final selection pure

Extend `NormalizedObservationRepo` with a bounded candidate-list operation accepting source/kind pairs and a receipt-time lower bound. The Drizzle adapter may filter those indexed columns and return a stable `(receivedAtUnixMs, id)` order. It must not decide “latest,” inspect JSON scope fields, or hide tie-breaking in SQL.

Pure selector functions then:

1. validate and narrow the unknown payload to the expected normalized contract;
2. match exact pair and requested pool/position identity;
3. enforce the required canonical source;
4. enforce persisted `isStale`, `validUntilUnixMs > evaluationAsOfUnixMs`, and payload-specific validity;
5. order by semantic observation time, then provider slot when available, then `receivedAtUnixMs`, then normalized row ID;
6. return both selected rows and rejected candidate IDs/reasons.

The application request is explicit:

```text
pair = SOL/USDC
poolId = configured Whirlpool address
positionIds = non-empty caller-supplied position identities
evaluationAsOfUnixMs = injected clock value
```

The use case derives three range features per requested position and the four pair/pool features once. Requiring position IDs is intentional: without a requested identity, the system cannot persist an auditable “position unavailable” result. A future scheduler may discover the IDs from another bounded workflow, but discovery is not part of calculator behavior.

For point-in-time features, `asOf` is the maximum semantic timestamp among selected inputs and expiry is the minimum input `validUntilUnixMs`. Multi-source oracle/DEX inputs may differ by at most 30 seconds; larger skew is unavailable. Coarse query windows include a small receipt-time safety margin, but acceptance is always decided from payload time.

### 3. Use exact scaled-integer arithmetic and one rounding rule

Add a small pure decimal/rational helper that parses signed decimal strings into `BigInt` coefficient/scale pairs, performs rational multiplication and division, and rounds to an integer. It must reject empty strings, exponent notation, non-finite values, and division by zero.

All BPS and PPM values are stored as scaled integers. The common rounding rule is **nearest integer, ties away from zero**. This rule applies only after the complete rational formula, never to intermediate operands. Outputs must remain within JavaScript's safe-integer range before conversion to `number`; otherwise the result is `UNAVAILABLE` with `numeric_overflow`. This retains the existing numeric port without silently truncating large values.

Realized volatility is the one deliberate floating-point calculation because ECMAScript `Math.log` is needed. Exact decimal strings are validated as positive and converted to finite numbers only for log returns; the final nonnegative BPS result uses the same nearest-integer rule. The calculator version records this semantic explicitly.

### 4. Define each calculator precisely

#### Range location (`range-location/v1`)

Input: one fresh clmm-v2 `position_state` matching pair and position.

Use exact `currentPriceLabel`, `lowerPriceLabel`, and `upperPriceLabel` values:

```text
raw = (current - lower) / (upper - lower)
value = clamp(raw, 0, 1) * 1_000_000 PPM
```

Require all prices positive and `upper > lower`. Validate that the payload's `rangeState` agrees with price ordering; disagreement is unavailable rather than silently trusting either representation. Emit one of `below_range_clamped`, `in_range`, `above_range_clamped`, `at_lower_boundary`, or `at_upper_boundary` in calculation metadata/warnings.

#### Distance to lower (`distance-to-lower/v1`)

Use the same selected position and validation:

```text
value = ((current - lower) / current) * 10_000 BPS
```

Do not clamp. A negative value explicitly represents price below the lower bound.

#### Distance to upper (`distance-to-upper/v1`)

Use the same selected position and validation:

```text
value = ((upper - current) / current) * 10_000 BPS
```

Do not clamp. A negative value explicitly represents price above the upper bound.

#### Oracle–DEX divergence (`oracle-dex-divergence/v1`)

Inputs: the latest eligible Pyth `oracle_price` and latest eligible Jupiter `executable_quote`, both for SOL/USDC and no more than 30 seconds apart.

Require Pyth status `trading`, positive oracle price, `routeAvailable: true`, and a positive Jupiter implied price. Do not use clmm-v2 pool price or Jupiter Price v3 as a substitute.

```text
value = abs(dexPrice - oraclePrice) / oraclePrice * 10_000 BPS
```

A wide Pyth interval or a nonfatal Jupiter quality warning makes the result `PARTIAL`, retains the numeric value, and propagates the warning and confidence degradation. A missing route, expired input, or excessive temporal skew is `UNAVAILABLE`.

#### Oracle confidence width (`oracle-confidence-width/v1`)

Input: the latest eligible Pyth `oracle_price`. Require `trading`, positive price, and nonnegative confidence.

```text
value = confidence / oraclePrice * 10_000 BPS
```

The width is still a valid measurement when it is large; emit `oracle_confidence_wide`, degrade confidence, and use `PARTIAL` rather than suppressing the observed width. Halted/auction, stale, malformed, or nonpositive-price observations are unavailable.

#### One-hour realized volatility (`realized-volatility-1h/v1`)

Accepted series: Pyth `oracle_price` only. Jupiter executable quotes are amount- and route-specific and are not mixed into the time series.

Selection and sampling policy:

- Anchor `asOf` to the latest eligible fresh Pyth observation at or before evaluation time.
- Include valid `trading`, positive-price samples in the inclusive window `[asOf - 3_600_000 ms, asOf]`.
- Sort by Pyth observed timestamp ascending. For duplicate timestamps, retain the row with the highest slot, then highest `receivedAtUnixMs`, then highest normalized ID; record discarded IDs.
- Out-of-order database results are harmless because sorting occurs before calculation.
- Require at least 10 distinct samples, at least 45 minutes between the first and last sample, and no adjacent gap greater than 10 minutes.
- Historical samples inside the window need not still be fresh at evaluation time; only the anchor must be fresh. Requiring every historical point to be currently unexpired would make a one-hour series impossible under the 60-second oracle policy.

For ordered prices `p[0..n-1]`:

```text
r[i] = ln(p[i] / p[i-1])
realizedVolatility = sqrt(sum(r[i]^2))
value = realizedVolatility * 10_000 BPS
```

This is a non-annualized one-hour realized-volatility measure with no mean subtraction and no time-scaling factor. Insufficient samples, insufficient span, an excessive gap, or a non-finite return is unavailable. Calculation metadata records sample count, first/last timestamps, maximum gap, and duplicate IDs.

#### Twenty-four-hour volume/liquidity ratio (`volume-liquidity-ratio-24h/v1`)

Input: latest eligible Orca `pool_statistics` matching pair and pool, with `window: "24h"`.

Use `volume24hUsdc` as rolling 24-hour swap volume and `tvlUsdc` as the Orca pool TVL/liquidity denominator documented by #24:

```text
value = volume24hUsdc / tvlUsdc * 1_000_000 PPM
```

Missing volume or TVL, or TVL less than or equal to zero, is unavailable. Zero volume with positive TVL is a legitimate available zero. A provider warning with both operands present yields `PARTIAL`; it does not replace either value.

### 5. Propagate confidence and freshness conservatively

Add a pure feature-confidence helper. For selected inputs it takes the component-wise minimum of source reliability, completeness, and derivation confidence, applies the feature registry policy, applies an explicit partial-quality factor where applicable, and caps the final composite at the lowest input composite. Therefore a derived feature cannot be more confident than its weakest input.

For unavailable results, confidence is low with a zero derivation-confidence component and a reason such as `required_component_missing`; it is never fabricated as high confidence. If rejected rows exist, their confidence and lineage remain visible.

`expiresAtUnixMs` is the feature contract name. The adapter maps it to the existing `derived_features.valid_until_unix_ms` column, whose semantics already match the required expiry. This avoids a redundant timestamp column. Available/partial results are stale when that time is reached. An unavailable result expires immediately at its deterministic evaluation time unless it is deduplicated as the same derivation outcome.

Feature provenance is assembled as follows:

- `derivedFromRefs`: one `normalized_observation` ref per selected or outcome-determining rejected normalized row, sorted by ID;
- `rawObservationRefs`: de-duplicated raw refs flattened from those normalized observations;
- `sourceRefs`: de-duplicated source refs from the same provenance;
- `processRef`: derivation job/use-case identity, pipeline run ID, code version, and no model version;
- `codeVersion`: repository code version;
- calculator and selection versions: explicit feature fields, not overloaded into `codeVersion`.

Provenance validation becomes status-aware. Available and partial results must meet each kind's source/ref minima. Unavailable results may have no refs when nothing was observed, but must have at least one stable reason code; when a rejected candidate exists its lineage is mandatory.

### 6. Make persistence first-class and idempotent

Add a migration and update the Drizzle schema/port with:

- `status varchar NOT NULL` with an `AVAILABLE|PARTIAL|UNAVAILABLE` check;
- `unit varchar NOT NULL` with a `BPS|PPM` check;
- `pair varchar NOT NULL`;
- `pool_id text NULL` and `position_id text NULL`;
- `calculator_version varchar NOT NULL`;
- `selection_version varchar NOT NULL`;
- `input_observation_ids integer[] NOT NULL`;
- `rejected_observation_ids integer[] NOT NULL`;
- `derivation_key varchar(64) NOT NULL`;
- required `structured_payload` containing reason codes and calculation metadata.

Add checks that unavailable rows have null values, available/partial rows have non-null values, and position-scoped kinds have a position ID. Add a feature-kind check containing exactly the seven canonical identifiers. The migration must abort on unexpected historical feature kinds rather than delete or rewrite them; the design assumes the table has no production feature rows because no writer currently exists.

`derivationKey` is the canonical hash of:

```text
schema version + feature kind + scope + calculator version + selection version
+ sorted selected IDs + sorted outcome-determining rejected IDs + stable reason codes
```

The actual result payload is separately canonically hashed into `payloadHash`. The unique key becomes `(feature_kind, derivation_key)`. Formula or selector changes require a version change and therefore create a new row. A changed observation set creates a new row. Re-running the same versioned selection outcome returns the existing row. Scope and reasons are included so two missing positions, or missing versus expired evidence, do not collapse into one unavailable record.

Add `insertMany` to `DerivedFeatureRepo` and implement it transactionally with conflict recovery in caller order, following the normalized-observation repository pattern. The application builds and validates all requested results before inserting any of them, so a programming error cannot persist half a tranche. Expected unavailable results are ordinary valid rows.

### 7. Orchestrate through one application use case

`deriveMvpFeatures` receives repositories, clock, run ID/code version inputs, and the explicit request scope. It performs no external HTTP calls.

Data flow:

```text
bounded candidate reads from normalized_observations
                 |
                 v
pure payload validation and deterministic selection
                 |
       +---------+--------------------+
       |         |          |         |
  position     Pyth      Jupiter     Orca
   state       series      quote     24h stats
       |         |          |         |
       +---- seven pure calculators --+
                 |
       confidence/freshness/lineage
                 |
     runtime result-contract validation
                 |
       transactional idempotent insert
                 |
          derived_features
```

A thin job and operator script may expose the use case and print counts by status plus stable warnings. Complete calculation and partial/unavailable evidence are all successful command execution if persistence succeeds; infrastructure, validation-contract, or database failures are command failures. This command does not publish a bundle.

## Alternatives considered

### A. Pure selectors and calculators behind one application use case — recommended

This follows the current architecture, makes every business choice testable without a database, and adds only the persistence fields needed for auditability. The trade-off is a somewhat richer result contract and a coarse candidate query, but both are explicit and bounded.

### B. Put “latest valid” logic in Drizzle/SQL

Postgres JSON expressions and window functions could return one row per scope efficiently. This was rejected for the MVP because pair/position/as-of fields are embedded in versioned JSON payloads and the issue explicitly requires unit-testable selection. It would also make tie-breaking and malformed-payload behavior adapter-specific. If candidate volume later becomes material, normalized identity columns can be added as a separate indexing change while retaining the pure selector as the semantic authority.

### C. Have each calculator query its own inputs and persist its own row

This minimizes central orchestration, but couples pure formulas to I/O, repeats source/freshness/tie-breaking rules, and makes a consistent tranche snapshot difficult. It violates the repository boundary and the issue guardrail.

### D. Store only successful scalar values in the existing table

The current nullable scalar and JSONB fields could technically hold the seven values. This was rejected because unavailable states, units, scopes, versions, and input identities would be convention-only and hard to query or constrain. It would preserve the exact audit gaps this issue is intended to close.

## Error handling

| Condition                                                    | Result                                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| No matching normalized row                                   | `UNAVAILABLE`, `missing_input`, null value                                    |
| Payload fails its normalized contract                        | `UNAVAILABLE`, `malformed_normalized_input`, null value, rejected-row lineage |
| Persisted stale flag or expiry at evaluation time            | `UNAVAILABLE`, `stale_input`, null value                                      |
| Invalid/nonpositive range denominator or current price       | `UNAVAILABLE`, stable invalid-range reason                                    |
| Pyth halted/auction or nonpositive oracle price              | `UNAVAILABLE`, stable oracle-status reason                                    |
| Jupiter route unavailable or implied price absent            | `UNAVAILABLE`, `route_unavailable`                                            |
| Oracle/DEX timestamps differ by more than 30 seconds         | `UNAVAILABLE`, `input_time_skew_exceeded`                                     |
| Wide oracle interval/provider warning but valid operands     | `PARTIAL`, numeric value retained                                             |
| Too few volatility samples, short coverage, or excessive gap | `UNAVAILABLE`, exact coverage reason                                          |
| Missing/zero/negative Orca TVL                               | `UNAVAILABLE`, null value; never zero                                         |
| Exact arithmetic exceeds safe output range                   | `UNAVAILABLE`, `numeric_overflow`                                             |
| Result contract or provenance invariant is violated          | Throw before any feature insert                                               |
| Database transaction fails                                   | Roll back the requested batch and fail the command                            |
| Unique-key replay                                            | Return existing feature row in deterministic caller order                     |

All warning and reason arrays are sorted and de-duplicated before hashing and persistence.

## Testing strategy

### Contract and taxonomy tests

- The seven kinds are the exhaustive canonical feature set and map to the correct family, signal class, unit, freshness policy, confidence policy, and allowed sources.
- Runtime parsing enforces status/value, kind/unit, scope, timestamps, sorted IDs, finite safe-integer values, and calculator versions.
- Removed placeholder kinds fail feature-kind parsing.

### Selector tests

- Exact pair, pool, and position matching.
- Source allowlists: Pyth for oracle/volatility, Jupiter quote for DEX, Orca for volume/TVL, clmm-v2 for ranges.
- Semantic as-of ordering plus slot, receipt time, and normalized-ID tie-breaks.
- Stored-fresh-but-now-expired rows are rejected.
- Malformed newest rows do not become valid by accident; rejection is explicit and deterministic.
- Duplicate timestamps and out-of-order volatility rows produce the same ordered series and discarded-ID list.

### Calculator and golden-fixture tests

- Below-range, in-range, exact-boundary, and above-range location results and warnings.
- Signed lower/upper distances.
- Invalid and zero-width ranges.
- Exact divergence and confidence-width BPS rounding.
- Stale oracle, unavailable Jupiter route, wide oracle confidence, and excessive source time skew.
- Non-annualized volatility golden series, inclusive boundary, minimum 10 samples, 45-minute coverage, maximum 10-minute gap, duplicate timestamps, and nonpositive prices.
- Exact volume/TVL PPM result, legitimate zero volume, absent liquidity, and zero/negative liquidity.
- Decimal magnitudes near rounding ties and safe-integer overflow.
- Purity checks demonstrate that calculators depend only on arguments.

### Application and persistence tests

- Three results are produced per requested position and four once per pair/pool.
- Selected and rejected IDs, flattened raw lineage, confidence cap, expiry minimum, and versions are preserved.
- Available, partial, and unavailable rows all persist.
- Same derivation identity is idempotent under sequential and concurrent replays.
- Changed input IDs, scope, calculator version, selection version, or reasons produce a distinct row.
- Batch persistence preserves request order and rolls back on failure.
- Migration/schema tests cover all checks and the exact seven-kind allowlist.
- Full `pnpm verify` remains the final local gate.

## Assumptions

1. The issue's uppercase names describe enum concepts; lowercase snake-case values are the canonical wire/database identifiers because that is the repository-wide taxonomy convention.
2. The existing four feature kinds are unused placeholders. The derived feature table contains no production rows for them; the migration will fail safely rather than deleting data if this assumption is wrong.
3. clmm-v2 price labels are canonical plain decimal strings. The current validator accepts arbitrary strings, so derivation performs stricter decimal validation and treats invalid labels as unavailable.
4. Pyth remains the only canonical oracle series for this tranche, Jupiter executable quote remains the DEX price, and Orca TVL is the intended liquidity denominator.
5. A 30-second maximum Pyth/Jupiter skew is appropriate because Jupiter quotes expire after 30 seconds in the current taxonomy.
6. Pyth is collected often enough that 10 observations spanning at least 45 minutes with no gap above 10 minutes is attainable. Until that coverage exists, volatility is correctly unavailable.
7. Non-annualized `sqrt(sum(logReturn^2))` is the intended v1 realized-volatility definition.
8. Integer BPS/PPM outputs with nearest/ties-away-from-zero rounding are sufficient for downstream evidence. Raw operands and formula metadata remain available for audit.
9. Caller-supplied pool and position identities are available to the derivation job. This is necessary to record scoped unavailability rather than silently omitting a missing position.
10. Candidate volume remains small enough for bounded coarse reads and pure in-memory selection. Indexing JSON scope fields is deferred until measured query volume justifies it.
11. Existing `valid_until_unix_ms` can represent the required feature `expiresAt` semantic without a redundant database column.
12. Unavailable evidence is useful for audit and should be persisted, but it is not eligible for later evidence-bundle publication as a numeric fact.

## Risks and concerns

### Normalized payload fields are not indexed

Pair, pool, position, and source observation time are JSON fields. Bounded reads are correct for the MVP but may become expensive with 365-day warm retention. Query metrics should determine whether a later migration promotes these identities to columns.

### Freshness is partly dynamic

Persisted `isStale` describes ingestion time, while expiry continues to advance. Every feature selector must check `validUntilUnixMs` against its explicit evaluation time. Reusing `findFreshByKind` would admit expired evidence and is specifically unsafe.

### CLMM labels are weakly validated upstream

The normalized CLMM contract types price labels as strings, and its source validator does not currently require decimal syntax. The derivation boundary must validate them strictly. Tightening upstream normalization may be desirable later, but this issue should not mutate historical normalized payloads.

### Floating-point volatility reproducibility

`Math.log` cannot use the exact rational path. Versioning the formula, validating conversion, storing the selected price strings/sample metadata, and rounding only at the end bound the risk. Cross-language consumers should treat the stored integer result as canonical rather than recomputing it with another math library.

### Confidence has multiple meanings

Pyth's confidence interval, repository evidence confidence, and feature availability status are separate. The design preserves all three. Collapsing a wide oracle interval into `UNAVAILABLE` would hide a useful measurement; ignoring it in propagated confidence would overstate quality.

### Unavailable-result deduplication needs a complete identity

An unavailable calculation may have no selected input. Scope, rejected IDs, stable reasons, and selector version must therefore be part of the derivation key. Omitting any of them could collapse distinct operational failures into one row.

### Provenance retention is logical rather than relational

Provenance IDs in JSON/arrays are not foreign keys, and raw observations have shorter retention than derived features. Payload hashes and flattened references preserve audit identity after hot-row expiry, but durable raw archival policy remains a broader persistence concern.

### Migration compatibility

Adding non-null/check-constrained fields assumes the table is unused. The migration must perform a precondition check and abort with an actionable error on historical rows instead of inventing statuses, units, or versions for data it cannot classify reliably.

## Documentation deliverables

Update the taxonomy and architecture documentation, README feature inventory, and operator runbook to list these seven as the implemented MVP tranche, state the exact formulas/sampling/rounding rules, show one available and one unavailable invocation/result, and repeat the deferred #8 feature list. Documentation must state that derived features are deterministic evidence only and do not authorize a rebalance or any execution action.
