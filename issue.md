# feat: derive the deterministic MVP SOL/USDC evidence feature tranche

## Summary

Implement and persist the first bounded deterministic feature tranche for the SOL/USDC evidence pipeline using normalized observations produced by the core ingestion children.

This is a PR-sized child of #8. It intentionally implements exactly seven features needed to prove the initial vertical slice and defers broader CLMM economics, breakout, liquidity-cliff, route-risk, and contextual metrics.

## Required feature set

Implement exactly these feature kinds for the MVP tranche:

1. `RANGE_LOCATION`
2. `DISTANCE_TO_LOWER`
3. `DISTANCE_TO_UPPER`
4. `ORACLE_DEX_DIVERGENCE`
5. `ORACLE_CONFIDENCE_WIDTH`
6. `REALIZED_VOLATILITY_1H`
7. `VOLUME_LIQUIDITY_RATIO_24H`

Extend the canonical taxonomy/registry, validation, persistence enums/checks, docs, and fixtures as needed so these kinds are first-class and exhaustively handled.

## Feature contracts

Every derived feature must record at minimum:

- stable feature kind;
- `AVAILABLE`, `PARTIAL`, or `UNAVAILABLE` status;
- numeric value or `null`;
- explicit unit (`BPS` or `PPM` as appropriate);
- pair and position identity where position-scoped;
- `asOf` and `expiresAt` timestamps;
- confidence and freshness state;
- normalized input observation IDs;
- provenance/lineage sufficient to trace through normalized observations to raw source payloads;
- warnings/reason codes explaining partial or unavailable results;
- calculator/version identity so historical values remain auditable after formula changes.

Do not persist fake zero values for missing or invalid inputs.

## Deterministic calculations

### 1. Range location

For a valid position range:

```text
rawLocation = (currentPrice - lowerPrice) / (upperPrice - lowerPrice)
rangeLocationPpm = clamp(rawLocation, 0, 1) * 1_000_000
```

The feature must preserve enough status/warning context to distinguish below-range and above-range observations from a position genuinely centered at a boundary-clamped value.

Unit: `PPM`.

### 2. Distance to lower boundary

```text
distanceToLowerBps = ((currentPrice - lowerPrice) / currentPrice) * 10_000
```

A negative result means current price is below the lower boundary.

Unit: `BPS`.

### 3. Distance to upper boundary

```text
distanceToUpperBps = ((upperPrice - currentPrice) / currentPrice) * 10_000
```

A negative result means current price is above the upper boundary.

Unit: `BPS`.

### 4. Oracle–DEX divergence

```text
oracleDexDivergenceBps = abs(dexPrice - oraclePrice) / oraclePrice * 10_000
```

Use a fresh canonical oracle price and a fresh Jupiter executable-quote implied price. Do not substitute the clmm-v2 current pool price for either source silently.

Unit: `BPS`.

### 5. Oracle confidence width

```text
oracleConfidenceWidthBps = oracleConfidence / oraclePrice * 10_000
```

Use the confidence value from the canonical oracle observation and preserve stale/invalid oracle status explicitly.

Unit: `BPS`.

### 6. One-hour realized volatility

Use timestamp-ordered price observations and log returns:

```text
logReturn[t] = ln(price[t] / price[t-1])
```

Compute a documented one-hour realized-volatility value from a deterministic sampling policy. The implementation must define and test:

- accepted source/price series;
- one-hour lookback boundary;
- minimum sample count;
- maximum allowed gap;
- duplicate timestamp handling;
- out-of-order observation handling;
- annualized versus non-annualized semantics.

Prefer a non-annualized one-hour measure for the first version unless existing repository conventions strongly require otherwise. The exact formula and scaling must be documented and versioned.

Unit: `BPS`.

### 7. Twenty-four-hour volume/liquidity ratio

```text
volumeLiquidityRatio24hPpm = volumeUsd24h / liquidityUsd * 1_000_000
```

The implementation must use the documented Orca liquidity/TVL semantic from #24. Zero or negative denominators are invalid/unavailable, not successful zero-valued features.

Unit: `PPM`.

## Input selection

Add an application use case that selects the required normalized observations deterministically by:

- pair and position identity;
- supported observation kind;
- freshness and expiry;
- source identity/quality where relevant;
- latest valid `asOf` time with deterministic tie-breaking;
- documented minimum coverage for windowed calculations.

Input selection must not be hidden inside SQL that cannot be unit tested. Keep calculators pure and separate from persistence/query orchestration.

## Persistence and idempotency

- Persist successful, partial, and unavailable feature results in `derived_features` where the existing schema supports auditable unavailable states.
- Re-running derivation over the same calculator version and same normalized input set must be idempotent or deterministically deduplicated.
- A changed input set or calculator version must produce a distinct auditable result rather than overwriting historical values.

## Explicitly deferred features

Do not implement these in this issue:

- inventory skew;
- fee APR or fee yield;
- expected fee capture;
- fee-to-volatility ratio;
- rebalance cost;
- breach probability/risk model beyond direct range distances;
- wick/spike detection;
- breakout or volume confirmation;
- liquidity-cliff detection;
- route/slippage or landing-risk scoring;
- support/resistance, flows, perps, funding, liquidations, news, or LLM-derived metrics.

Parent #8 remains open for those later tranches.

## Scope

In scope:

- taxonomy/registry additions for the seven feature kinds;
- pure deterministic calculators;
- normalized-input selection use cases;
- confidence/freshness propagation;
- lineage and calculator versioning;
- derived-feature persistence and idempotency;
- fixtures, tests, docs, and operator/developer examples.

Out of scope:

- new source collectors;
- evidence-bundle assembly;
- LLM research briefs;
- Regime Engine publishing or policy synthesis;
- clmm-v2 UI or execution behavior.

## Guardrails

- All numerical metrics are calculated by code, never by an LLM.
- Calculators are pure and do not read environment variables, clocks, HTTP, or the database directly.
- Missing, stale, invalid, or insufficient inputs return explicit partial/unavailable results with reasons.
- Freshness/confidence cannot improve beyond the quality of the underlying inputs.
- Research evidence cannot become execution authority.
- Decimal/large-integer handling must avoid silent precision loss; numeric representation and rounding rules must be documented.

## Acceptance criteria

- [ ] All seven required feature kinds exist in the canonical taxonomy and persistence model.
- [ ] Each feature is implemented as a pure, unit-tested deterministic calculator.
- [ ] Application logic selects inputs deterministically and keeps selection separate from calculation.
- [ ] Each persisted result records status, value/unit, time bounds, confidence/freshness, warnings, calculator version, and complete input lineage.
- [ ] Missing, stale, malformed, insufficient-window, zero-denominator, and invalid-range inputs produce explicit partial/unavailable results rather than fake zeros or NaN/Infinity.
- [ ] Re-running the same calculator version over the same input set is idempotent or deterministically deduplicated.
- [ ] Tests cover below-range, in-range, above-range, stale oracle, unavailable Jupiter route, wide oracle confidence, insufficient volatility samples, out-of-order samples, excessive sample gaps, and unavailable Orca liquidity.
- [ ] Golden fixtures demonstrate exact expected units and rounding for every feature.
- [ ] Documentation lists these seven as the implemented MVP tranche and explicitly lists all deferred #8 features.

## Parent

Child of #8.

## Blocked by

- #22
- #23
- #24

The implementation must derive from persisted normalized observations produced by those ingestion children rather than calling source APIs directly.
