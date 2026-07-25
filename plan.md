<!-- plan-review-required -->

# Perp and Liquidation Research Collectors (Pack C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect, normalize, enrich, and persist auditable SOL/USDC perpetual-market observations from Binance Futures and Drift, derive deterministic crowding/stress features, and schedule the collector with explicit partial, stale, and unavailable states.

**Architecture:** Add a venue-neutral `PerpLiquidationSourcePort`; HTTP adapters translate venue payloads into source facts before the application or domain sees them. Pure domain modules validate and normalize facts, assign freshness/confidence/provenance, and derive four BPS-valued features. The application writes immutable raw rows, normalized rows, and idempotent derived features, while the job and script reduce two-source outcomes without making policy decisions.

**Tech Stack:** TypeScript 5.7, Vitest, Zod, Drizzle ORM/PostgreSQL, the existing `HttpClient`, `RetryControl`, repository ports, and OpenClaw cron configuration.

---

## Goal

Deliver Pack C for the `perp_liquidation` evidence family:

- normalized `funding_rate`, `open_interest`, `perp_basis`, `liquidation_event`, and `leverage_proxy` observations;
- deterministic `oi_trend_4h`, `funding_rate_annualized`, `liquidation_cluster_1h`, and `basis_spread_bps` features;
- Binance USDⓈ-M market context and Drift SOL-PERP context with venue payloads contained inside adapters;
- source, observation time, freshness, confidence, and raw-to-normalized-to-feature lineage on every persisted value;
- an explicitly degraded result when one source or metric is unavailable or stale.

## Non-goals

- No trading, rebalancing, risk-rule, or PolicyInsight decision.
- No LLM research brief or final narrative synthesis.
- No evidence-bundle publication or regime-engine wire-contract change.
- No WebSocket service, streaming daemon, or millisecond liquidation trigger.
- No authenticated Binance account/user-data endpoint. In particular, do not use Binance `allForceOrders`; Binance liquidation coverage is reported unavailable because the documented endpoint is `USER_DATA`.
- No additional venue beyond `binance-fapi` and `drift-api`.
- No claim that missing liquidation records means that no liquidation risk exists.

## Assumptions and source contract

- The pair is canonically `SOL/USDC`; Binance uses the configured SOL stablecoin perpetual symbol and Drift uses a configured SOL-PERP market index.
- Binance public market-data REST supplies funding history, open-interest history, mark/index price for basis, and a long/short ratio for the leverage proxy. Its snapshot must mark liquidation coverage unavailable.
- Drift must expose public, read-only REST/RPC responses for funding, OI/market prices, and historical liquidation records. Validate endpoint availability and field precision before implementation. Do not guess precision.
- All decimals cross adapter/domain boundaries as canonical base-10 strings. Conversion to safe integer BPS happens only in pure derivation code.
- `liquidation_cluster_1h` is liquidation notional divided by the latest usable OI notional in the same venue/window, expressed in BPS. This avoids adding a new database/evidence unit.
- Feature scope is pair-wide (`poolId` and `positionId` are null). Venue composition and per-venue subtotals live in `calculationMetadata`.
- Missing one metric yields partial/degraded coverage; missing all usable observations across both venues makes the command unavailable or failed according to the failure type.

## Affected files

**Create:**

- `src/contracts/perp-liquidation.ts`
- `src/ports/perp-liquidation-source.ts`
- `src/adapters/node/http-binance-fapi-source.ts`
- `src/adapters/node/http-drift-source.ts`
- `src/domain/perp-liquidation/validate.ts`
- `src/domain/perp-liquidation/normalize.ts`
- `src/domain/perp-liquidation/identity.ts`
- `src/domain/perp-liquidation/enrich.ts`
- `src/domain/perp-liquidation/derive.ts`
- `src/domain/perp-liquidation/index.ts`
- `src/application/collect-perp-liquidation.ts`
- `src/jobs/perp-liquidation-job.ts`
- `scripts/collectors/perp-liquidation.ts`
- `cron/routines/perp-liquidation.md`
- `tests/fixtures/perp-liquidation.ts`
- `tests/fakes/fake-perp-liquidation-source.ts`
- `tests/contracts/perp-liquidation.test.ts`
- `tests/adapters/node/http-binance-fapi-source.test.ts`
- `tests/adapters/node/http-drift-source.test.ts`
- `tests/domain/perp-liquidation/validate.test.ts`
- `tests/domain/perp-liquidation/normalize.test.ts`
- `tests/domain/perp-liquidation/identity.test.ts`
- `tests/domain/perp-liquidation/enrich.test.ts`
- `tests/domain/perp-liquidation/derive.test.ts`
- `tests/application/collect-perp-liquidation.test.ts`
- `tests/jobs/perp-liquidation-job.test.ts`
- `tests/scripts/perp-liquidation.test.ts`
- `tests/db/migrations/perp-liquidation-feature-kinds.test.ts`
- `tests/fixtures/cron/routines/perp-liquidation.md`
- `tests/fixtures/cron/perp-liquidation-jobs.yaml`
- `drizzle/0007_perp_liquidation_feature_kinds.sql`
- `drizzle/meta/0007_snapshot.json`

**Modify:**

