# Architecture

## Core pattern

```text
OpenClaw cron wakes an isolated agent
  -> agent reads repo policy/routine/memory
  -> agent calls deterministic collectors/backend
  -> scripts write JSON output
  -> agent interprets output and updates durable memory
  -> OpenClaw delivers summary
```

## Layered modular monolith

Pipeline code lives under `src/`:

- `src/contracts` — canonical ClmmBundle contract types, cron config types, and PriceSnapshot type.
- `src/domain` — pure logic (cron command building). No I/O, no clock, no env.
- `src/ports` — interfaces for HTTP, JSON file storage, text reading, env, clock, and command execution.
- `src/application` — use cases that orchestrate through ports (collect clmm bundle, collect price, render and sync cron jobs).
- `src/jobs` — thin orchestration wrappers that bind use cases to dependency objects so cron-driven entrypoints have a single import point.
- `src/adapters/node` — concrete Node implementations of every port plus a `createNodeRuntime()` composition root.

`scripts/*` are thin entrypoints. Each builds the Node runtime, calls one job, prints output, and sets `process.exitCode` on failure. `pnpm` script names and JSON output paths are unchanged.

Boundary rules are enforced by `dependency-cruiser` (`pnpm boundaries`) with `tsPreCompilationDeps: true` so type-only imports are included in enforcement. The combined `pnpm verify` script runs typecheck, tests, and boundary checks.

## No-execution boundary

This repo produces advisory artifacts. It does not sign, submit, rebalance, swap, or perform wallet execution. The only side effects scripts can produce are: writing JSON to `data/` and `outputs/`, rendering cron commands, and (only via `pnpm cron:sync -- --apply`) invoking the `openclaw` CLI to register cron jobs.

## Downstream split