- `src/contracts/taxonomy.ts`
- `src/contracts/derived-feature.ts`
- `src/contracts/index.ts`
- `src/domain/taxonomy/registry.ts`
- `src/db/schema/derived-features.ts`
- `src/application/assemble-evidence-bundle.ts`
- `src/domain/evidence-bundle/assemble.ts`
- `src/domain/evidence-bundle/quality.ts`
- `src/domain/evidence-bundle/select.ts`
- `src/jobs/index.ts`
- `tests/domain/taxonomy/registry.test.ts`
- `tests/domain/derived-feature/contract.test.ts`
- `tests/db/schema/derived-features.test.ts`
- `tests/domain/evidence-bundle/assemble.test.ts`
- `tests/domain/evidence-bundle/context-events-assemble.test.ts`
- `tests/domain/evidence-bundle/quality.test.ts`
- `tests/domain/evidence-bundle/select.test.ts`
- `tests/fakes/index.ts`
- `drizzle/meta/_journal.json`
- `package.json`
- `.env.example`
- `cron/jobs.yaml`

## Behavioral invariants

The exact test names below are mandatory and must be written before their implementation.

1. **Venue boundary:** `keeps venue response fields inside adapters and emits only canonical source facts`.
2. **Retry boundary:** `retries retryable source failures and never retries malformed responses`.
3. **Signed funding:** `preserves positive and negative funding rates through normalization and annualization`.
4. **OI direction:** `derives positive BPS for rising OI and negative BPS for falling OI`.
5. **Feature sufficiency:** `marks OI trend unavailable when fewer than two usable samples exist`.
6. **Liquidation denominator:** `marks liquidation cluster unavailable when no same-venue positive OI denominator exists`.
7. **Stale transition:** `transitions a persisted fresh fact to degraded evidence when freshness policy marks the input stale`.
8. **Unavailable transition:** `transitions one unavailable venue plus one usable venue to PARTIAL without failing the command`.
9. **All unavailable transition:** `transitions two unavailable venues to UNAVAILABLE and fails the command`.
10. **Persistence order:** `transitions a new fact from absent to raw pending to normalized and raw parsed before feature insertion`.
11. **Replay:** `transitions an identical fact from parsed to replayed without duplicate normalized or feature rows`.
12. **Conflict:** `transitions the same identity with a changed payload to conflict while preserving the immutable row`.
13. **Metric coverage:** `does not interpret unavailable liquidation coverage as a zero liquidation cluster`.
14. **Lineage:** `links every available feature to its selected normalized and raw observation ids`.

## Task 1: Add canonical perp contracts and taxonomy policies

**Files:**

- Create: `src/contracts/perp-liquidation.ts`
- Create: `tests/contracts/perp-liquidation.test.ts`
- Create: `tests/fixtures/perp-liquidation.ts`
- Modify: `src/contracts/taxonomy.ts`
- Modify: `src/contracts/derived-feature.ts`
- Modify: `src/contracts/index.ts`
- Modify: `src/domain/taxonomy/registry.ts`
- Modify: `src/domain/evidence-bundle/assemble.ts`
- Modify: `src/domain/evidence-bundle/quality.ts`
- Modify: `src/domain/evidence-bundle/select.ts`
- Modify: `src/application/assemble-evidence-bundle.ts`
- Modify: `tests/domain/taxonomy/registry.test.ts` (only the canonical kind arrays and a new `perp_liquidation policies` describe block)

- [ ] **Step 1: Write failing contract and registry tests**

  Test discriminated payloads for all five observation kinds, signed decimal funding, positive decimal amounts/prices, long/short liquidation side, canonical source names, and metric coverage. Add the new kinds to the existing exhaustive registry arrays and add:

  ```ts
  it("registers ephemeral perp facts as degrade-on-stale evidence", () => {
    for (const kind of [
      "funding_rate",
      "open_interest",
      "perp_basis",
      "liquidation_event",
      "leverage_proxy"
    ] as const) {
      const entry = getObservationKindEntry(kind);
      expect(entry.evidenceFamily).toBe("perp_liquidation");
      expect(entry.freshnessPolicy.staleBehavior).toBe("degrade_confidence");
      expect(entry.provenanceRequirements.allowedSourceRefs).toEqual(["binance-fapi", "drift-api"]);
    }
  });
  ```

- [ ] **Step 2: Verify the tests fail for absent kinds and contracts**

  Run: `pnpm vitest run tests/contracts/perp-liquidation.test.ts tests/domain/taxonomy/registry.test.ts`

  Expected: FAIL because the new contract and registry entries do not exist.

- [ ] **Step 3: Define venue-neutral contracts and taxonomy members**

  Add `binance-fapi` and `drift-api` to `Source`; add the five observation kinds and four feature kinds requested by the design to `FeatureKind` and `MVP_FEATURE_KINDS`. Also update exhaustive `FeatureKind` handling in evidence-bundle helpers (`src/domain/evidence-bundle/*.ts` and `src/application/assemble-evidence-bundle.ts`) so typecheck passes. Define this core shape and discriminated payloads:

  ```ts
  export type PerpVenue = "binance-fapi" | "drift-api";
  export type PerpMetricKind =
    | "funding_rate"
    | "open_interest"
    | "perp_basis"
    | "liquidation_event"
    | "leverage_proxy";

  export interface PerpObservationBaseV1 {
    readonly schemaVersion: 1;
    readonly evidenceFamily: "perp_liquidation";
    readonly pair: "SOL/USDC";
    readonly venue: PerpVenue;
    readonly instrument: string;
    readonly sourceEventId: string;
    readonly observedAtUnixMs: number;
  }

  export type PerpObservationPayloadV1 =
    | FundingRatePayloadV1
    | OpenInterestPayloadV1
    | PerpBasisPayloadV1
    | LiquidationEventPayloadV1
    | LeverageProxyPayloadV1;
  ```

  Use decimal strings for `fundingRate`, `openInterestBase`, `openInterestUsdc`, `perpPriceUsdc`, `spotPriceUsdc`, `amountBase`, `notionalUsdc`, and `longShortRatio`. Funding includes `fundingIntervalHours`; OI includes the provider sample window; basis includes both prices; liquidation includes `side`; leverage includes `methodology: "global_account_long_short_ratio" | "market_net_position_ratio"`. Coverage records must distinguish `available`, `unavailable`, and `malformed` with a diagnostic.