Evidence-bundle publication is INT-PUBLISH (issue #13). Removal of the legacy recommendation-flow outputs is INT-REMOVE-LEGACY-RECOMMENDATION-FLOWS (issue #14), which depends on the new path being live.

## Why Git is not the database

Git is for durable logic and low-frequency memory:

- prompts
- policies
- schemas
- routine definitions
- daily/weekly summaries
- durable lessons

Git is not for high-frequency telemetry:

- minute candles
- price ticks
- pool snapshots
- raw liquidity distribution
- every fee accrual update

Those belong in Postgres or your backend database.

## Why the LLM does not execute

CLMM execution requires exact math and wallet authority:

- tick conversion
- liquidity math
- swap amount
- slippage checks
- priority fees
- transaction simulation
- wallet signing

Those are deterministic backend responsibilities. The LLM is allowed to advise only.

## Data flow

**clmm-v2** owns live wallet, position, and execution truth. This repo owns observational history only. The database is required; there is no latest-file-only fallback and no policy or execution authority is added by this layer.

```text
clmm-v2 /insights/sol-usdc/bundle/:walletId
               |
               v (raw observation, append-only)
        raw_observations
               |
               v (normalized, validated, immutable)
     normalized_observations
               |
               v (derived, computed features)
        derived_features
               |
               v (optional compatibility artifact)
        data/latest-clmm-bundle.json
               |
               v
     OpenClaw routine + durable memory
               |
               v
     advisory output / operator review
```

## Durable Core Data Flow (Four-Source Core Set)

The core data ingestion pipeline collects observations from a four-source raw-first core set before normalizing them. All sources are collected in a raw-first flow and persisted to Postgres before normalization. The four core sources are:

- **clmm-v2-insights** (CLMM Bundle): BFF API. Produces raw LP, positions, and alert facts.
- **pyth-hermes** (Pyth Oracle): Authenticated oracle feed. Produces `oracle_price` observations.
- **jupiter-quote** (Jupiter Quote): Public quote API. Produces `executable_quote` observations.
- **orca-public-api** (Orca Stats): Public pool stats API. Produces `pool_statistics` observations.

```text
  CLMM Bundle      Pyth Hermes      Jupiter Quote      Orca Stats
       |                |                 |                 |
       +----------------+--------+--------+-----------------+
                                 v
                  raw_observations (append-only)
                                 |
                                 v
               normalized_observations (immutable)
                                 |
               +-----------------+-----------------+
               v                                   v
         derived_features             Compatibility Snapshots
      (divergence, fee APR)          (e.g., latest-clmm-bundle.json,
                                      latest-price-snapshot.json)
```

Key Architectural Invariants:

1. **Postgres Authority**: The database tables (`raw_observations` and `normalized_observations`) are the absolute authority. Local JSON compatibility snapshots are fallbacks only.
2. **One Explicit Run Context**: A single execution context (containing a unique `runId`) correlates all leaf operations within a single run. Leaf operations must never re-read the environment or regenerate their own `runId`.
3. **Independent Persistence**: Sibling source collectors execute concurrently and persist their raw observations and normalized rows independently.
4. **No Aggregate Transaction/Retry**: There are no cross-source database transactions or coordinator-level retries. A failure in one source does not roll back already committed evidence from sibling sources.
5. **Fixed Status Truth Table**: The overall command run status is mapped via a pure reducer truth table based on individual source outcomes:
   - **COMPLETE**: All sources succeed or replay identically.
   - **PARTIAL**: At least one source succeeds (usable) while others fail or degrade.
   - **UNAVAILABLE**: All sources are unavailable (e.g., due to rate-limiting 429s or outages).
   - **FAILED**: Any validation conflict, DB integrity issue, or total failure with zero usable evidence.
6. **Orca pool_statistics Metrics**:
   - `tvlUsdc`: Orca's current pool TVL mark.
   - `volume24hUsdc`: Rolling traded notional.
   - `fees24hUsdc`: Rolling total swap fees.
     These metrics are decimal strings denominated in USDC. They are not raw liquidity, wallet fees, LP-only revenue, APR, or guaranteed fiat USD.
7. **Solana Network-Health Deferment**: Solana network-health/status ingestion is identified as a separate backlog gap after the deterministic vertical slice. It is excluded from the core source count, and issue #24 completion does not depend on it.
8. **No Execution Authority**: The pipeline collects evidence and advises only. It does not construct instructions, sign transactions, or execute swaps.
9. **Operator Handoff**: `pnpm collect:core` is the canonical CLI/operator interface for gathering all four core telemetry sources. Legacy commands remain supported for backwards compatibility.
10. **Contextual Evidence Boundary**: Missing or expired support/resistance levels are retained in bounded raw evidence and surfaced as degraded warnings, but never become normalized numeric evidence or execution authority.

## Contextual Research Collectors

Contextual research collectors provide lower-confidence contextual evidence that supplements core telemetry. They follow the same raw-first persistence pattern as core collectors.

### Contextual Events Collector (`macro-calendar-api`, `solana-status-api`)

The contextual events collector (`pnpm collect:context-events`) collects two event families:

- **Scheduled events** (`macro-calendar-api`): Token unlocks, protocol upgrades, governance votes, and other scheduled macro events. Query window is ±24 hours from collection time.
- **Protocol incidents** (`solana-status-api`): Solana network incidents, service disruptions, and security events.

**Key architectural invariants:**

1. **Bounded factual extract retention:** All events carry `retentionMode: "bounded_factual_extract"` and a provider-supplied `license` string. Providers must supply stable `sourceEventId` values and original source timestamps.
2. **Raw-first append-only lifecycle:** Raw observations are persisted before normalization. Lifecycle state transitions (SCHEDULED → ACTIVE → RESOLVED, or CANCELLED) are recorded as new rows, never mutations.
3. **Exact replay detection:** Identity key derives from `${source}::${observationKind}::${sourceEventId}` plus `sourceObservedAtUnixMs` and `payloadHash`. Identical replays produce no new rows.
4. **Latest-state selection:** Group by identity, pick latest per group, then apply eligibility filters. This prevents older ACTIVE rows from being revived after cancellation/expiry.
5. **Severity as deterministic metadata:** Severity ranks (CRITICAL > HIGH > MEDIUM > LOW) are provider-supplied facts, not LLM determinations.
6. **Authority boundaries:** Missing feeds do not imply no risk; unconfirmed reports remain unconfirmed; event direction is always unknown; only regime-engine can synthesize final policy.

### Support Resistance Collector (`technical-analysis-api`)

The support resistance collector (`pnpm collect:collect:support-resistance`) collects SOL/USDC support and resistance levels from a technical analysis API provider.

**Source port**: `SupportResistanceSourcePort` in `src/ports/support-resistance-source.ts`
**HTTP adapter**: `HttpSupportResistanceSource` in `src/adapters/node/http-support-resistance-source.ts`
**Application use case**: `collectSupportResistance` in `src/application/collect-support-resistance.ts`
**Job**: `supportResistanceJob` / `runSupportResistanceJob` in `src/jobs/support-resistance-job.ts`
**CLI script**: `scripts/collectors/support-resistance.ts`

**Data flow**:

```text
technical-analysis-api provider
        |
        v (raw observation, append-only)
 raw_observations
        |
        v (normalized, validated, bounded)
 normalized_observations (support_resistance_level)
```

**Key invariants**:

- Only explicit numeric `point` or `zone` values in USDC_PER_SOL are accepted as normalized evidence.
- Missing or malformed levels are retained as bounded raw evidence with degraded warnings.
- Provider/run identity, side, timeframe, and thesis are part of equivalence identity for replay detection.
- API credentials are redacted from diagnostics, logs, and persisted metadata.

### News Evidence Collector (`crypto-news-api`, `regulatory-monitor-api`)

The news evidence collector (`pnpm collect:news-evidence`) collects bounded factual extracts from two allowed news sources.

**Source port**: `NewsSourcePort` in `src/ports/news-source.ts`
**HTTP adapter**: `HttpNewsSource` in `src/adapters/node/http-news-source.ts`
**Application use case**: `collectNewsEvidence` in `src/application/collect-news-evidence.ts`
**Job**: `newsEvidenceJob` / `runNewsEvidenceJob` in `src/jobs/news-evidence-job.ts`
**CLI script**: `scripts/collectors/news-evidence.ts`

**Data flow**:

```text
crypto-news-api / regulatory-monitor-api provider
         |
         v (raw observation, append-only)
  raw_observations
         |
         v (normalized, validated, bounded)
  normalized_observations (ecosystem_news | regulatory_risk)
```

**Key invariants**:

1. **Two-source allowlist**: Only `crypto-news-api` and `regulatory-monitor-api` are permitted. The allowlist is configured via `NEWS_SOURCE_ALLOWLIST` and validated before any HTTP work.
2. **Bounded factual extract retention**: All articles carry `retentionMode: "bounded_factual_extract"` and a provider-supplied `license` string. Providers must supply stable `articleId` and `sourceVersionId` values, `robotsCompliance: true`, and `termsAccepted: true`. Missing or negative declarations cause collection to abort.
3. **Immutable article/version identity**: Each article carries `articleId` (stable identity) and `sourceVersionId` (immutable version marker). A correction creates a new record with `correctsSourceVersionId` set, never a mutation. A provider reusing `sourceVersionId` for changed content creates a hard conflict, not an inferred correction.
4. **Freshness caps**: Ecosystem news (`ecosystem_news`) has a 24-hour freshness window. Regulatory risk (`regulatory_risk`) has a 72-hour freshness window.
5. **Syndication vs independent corroboration**: `corroborationState` distinguishes `unconfirmed`, `single_source`, `independently_corroborated`, and `conflicting`. Syndicated content shares `syndicationId` across sources. Independent corroboration elevates confidence but does not create deterministic authority.
6. **Raw-first append-only lifecycle**: Raw observations are persisted before normalization. Per-article persistence is not one transaction across a provider response; valid earlier writes survive a later failure and the source outcome becomes PARTIAL.
7. **Authority boundaries**: News evidence is lower-confidence contextual evidence. Missing coverage does not imply no risk. No full-text retention, LLM briefs, policy synthesis, or execution authority. The pipeline ends at persisted normalized observations.

## Deterministic Feature Derivation

All seven canonical features are derived by code from normalized source observations. The derivation is deterministic: identical inputs produce bit-for-bit identical outputs.

### Reproducibility rules

**Arithmetic:** All intermediate calculations use exact rational arithmetic (`bigint` numerator/denominator). Decimal strings from source payloads are parsed into `{ numerator, denominator }` rationals before any operation. The only floating-point operation is `Math.log` inside the realized volatility calculator; the version string, selected price strings, and final integer output form the audit boundary.

**Rounding:** Final integer values use ties-away-from-zero rounding (round half up). For a rational `p/q`, the remainder `r = p mod q` is compared to `q/2`. If `r > q/2`, round up. If `r == q/2` and `q` is even, round up. This matches the SQL `ROUND()` behavior for positive numbers and is symmetric for negatives.

**Formulas:**

- `range_location`: `(currentPrice - lowerPrice) / (upperPrice - lowerPrice) * 1_000_000`, clamped to `[0, 1_000_000]`
- `distance_to_lower`: `(currentPrice - lowerPrice) / currentPrice * 10_000`
- `distance_to_upper`: `(upperPrice - currentPrice) / currentPrice * 10_000`
- `oracle_dex_divergence`: `|dexPrice - oraclePrice| / oraclePrice * 10_000` (Pyth-only oracle)
- `oracle_confidence_width`: `oracleConfidence / oraclePrice * 10_000`
- `realized_volatility_1h`: `sqrt(sum(log(price[i]/price[i-1])^2 for i=1..n)) * 10_000` — nonannualized, Pyth-only
- `volume_liquidity_ratio_24h`: `volume24hUsdc / tvlUsdc * 1_000_000`

**Volatility window:** Inclusive one-hour window (`VOLATILITY_WINDOW_MS = 3_600_000`). Minimum 10 samples required. Minimum span of 45 minutes required (`VOLATILITY_MIN_SPAN_MS = 2_700_000`). Maximum gap between consecutive samples is 10 minutes (`VOLATILITY_MAX_GAP_MS = 600_000`).

**Selection ordering:** When multiple candidates exist, selection orders by: slot descending, then `observedAtUnixMs` descending, then `receivedAtUnixMs` descending, then ID ascending. This gives the most recent on-chain observation priority.

**Duplicate handling:** For volatility, duplicates are deduplicated by keeping the highest-slot observation per timestamp. The IDs of discarded duplicates are recorded in the feature metadata.

**Confidence cap:** All derived features use a default `high` confidence of `1.0` when inputs are valid and fresh. Confidence degradation to `PARTIAL` occurs when source warnings are present (e.g., wide oracle confidence interval, DEX provider warning). `UNAVAILABLE` features carry a null value and explicit reason codes in the derivation key.

**Freshness minimum:** Features are valid for one hour from `asOfUnixMs` (`expiresAtUnixMs = asOfUnixMs + 3_600_000`). Selectors also compare `validUntilUnixMs` against the single evaluation timestamp to detect expired source observations at query time.

**Lineage and derivation key:** Every feature carries `inputObservationIds` (sorted, unique), `rejectedObservationIds` (sorted, unique), `calculatorVersion`, `selectionVersion`, and a `derivationKey` that is a canonical hash of the complete input identity. Unavailable outcomes include `reasons` in the derivation key identity so that distinct failure modes produce distinct keys.

## Evidence Bundle Assembly

The evidence bundle assembly layer combines derived features, raw observations, and contextual evidence into a canonical, signable payload for regime-engine.

### Architecture

```text
derived_features ──────────────────>│
                                   │
raw_observations ──────────────────>├──> selectEvidenceFeatureSlots()
                                   │
normalized_observations ───────────>│
                                   v
                           classifyEvidenceBundleQuality()
                                   │
                                   v
                           verifyEvidenceLineage()
                                   │
                                   v
                    assembleEvidenceBundleCandidate()
                                   │
                                   v
              contract.validateCanonicalizeAndHash()
                                   │
                                   v
                           bundleRepo.insertOrClassify()
```

### Persistence Contract

The `Persistence` interface exposes five repositories:

```typescript
interface Persistence {
  connection: DbConnection;
  rawObservationRepo: RawObservationRepo;
  normalizedObservationRepo: NormalizedObservationRepo;
  featureRepo: DerivedFeatureRepo;
  bundleRepo: EvidenceBundleRepo; // NEW
  briefRepo: ResearchBriefRepo; // NEW
}
```

All repositories share a single lazy database connection initialized on first `getPersistence()` call.

### Pinned Contract Adapter

The `createEvidenceBundleContract()` function creates a pinned contract adapter that:

1. Verifies asset hashes from `provenance.json` against known SHA-256 values
2. Loads the JSON Schema for `evidence-bundle.v1`
3. Validates candidate payloads against the schema
4. Performs domain validations (duplicate feature IDs, lineage resolution, lifecycle ordering, coverage matching)
5. Canonicalizes payloads deterministically (sorted keys, no undefined)
6. Computes SHA-256 payload hash
7. Derives idempotency key from identity fields

### Canonical Hash and Idempotency

**Idempotency key derivation:**

```
identityFields = [
  schemaVersion, publisher, sourceId,
  runId, correlationId, pair, scope.kind,
  scope.identifiers...,
  sortedFeatures.map(f => [featureId, calculator.name, calculator.version])...
]
idempotencyKey = SHA256(identityFields.join("|"))
```

**Canonical payload:** Deterministic JSON with sorted object keys, no undefined values, string values double-quoted.

### Insert Classification

`bundleRepo.insertOrClassify()` returns one of three outcomes:

- **inserted:** New bundle persisted
- **identical_replay:** Same idempotency key with identical payload hash — no new row
- **conflict:** Same idempotency key with different payload hash — existing row returned, incoming rejected

The unique index is on `(schemaVersion, pair, idempotencyKey)`.

### Script Entry Point

The `pnpm assemble:bundle` script:

1. Reads a JSON request file
2. Validates request structure before database access
3. Obtains persistence lazily
4. Invokes `assembleEvidenceBundleJob`
5. Emits redacted JSON (outcome, rowId, payloadHash, slotCount, warnings)
6. Sets exit code 1 on conflict or error

**Never logs:** wallet ID, canonical payload, full provenance.

## Publish-attempt persistence

The `publish_attempts` table records audit evidence for every HTTP delivery attempt to regime-engine. It is append-only: rows are never updated or deleted.

### Identity and ordering

- One immutable row represents one HTTP attempt.
- `(target, idempotency_key, attempt_number)` is the unique attempt identity.
- The same `(target, idempotency_key)` with a greater `attempt_number` is a retry, not a conflict.
- `attempt_number ASC, id ASC` is the canonical read order; database-natural order is not used.

### Logical references without foreign keys

- `evidence_bundle_id` and nullable `research_brief_id` are indexed logical references.
- No foreign keys or cascades are defined.
- Out-of-order replay and restore are supported.
- Application consumers must tolerate temporarily unresolved references during replay.

### Authority boundary

The repository records audit outcomes only. It does not decide policy, implement transport logic, or manage retry loops.

```
evidence_bundles/research_briefs  ...logical reference...>  publish_attempts
                                      (no DB foreign key)
```