- [ ] **Step 4: Register freshness, confidence, and provenance policies**

  Register all observation and feature kinds as deterministic `perp_liquidation` evidence. Use 15-minute maximum age for funding, OI, basis, and leverage; 60 minutes for individual liquidation events; four hours for `oi_trend_4h`; one hour for `liquidation_cluster_1h`; and 15 minutes for annualized funding and basis. All use `degrade_confidence`, allow both approved sources, and use the existing deterministic confidence weighting pattern.

- [ ] **Step 5: Run focused tests and formatting**

  Run: `pnpm vitest run tests/contracts/perp-liquidation.test.ts tests/domain/taxonomy/registry.test.ts`

  Expected: PASS.

  Run: `pnpm exec eslint src/contracts/perp-liquidation.ts src/contracts/taxonomy.ts src/contracts/derived-feature.ts src/contracts/index.ts src/domain/taxonomy/registry.ts tests/contracts/perp-liquidation.test.ts tests/fixtures/perp-liquidation.ts tests/domain/taxonomy/registry.test.ts`

  Expected: exit 0.

- [ ] **Step 6: Commit**

  ```bash
  git add src/contracts/perp-liquidation.ts src/contracts/taxonomy.ts src/contracts/derived-feature.ts src/contracts/index.ts src/domain/taxonomy/registry.ts src/domain/evidence-bundle src/application/assemble-evidence-bundle.ts tests/contracts/perp-liquidation.test.ts tests/fixtures/perp-liquidation.ts tests/domain/taxonomy/registry.test.ts
  git commit -m "feat: define perp liquidation evidence taxonomy"
  ```

## Task 2: Extend derived-feature persistence for Pack C kinds

**Files:**

- Modify: `src/contracts/derived-feature.ts`
- Modify: `src/db/schema/derived-features.ts`
- Modify: `tests/domain/derived-feature/contract.test.ts` (only canonical-kind, BPS-unit, and pair-scope cases)
- Modify: `tests/db/schema/derived-features.test.ts` (only the feature allowlist/unit invariant block)
- Create: `tests/db/migrations/perp-liquidation-feature-kinds.test.ts`
- Create: `drizzle/0007_perp_liquidation_feature_kinds.sql`
- Create: `drizzle/meta/0007_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Write failing contract, schema, and migration tests**

  Add one table-driven case for each new feature proving it is canonical, requires `BPS`, and requires null pool/position scope. The migration test must assert that the old allowlist and relevant BPS/scope checks are dropped and recreated with the four Pack C kinds, and that the migration contains no `DELETE`, `UPDATE`, or `TRUNCATE`.

- [ ] **Step 2: Verify focused tests fail**

  Run: `pnpm vitest run tests/domain/derived-feature/contract.test.ts tests/db/schema/derived-features.test.ts tests/db/migrations/perp-liquidation-feature-kinds.test.ts`

  Expected: FAIL because the contract and database allowlists reject Pack C features.

- [ ] **Step 3: Extend the application-level feature contract and bundle assembly**

  Add the four kinds to the canonical feature-kind set and BPS-kind set in `src/contracts/derived-feature.ts`. Keep `FeatureUnit` unchanged (`BPS | PPM`) and make the new kinds pair-scoped:

  ```ts
  const PERP_BPS_KINDS = new Set([
    "oi_trend_4h",
    "funding_rate_annualized",
    "liquidation_cluster_1h",
    "basis_spread_bps"
  ]);
  ```

  `parseDerivedFeatureV1` must reject PPM for these kinds and reject non-null `poolId` or `positionId`.

  In `src/domain/evidence-bundle/assemble.ts`, `src/domain/evidence-bundle/quality.ts`, `src/domain/evidence-bundle/select.ts`, and `src/application/assemble-evidence-bundle.ts`, update evidence bundle selection and assembly helpers to recognize the new pair-wide Pack C feature kinds alongside existing feature types. Ensure bundle selection logic queries and selects `oi_trend_4h`, `funding_rate_annualized`, `liquidation_cluster_1h`, and `basis_spread_bps` when assembling SOL/USDC evidence bundles.

- [ ] **Step 4: Update Drizzle checks and generate a forward-only migration**

  Update `chk_features_kind_allowlist`, BPS checks, and pair-wide scope checks in the schema. Run:

  `pnpm exec drizzle-kit generate --name=perp_liquidation_feature_kinds`

  Inspect the generated SQL. It may only drop/recreate check constraints; it must preserve existing rows and must not weaken status/value, uniqueness, or existing kind constraints. Ensure the generated paths are exactly `drizzle/0007_perp_liquidation_feature_kinds.sql` and `drizzle/meta/0007_snapshot.json`.

- [ ] **Step 5: Run focused tests and formatting**

  Run: `pnpm vitest run tests/domain/derived-feature/contract.test.ts tests/db/schema/derived-features.test.ts tests/db/migrations/perp-liquidation-feature-kinds.test.ts`

  Expected: PASS.

  Run: `pnpm exec prettier --check src/contracts/derived-feature.ts src/db/schema/derived-features.ts tests/domain/derived-feature/contract.test.ts tests/db/schema/derived-features.test.ts tests/db/migrations/perp-liquidation-feature-kinds.test.ts drizzle/meta/0007_snapshot.json drizzle/meta/_journal.json`

  Expected: exit 0.

- [ ] **Step 6: Commit**

  ```bash
  git add src/contracts/derived-feature.ts src/db/schema/derived-features.ts tests/domain/derived-feature/contract.test.ts tests/db/schema/derived-features.test.ts tests/db/migrations/perp-liquidation-feature-kinds.test.ts drizzle/0007_perp_liquidation_feature_kinds.sql drizzle/meta/0007_snapshot.json drizzle/meta/_journal.json
  git commit -m "feat: persist perp liquidation feature kinds"
  ```

## Task 3: Add the source port and both venue adapters

**Files:**

- Create: `src/ports/perp-liquidation-source.ts`
- Create: `src/adapters/node/http-binance-fapi-source.ts`
- Create: `src/adapters/node/http-drift-source.ts`
- Create: `tests/fakes/fake-perp-liquidation-source.ts`
- Modify: `tests/fakes/index.ts`
- Create: `tests/adapters/node/http-binance-fapi-source.test.ts`
- Create: `tests/adapters/node/http-drift-source.test.ts`

- [ ] **Step 1: Write failing port/adapter tests**

  Name and cover:
  - `keeps venue response fields inside adapters and emits only canonical source facts`;
  - `retries retryable source failures and never retries malformed responses`;
  - `marks Binance liquidation coverage unavailable without calling a user-data endpoint`;
  - `maps Drift liquidation precision only from configured documented precision`;
  - malformed numeric strings, non-finite values, wrong market/symbol, HTTP 404/429/5xx, timeout, and secret-redacted diagnostics.

- [ ] **Step 2: Verify adapter tests fail**

  Run: `pnpm vitest run tests/adapters/node/http-binance-fapi-source.test.ts tests/adapters/node/http-drift-source.test.ts`

  Expected: FAIL because the port and adapters do not exist.

- [ ] **Step 3: Add the port and fake in the same task as every implementation**

  Define a single method so the interface and all implementations compile together:

  ```ts
  export interface PerpLiquidationSourceRequest {
    readonly pair: "SOL/USDC";
    readonly fromUnixMs: number;
    readonly toUnixMs: number;
  }

  export interface PerpLiquidationSourceSnapshot {
    readonly source: "binance-fapi" | "drift-api";
    readonly providerRunId: string;
    readonly asOfUnixMs: number;
    readonly coverage: Readonly<Record<PerpMetricKind, PerpMetricCoverage>>;
    readonly facts: readonly PerpLiquidationSourceFact[];
  }

  export interface PerpLiquidationSourcePort {
    collect(request: PerpLiquidationSourceRequest): Promise<PerpLiquidationSourceSnapshot>;
  }
  ```

  `PerpLiquidationSourceFact` is a discriminated union with venue-neutral field names and decimal strings. `PerpLiquidationSourceError` has `timeout | network | unavailable | malformed`.

- [ ] **Step 4: Implement Binance public market-data collection**

  Use only documented public market-data paths under a configurable base URL:

  | Metric      | Binance path/behavior                                                        |
  | ----------- | ---------------------------------------------------------------------------- |
  | funding     | funding-rate history for the configured symbol                               |
  | OI          | open-interest statistics, 5-minute period, enough samples to span four hours |
  | basis       | mark/index price or documented basis response                                |
  | leverage    | global or top-trader long/short ratio, with methodology recorded             |
  | liquidation | no request; coverage is `unavailable` with a non-secret diagnostic           |

  Fetch independent metric endpoints concurrently, preserving per-metric coverage rather than rejecting the entire snapshot when one fails. Use bounded exponential backoff with injected `RetryControl`; retry only timeout/network/429/5xx. Never include headers, keys, signed query strings, or full response bodies in facts or diagnostics.

- [ ] **Step 5: Implement Drift public data collection**

  Accept a configurable base URL, SOL-PERP market index, endpoint paths, and documented integer precisions. Poll funding history, market state (OI plus mark/oracle values), and historical liquidation records for the request window. Emit a leverage proxy only when the response supplies a documented market net-position ratio; otherwise mark that metric unavailable. Reject rather than infer an undocumented precision or liquidation notional.

- [ ] **Step 6: Run focused tests and lint**

  Run: `pnpm vitest run tests/adapters/node/http-binance-fapi-source.test.ts tests/adapters/node/http-drift-source.test.ts`

  Expected: PASS.

  Run: `pnpm exec eslint src/ports/perp-liquidation-source.ts src/adapters/node/http-binance-fapi-source.ts src/adapters/node/http-drift-source.ts tests/fakes/fake-perp-liquidation-source.ts tests/fakes/index.ts tests/adapters/node/http-binance-fapi-source.test.ts tests/adapters/node/http-drift-source.test.ts`

  Expected: exit 0.

- [ ] **Step 7: Commit**

  ```bash
  git add src/ports/perp-liquidation-source.ts src/adapters/node/http-binance-fapi-source.ts src/adapters/node/http-drift-source.ts tests/fakes/fake-perp-liquidation-source.ts tests/fakes/index.ts tests/adapters/node/http-binance-fapi-source.test.ts tests/adapters/node/http-drift-source.test.ts
  git commit -m "feat: add Binance and Drift perp source adapters"
  ```

## Task 4: Normalize, identify, and enrich perp observations

**Files:**

- Create: `src/domain/perp-liquidation/validate.ts`
- Create: `src/domain/perp-liquidation/normalize.ts`
- Create: `src/domain/perp-liquidation/identity.ts`
- Create: `src/domain/perp-liquidation/enrich.ts`
- Create: `src/domain/perp-liquidation/index.ts`
- Create: `tests/domain/perp-liquidation/validate.test.ts`
- Create: `tests/domain/perp-liquidation/normalize.test.ts`
- Create: `tests/domain/perp-liquidation/identity.test.ts`
- Create: `tests/domain/perp-liquidation/enrich.test.ts`

- [ ] **Step 1: Write failing pure-domain tests**

  Cover signed funding, positive OI/prices/notional, basis with both positive and negative spread, liquidation side, sorted source identity, stale confidence degradation, provenance validation, and rejection of venue-only fields. Include exact cases:
  - `preserves positive and negative funding rates through normalization`;
  - `transitions a persisted fresh fact to degraded evidence when freshness policy marks the input stale`;
  - `derives the same identity for reordered object keys`;
  - `uses venue kind instrument observed time and provider event id as identity`.

- [ ] **Step 2: Verify tests fail**

  Run: `pnpm vitest run tests/domain/perp-liquidation/validate.test.ts tests/domain/perp-liquidation/normalize.test.ts tests/domain/perp-liquidation/identity.test.ts tests/domain/perp-liquidation/enrich.test.ts`

  Expected: FAIL because domain modules do not exist.

- [ ] **Step 3: Implement validation and normalization**

  Validation accepts only the port union, finite integer timestamps, canonical decimal strings, expected pair, and metric-specific required fields. Normalization maps each source fact to `PerpObservationPayloadV1`, recomputes basis from canonical mark/spot decimals rather than trusting a provider spread, and sorts/deduplicates references.

- [ ] **Step 4: Implement deterministic identities**

  Hash canonical tuples:

  ```ts
  {
    (source, kind, instrument, observedAtUnixMs, sourceEventId);
  }
  ```

  For windowed aggregate facts, `sourceEventId` must itself be based on provider window bounds. Never include a run ID in observation identity.

- [ ] **Step 5: Implement enrichment**

  Use taxonomy registry policies and existing `computeFreshness`, `computeConfidence`, `canonicalizePayload`, and `validateProvenance`. Direct observations carry one raw/source ref. When stale behavior is `degrade_confidence`, append `stale_input_degraded` exactly once and cap the level below `high`; do not rewrite the observed timestamp.

- [ ] **Step 6: Run focused tests and lint**

  Run: `pnpm vitest run tests/domain/perp-liquidation/validate.test.ts tests/domain/perp-liquidation/normalize.test.ts tests/domain/perp-liquidation/identity.test.ts tests/domain/perp-liquidation/enrich.test.ts`

  Expected: PASS.

  Run: `pnpm exec eslint src/domain/perp-liquidation/validate.ts src/domain/perp-liquidation/normalize.ts src/domain/perp-liquidation/identity.ts src/domain/perp-liquidation/enrich.ts src/domain/perp-liquidation/index.ts tests/domain/perp-liquidation/validate.test.ts tests/domain/perp-liquidation/normalize.test.ts tests/domain/perp-liquidation/identity.test.ts tests/domain/perp-liquidation/enrich.test.ts`

  Expected: exit 0.

- [ ] **Step 7: Commit**

  ```bash
  git add src/domain/perp-liquidation tests/domain/perp-liquidation/validate.test.ts tests/domain/perp-liquidation/normalize.test.ts tests/domain/perp-liquidation/identity.test.ts tests/domain/perp-liquidation/enrich.test.ts
  git commit -m "feat: normalize and enrich perp observations"
  ```

## Task 5: Derive deterministic perp stress features

**Files:**

- Create: `src/domain/perp-liquidation/derive.ts`
- Modify: `src/domain/perp-liquidation/index.ts`
- Create: `tests/domain/perp-liquidation/derive.test.ts`

- [ ] **Step 1: Write failing feature tests first**

  Add named cases for rising and falling OI, zero OI baseline, positive and negative funding, positive and negative basis, mixed long/short liquidations, stale inputs, duplicate IDs, missing denominator, and cross-venue isolation. Required names:
  - `derives positive BPS for rising OI and negative BPS for falling OI`;
  - `marks OI trend unavailable when fewer than two usable samples exist`;
  - `marks liquidation cluster unavailable when no same-venue positive OI denominator exists`;
  - `does not interpret unavailable liquidation coverage as a zero liquidation cluster`;
  - `links every available feature to its selected normalized and raw observation ids`.

- [ ] **Step 2: Verify derivation tests fail**

  Run: `pnpm vitest run tests/domain/perp-liquidation/derive.test.ts`

  Expected: FAIL because the derivation functions do not exist.

- [ ] **Step 3: Implement safe decimal arithmetic and formulas**

  Reuse the repository’s integer/decimal conventions; do not derive with binary floating-point intermediate values. Round once at the output boundary:

  ```ts
  oiTrendBps = roundHalfAwayFromZero(((latestOi - earliestOi) * 10_000) / abs(earliestOi));

  annualizedFundingBps = roundHalfAwayFromZero(
    fundingRate * (24 / fundingIntervalHours) * 365 * 10_000
  );

  basisSpreadBps = roundHalfAwayFromZero(((perpPrice - spotPrice) * 10_000) / spotPrice);

  liquidationClusterBps = roundHalfAwayFromZero(
    (sumLiquidationNotional1h * 10_000) / latestSameVenueOiNotional
  );
  ```

  Require a non-zero/positive denominator as applicable and safe-integer BPS output.

- [ ] **Step 4: Implement selection, status, confidence, and lineage**

  Export one orchestration function, `derivePerpLiquidationFeatures`, which accepts normalized candidates, source coverage, evaluation time, run/code versions, and returns four `DerivedFeatureInsert` values.

  Sort observations by `observedAtUnixMs`, then ID. Use samples in `[asOf - window, asOf]`; choose earliest/latest OI in the four-hour window; sum unique liquidation event IDs in the one-hour window. An available feature uses `AVAILABLE`; usable but stale/incomplete input uses `PARTIAL`, lowers confidence, and records sorted `stale_input_degraded`; insufficient evidence uses `UNAVAILABLE` with a specific reason and no fabricated zero. Produce deterministic derivation keys from feature kind, as-of time, venue set, selected IDs, calculator version, and selection version.

- [ ] **Step 5: Run focused tests and lint**

  Run: `pnpm vitest run tests/domain/perp-liquidation/derive.test.ts`

  Expected: PASS.

  Run: `pnpm exec eslint src/domain/perp-liquidation/derive.ts src/domain/perp-liquidation/index.ts tests/domain/perp-liquidation/derive.test.ts`

  Expected: exit 0.

- [ ] **Step 6: Commit**

  ```bash
  git add src/domain/perp-liquidation/derive.ts src/domain/perp-liquidation/index.ts tests/domain/perp-liquidation/derive.test.ts
  git commit -m "feat: derive perp crowding and liquidation features"
  ```

## Task 6: Orchestrate durable observation and feature persistence

**Files:**

- Create: `src/application/collect-perp-liquidation.ts`
- Create: `tests/application/collect-perp-liquidation.test.ts`

- [ ] **Step 1: Write failing application state-transition tests**

  Required tests:
  - `transitions a new fact from absent to raw pending to normalized and raw parsed before feature insertion`;
  - `transitions an identical fact from parsed to replayed without duplicate normalized or feature rows`;
  - `transitions the same identity with a changed payload to conflict while preserving the immutable row`;
  - `recovers a stuck raw pending row by completing normalization and marking raw parsed on subsequent runs`;
  - `persists stale observations and PARTIAL features with stale_input_degraded`;
  - `returns degraded coverage without zero-valued evidence when a metric is unavailable`;
  - `continues processing valid facts after one malformed fact`.

- [ ] **Step 2: Verify the application tests fail**

  Run: `pnpm vitest run tests/application/collect-perp-liquidation.test.ts`

  Expected: FAIL because `collectPerpLiquidation` does not exist.

- [ ] **Step 3: Implement collection over existing repository ports with stuck pending recovery**

  Define dependencies on `PerpLiquidationSourcePort`, `RawObservationRepo`, `NormalizedObservationRepo`, and `DerivedFeatureRepo`. The input contains source key and lookback. Fetch one snapshot, sort facts by deterministic identity, then for each fact:
  1. validate and normalize;
  2. derive the source observation key and canonical payload/hash;
  3. `insertOrClassify` raw as `pending`;
  4. on new raw insert (outcome `inserted`) OR when classifying an existing raw row that is in status `pending` (due to a prior crash before normalized insert): enrich and insert normalized observation, then mark raw `parsed`;
  5. on processing error, attempt raw `failed` and preserve the original diagnostic;
  6. on identical parsed replay, reuse persisted normalized candidates without another normalized insert;
  7. on conflict (existing raw row has different payload hash), preserve the existing raw row and report conflict.

  Only after all observation transitions complete, derive the four features from the current snapshot’s normalized candidates and `featureRepo.insertMany`. Idempotency is the existing `(featureKind, derivationKey)` contract.

- [ ] **Step 4: Reduce source coverage without policy synthesis**

  Return counts, per-source coverage, and explicit outcome structures:

  ```ts
  export type PerpLiquidationCollectionStatus =
    | "accepted"
    | "partial"
    | "degraded"
    | "identical_replay"
    | "malformed"
    | "timeout"
    | "network"
    | "unavailable"
    | "failed";

  export interface PerpLiquidationCollectionResult {
    readonly venue: PerpVenue;
    readonly status: PerpLiquidationCollectionStatus;
    readonly rawCount: number;
    readonly normalizedCount: number;
    readonly featureCount: number;
    readonly coverage: Readonly<Record<PerpMetricKind, PerpMetricCoverage>>;
  }
  ```

  Any usable stale fact or unavailable metric makes the source `degraded`; mixed accepted/failed facts make it `partial`; an empty successful response with unavailable coverage is degraded/unavailable, never accepted “no risk.”

- [ ] **Step 5: Run focused tests and lint**

  Run: `pnpm vitest run tests/application/collect-perp-liquidation.test.ts`

  Expected: PASS.

  Run: `pnpm exec eslint src/application/collect-perp-liquidation.ts tests/application/collect-perp-liquidation.test.ts`

  Expected: exit 0.

- [ ] **Step 6: Commit**

  ```bash
  git add src/application/collect-perp-liquidation.ts tests/application/collect-perp-liquidation.test.ts
  git commit -m "feat: persist perp observations and derived features"
  ```

## Task 7: Add the two-source job and collector entrypoint

**Files:**

- Create: `src/jobs/perp-liquidation-job.ts`
- Modify: `src/jobs/index.ts`
- Create: `scripts/collectors/perp-liquidation.ts`
- Create: `tests/jobs/perp-liquidation-job.test.ts`
- Create: `tests/scripts/perp-liquidation.test.ts`
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Write failing job reduction and script tests**

  Required state tests:
  - `transitions one unavailable venue plus one usable venue to PARTIAL without failing the command`;
  - `transitions two unavailable venues to UNAVAILABLE and fails the command`;
  - `sorts source outcomes deterministically`;
  - `rejects duplicate or incomplete two-source configuration`;
  - `redacts source secrets from job and script diagnostics`;
  - `sets exit code zero for COMPLETE and PARTIAL and one for UNAVAILABLE and FAILED`;
  - `closes persistence exactly once after success or failure`.

- [ ] **Step 2: Verify job and script tests fail**

  Run: `pnpm vitest run tests/jobs/perp-liquidation-job.test.ts tests/scripts/perp-liquidation.test.ts`

  Expected: FAIL because the job and script do not exist.

- [ ] **Step 3: Implement job status reduction**

  Require exactly one `binance-fapi` and one `drift-api` adapter. Create one shared `CollectionRunContext`, run sources concurrently, redact thrown diagnostics, and reduce:

  | Source outcomes                                       | Job status    | `shouldFailCommand` |
  | ----------------------------------------------------- | ------------- | ------------------- |
  | both usable, neither degraded                         | `COMPLETE`    | false               |
  | at least one usable and any degraded/unusable         | `PARTIAL`     | false               |
  | both timeout/network/unavailable                      | `UNAVAILABLE` | true                |
  | no usable evidence and any malformed/conflict/failure | `FAILED`      | true                |

- [ ] **Step 4: Implement the thin script**

  Add `collect:perp-liquidation` to `package.json`. Read and validate:
  - `BINANCE_FAPI_BASE_URL` (default `https://fapi.binance.com`);
  - `BINANCE_SOL_PERP_SYMBOL`;
  - `DRIFT_DATA_API_BASE_URL`;
  - `DRIFT_SOL_PERP_MARKET_INDEX`;
  - documented Drift precision configuration if it cannot be sourced from a metadata endpoint;
  - `PERP_LIQUIDATION_LOOKBACK_MS` (minimum four hours so OI derivation has coverage).

  Construct both adapters with `runtime.http` and `runtime.retryControl`, initialize persistence once, run the job, print secret-redacted JSON, set exit code from `shouldFailCommand`, and close the DB connection in `finally`.

- [ ] **Step 5: Document environment variables**

  Add a dedicated Pack C block to `.env.example`. Do not add Binance user API keys or secrets because the adapter uses public market data only.

- [ ] **Step 6: Run focused tests and lint**

  Run: `pnpm vitest run tests/jobs/perp-liquidation-job.test.ts tests/scripts/perp-liquidation.test.ts`

  Expected: PASS.

  Run: `pnpm exec eslint src/jobs/perp-liquidation-job.ts src/jobs/index.ts scripts/collectors/perp-liquidation.ts tests/jobs/perp-liquidation-job.test.ts tests/scripts/perp-liquidation.test.ts`

  Expected: exit 0.

  Run: `pnpm exec prettier --check package.json`

  Expected: exit 0.

- [ ] **Step 7: Commit**

  ```bash
  git add src/jobs/perp-liquidation-job.ts src/jobs/index.ts scripts/collectors/perp-liquidation.ts tests/jobs/perp-liquidation-job.test.ts tests/scripts/perp-liquidation.test.ts package.json .env.example
  git commit -m "feat: run two-source perp liquidation collection"
  ```

## Task 8: Schedule and document the Pack C routine

**Files:**

- Create: `cron/routines/perp-liquidation.md`
- Modify: `cron/jobs.yaml`
- Modify: `tests/regression/cron-render.fixture.test.ts` (new Pack C fixture-backed case only)
- Create: `tests/fixtures/cron/routines/perp-liquidation.md`
- Create: `tests/fixtures/cron/perp-liquidation-jobs.yaml`

- [ ] **Step 1: Write a failing focused cron rendering test**

  Add a separate fixture and case named `renders the five-minute perp liquidation routine with the bounded collector command`. Assert the rendered command uses the routine file and that the routine says `pnpm collect:perp-liquidation`.

- [ ] **Step 2: Verify the focused cron test fails**

  Run: `pnpm vitest run tests/regression/cron-render.fixture.test.ts -t "renders the five-minute perp liquidation routine with the bounded collector command"`

  Expected: FAIL because the Pack C fixture/routine/job is absent.

- [ ] **Step 3: Add the routine and schedule**

  Register:

  ```yaml
  - name: perp-liquidation
    cron: "*/5 * * * *"
    messageFile: cron/routines/perp-liquidation.md
  ```

  The routine must describe the two-source allowlist, metric coverage, five-minute polling, four-hour OI and one-hour liquidation windows, exit statuses, freshness/confidence degradation, the Binance liquidation limitation, and the authority boundary. It must explicitly say that unavailable coverage is not evidence of no risk.

- [ ] **Step 4: Run the focused cron test and formatting**

  Run: `pnpm vitest run tests/regression/cron-render.fixture.test.ts -t "renders the five-minute perp liquidation routine with the bounded collector command"`

  Expected: PASS.

  Run: `pnpm exec prettier --check cron/jobs.yaml cron/routines/perp-liquidation.md tests/regression/cron-render.fixture.test.ts tests/fixtures/cron/routines/perp-liquidation.md tests/fixtures/cron/perp-liquidation-jobs.yaml`

  Expected: exit 0.

- [ ] **Step 5: Commit**

  ```bash
  git add cron/jobs.yaml cron/routines/perp-liquidation.md tests/regression/cron-render.fixture.test.ts tests/fixtures/cron/routines/perp-liquidation.md tests/fixtures/cron/perp-liquidation-jobs.yaml
  git commit -m "feat: schedule perp liquidation evidence collection"
  ```

## Tests to add or update

- Contract/taxonomy: all new source, observation, payload, feature, confidence, freshness, and provenance definitions.
- Adapter: endpoint mapping, precision handling, per-metric partial coverage, retry classification, and diagnostic redaction.
- Domain: validation, normalization, identity, stale enrichment, signed rates, rising/falling OI, basis, liquidation clustering, unavailable denominators, deterministic lineage, and idempotent keys.
- Persistence: derived-feature allowlist/unit/scope checks and a non-destructive migration.
- Application: raw/normalized/feature ordering, replay, immutable conflict, malformed fact isolation, and degraded coverage.
- Job/script: two-source state reduction, configuration validation, exit codes, cleanup, and redaction.
- Cron: five-minute registration and routine command rendering.

## Validation commands

Each task includes its own path-scoped acceptance commands. After all implementation tasks, the orchestrator’s dedicated validate phase should run the repository gates (this is not a standalone implementation task):

```bash
pnpm -r typecheck
pnpm verify
```

Expected: both commands exit 0. If the repository is a single package, `pnpm -r typecheck` still exercises the automatic workspace-wide signature gate.

## Risk areas

- **Source feasibility:** Binance public REST does not provide market-wide liquidations through the documented user force-orders endpoint. Drift public liquidation history is therefore required for acceptance.
- **Drift precision drift:** integer precision or response shape changes can silently change notional values. Parse only documented/configured precision and reject unknown versions.
- **Venue symbol mismatch:** Binance may list `SOLUSDT` rather than `SOLUSDC`; configuration must identify the stablecoin contract while the canonical evidence pair remains `SOL/USDC`, and metadata must disclose the quote proxy if it is not USDC.
- **Partial endpoint failure:** concurrent metric requests must retain successful facts while reporting failed coverage, without equating missing data to zero.
- **Stale evidence:** retaining stale observations is intentional, but confidence reasons/status must prevent stale values from appearing fully available.
- **Duplicate liquidation records:** retries and overlapping windows must share stable provider identities or cluster values will double count.
- **Unsafe numeric conversion:** rates and notionals may exceed floating-point precision; decimal strings and integer arithmetic are mandatory.
- **Database migration:** dropping/recreating checks can block deployment if the replacement check conflicts with historical rows. The migration must only broaden accepted kinds and preserve existing constraints.
- **Persistence ordering:** feature insertion after normalized writes is an irreversible DB side effect; a failure can leave observations without features. Replay must deterministically complete the missing feature step.
- **Rate limits:** five-minute polling across several endpoints needs bounded retries and per-metric degradation to avoid synchronized retry storms.

## Stop conditions

Abort implementation instead of improvising when any of the following is true:

- Drift’s approved public, read-only API/RPC cannot provide auditable historical SOL-PERP liquidation records with stable IDs, timestamps, market identity, and defensible notional precision.
- Satisfying liquidation coverage would require a private key, transaction signing, Binance `USER_DATA`, an authenticated trading account, or a persistent WebSocket service.
- The configured Binance instrument is not a defensible SOL stablecoin perpetual proxy and no approved mapping is supplied.
- Official source documentation does not define the precision or semantics required to normalize funding, OI, price, or liquidation values.
- The generated database migration deletes/rewrites historical rows, weakens existing constraints, or cannot be applied without destructive manual repair.
- The canonical database/evidence contract cannot represent all four features in BPS without a downstream regime-engine contract change; that expansion belongs in a separately coordinated issue.
- Existing unrelated test/typecheck failures make it impossible to distinguish Pack C regressions; record the exact baseline failures and stop.
- Source terms prohibit the planned retention or use of the returned data.

## Implementation notes

- Write the named invariant test first in every stateful or calculation task, observe the focused failure, then write minimal implementation.
- Keep raw venue response types private to each adapter. The port, domain, application, fixtures, and persisted normalized payloads may contain only canonical source facts/contracts.
- Preserve user changes already present in the worktree. Do not rewrite unrelated collector code to share abstractions unless a failing Pack C test requires it.
- Commit after each numbered task only when its focused tests pass and the automatic `pnpm -r typecheck` gate passes.
