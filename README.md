# SOL/USDC CLMM Intelligence

This repo is the advisory/evidence pipeline for the SOL/USDC CLMM Autopilot system.

It stores prompts, policies, schemas, scheduled agent routines, source definitions, durable memory, local snapshots, deterministic collector code, and evidence-pipeline infrastructure used to research a user-managed Orca SOL/USDC Whirlpool LP position.

It is not the execution product. It does not own the mobile app, wallet connection, transaction preparation, signing flow, Solana RPC fan-out, or CLMM worker jobs. Those belong to `clmm-v2`.

## Current state

This repo currently provides:

- cron/routine definitions for scheduled SOL/USDC analysis, executed via Hermes (see `scheduling.md`);
- durable policy, prompt, routine, memory, resource, and schema assets;
- a layered TypeScript monolith under `src/` with contracts, domain logic, ports, application use cases, jobs, adapters, and DB schema;
- deterministic collectors for Jupiter price snapshots and CLMM bundles from the `clmm-v2` BFF;
- local JSON outputs under `data/` and `outputs/` for agent consumption and operator review;
- Drizzle/Postgres support under the `intelligence` schema;
- dependency-cruiser boundaries that keep domain/application logic separated from Node adapters;
- a hard no-execution boundary: analysis is allowed, direct execution is not;
- evidence bundle assembly and publication to Regime Engine via `POST /v1/evidence/sol-usdc`.

The pipeline is allowed to collect, normalize, derive, summarize, score, remember, and publish evidence. It is not allowed to bypass the product's user-approval flow.

## How the three repos work together today

```text
                    GeckoTerminal / market candles
                                |
                                v
                         regime-engine
              regime, S/R, S/R theses, current insights
                                ^
                                | execution result events
                                |
Wallet + App  <---- BFF/API + Worker ----> Orca / Jupiter / Solana RPC
  clmm-v2          positions, alerts,
                   previews, signing,
                   submission, history
                                |
                                | read-only bundle API
                                v
              sol-usdc-clmm-intelligence
       scheduled agent routines, evidence memory, advisory outputs
```

Today:

- `clmm-v2` is the operational product. It owns wallet connection, monitored positions, alerts, preview approval, signing handoff, transaction submission, reconciliation, and history.
- `regime-engine` is the deterministic analytics and ledger service. It stores candles, computes current regime, stores S/R/current insight blocks, and records CLMM execution-result events.
- `sol-usdc-clmm-intelligence` is the advisory/evidence pipeline. It pulls CLMM bundles from `clmm-v2`, combines them with price/source/research context, runs scheduled agent routines (via Hermes cron — see `scheduling.md`), and maintains durable memory.

## Evidence-pipeline roadmap (delivered)

Issues #2 and #7 through #13 (plus follow-on #21) defined the corrected architecture: this repo becomes a durable evidence pipeline, not the final policy author. All of that tracked work is now closed and merged — the sections below describe the delivered system, not open work. There are no open issues in this repo as of 2026-07-28.

The corrected boundary is:

```text
intelligence engine = collect + normalize + derive + summarize evidence
regime-engine       = synthesize canonical PolicyInsight
clmm-v2             = consume/display final policy and own live LP state
```

### Deterministic feature tranche (INT-FEATURES #8)

The system derives exactly seven canonical numeric features from normalized source observations. All seven are deterministic evidence — computed by code, not authored by an LLM.

**Seven canonical feature kinds:**

| Kind                         | Unit | Scope            | Calculator version              |
| ---------------------------- | ---- | ---------------- | ------------------------------- |
| `range_location`             | PPM  | pool + position  | `range-location/v1`             |
| `distance_to_lower`          | PPM  | pool + position  | `distance-to-lower/v1`          |
| `distance_to_upper`          | PPM  | pool + position  | `distance-to-upper/v1`          |
| `oracle_dex_divergence`      | BPS  | pool-independent | `oracle-dex-divergence/v1`      |
| `oracle_confidence_width`    | BPS  | pool-independent | `oracle-confidence-width/v1`    |
| `realized_volatility_1h`     | BPS  | pool-independent | `realized-volatility-1h/v1`     |
| `volume_liquidity_ratio_24h` | PPM  | pool only        | `volume-liquidity-ratio-24h/v1` |

**Authority boundary:** Derived features are numeric evidence. They carry provenance lineage, confidence metadata, and freshness expiry. They are stored in `intelligence.derived_features` and published as structured evidence to `regime-engine`. The LLM cannot invent, override, or approximate these values.

**Deferred feature list (backlog after #8):** The following feature families are identified but not yet in the canonical seven. They remain deferred to a future iteration:

- Fee APR / expected fee capture
- Volume / liquidity ratio variants beyond 24h
- Inventory skew metrics
- Fee-to-volatility ratio
- Rebalance cost estimates
- Range-distance variant metrics (normalized by vol, not price)
- Wick / spike / breakout flags
- Liquidity-cliff candidates

### Evidence-pipeline epic

Delivered by #2.

The roadmap refactors this repo from a script-first agent artifact pipeline into a durable evidence pipeline that gathers, normalizes, stores, derives, summarizes, and publishes structured research evidence for Regime Engine.

In scope:

- layered modular architecture;
- persistence contracts for raw observations, normalized records, derived features, evidence bundles, research briefs, and publish attempts;
- deterministic feature derivation for the core SOL/USDC evidence set;
- contextual research collectors;
- schema-constrained LLM summarization over bounded evidence bundles;
- structured evidence publication to Regime Engine.

Out of scope:

- wallet signing;
- swaps, rebalances, liquidity mutation, or transaction submission;
- final policy synthesis;
- user-facing app display.

### Core deterministic source ingestion

Delivered by #7.

The ingestion layer should collect and normalize at least:

- `clmm-v2` SOL/USDC insight bundle for raw LP/pool/alert facts;
- Orca pool/public stats for pool-level volume, fees, and TVL context where needed;
- Pyth or equivalent canonical SOL/USD oracle observations;
- Jupiter quotes and price observations for DEX comparison and route context;
- Solana RPC network status inputs for network health, cluster performance, and slot latency context.

Raw responses should be persisted before normalization. Partial source failures should produce explicit warnings, not fabricated values.

### Deterministic feature derivation

Delivered by #8.

Numerical features should be computed by code, not by an LLM. Required feature families include:

- price quality: oracle/DEX divergence, oracle confidence-width warnings, wick/spike flags, breakout confirmation inputs;
- CLMM economics: fee APR/yield, expected fee capture, volume/liquidity ratio, inventory skew, fee-to-volatility ratio, rebalance cost, range-distance metrics, breach-risk inputs;
- market/execution context: realized volatility, volume confirmation, liquidity-cliff candidates, and generic route/slippage context that does not become user-specific execution authority.

Every feature should carry input lineage, as-of time, freshness, and confidence. Missing inputs should degrade explicitly.

### Contextual research collectors

Delivered by #9, #10, and #11.

Research collector packs add:

- **contextual events** (`solana-status-api` live, `macro-calendar-api` deferred): Solana Statuspage protocol incidents are collected as the live source (`solana-status-api`), while scheduled macro events (`scheduled_event`) are deferred when `MACRO_CALENDAR_API_URL` is unset. Produces `scheduled_event` and `protocol_incident` observations with severity, status, and source quality metadata. Events follow a raw-first append-only lifecycle with exact replay detection. Selection uses latest-state grouping before eligibility filtering to prevent older-state revival. Severity/materiality is deterministic evidence metadata; missing feeds do not imply no risk; unconfirmed reports remain unconfirmed; event direction is always unknown; only regime-engine can synthesize final policy.

- **support/resistance** (`technical-analysis-api`): Collects SOL/USDC support and resistance levels from a technical analysis API provider. Produces `support_resistance_level` observations with explicit numeric point/zone values in USDC_PER_SOL units. Raw-to-normalized flow validates bounded snapshots, normalizes claims, deduplicates equivalent claims within a provider run, and surfaces degraded warnings for missing/malformed levels. Expiry-gated levels never become execution authority.

- **news evidence** (`crypto-news-api`, `regulatory-monitor-api`): Collects bounded factual extracts from two allowed news sources. Produces `ecosystem_news` and `regulatory_risk` observations with immutable article/version identities, correction semantics, corroboration state, and source quality metadata. Ecosystem news carries a 24-hour freshness cap; regulatory risk carries a 72-hour cap. Syndication is distinguished from independent corroboration. Missing coverage does not imply no risk. No full-text retention, LLM briefs, policy synthesis, or execution authority.

- **on-chain flow** (`pnpm collect:on-chain-flow`, Helius + Birdeye): Collects whale transfers, whale swaps, and DEX net flow. Produces `whale_transfer`, `whale_swap`, and `dex_net_flow` observations with exact-decimal thresholds. `stablecoin_flow` and `cex_flow_proxy` are deferred. On-chain flow data describes what happened, not why — no output claims motive or policy. See `docs/architecture.md` and `docs/operator-runbook.md` for the full contract.

- **perp & liquidation** (`pnpm collect:perp-liquidation`, Binance fAPI + Drift): Collects funding rates, open interest, perp/spot basis, and liquidation-cluster evidence for leverage-crowding context. Derives deterministic perp stress features from the two-venue observations.

Facts and interpretations must remain separate. A transfer is a fact; motive is an interpretation. Noisy signals carry explicit source-quality and confidence metadata.

### Schema-constrained research briefs

Delivered by #12.

The LLM should summarize bounded structured evidence, not invent deterministic metrics and not make final policy decisions.

A `ResearchBrief` should include:

- pair;
- `asOf` / `expiresAt`;
- source bundle refs;
- headline;
- key changes since prior brief;
- supports-current-regime assessment where applicable;
- major risks;
- confidence;
- source refs;
- warnings / missing evidence;
- prompt version;
- model/provider metadata.

Invalid model output should fail closed or enter a clear degraded state.

### Evidence publication to Regime Engine

Delivered by #13 and #21.

The outbound publisher targets Regime Engine's evidence-ingest endpoint (`POST /v1/evidence/sol-usdc`), not the legacy final-insight route. This repo publishes canonical evidence bundles to Regime Engine and never publishes final `PolicyInsight` or executes transactions.

Payload content:

- deterministic feature summaries;
- contextual evidence summaries;
- LLM research brief (if available);
- freshness/confidence/provenance metadata;
- source refs;
- versioning and idempotency fields.

Publish attempts are persisted with target endpoint, evidence bundle ID, idempotency key, request/payload hashes, status, HTTP status, response body, error information, attempt number, and timestamps. All audit rows redact authorization headers and never contain `REGIME_ENGINE_AUTH_TOKEN`.

## Mature system vision

The mature system is a closed loop:

1. `clmm-v2` observes supported SOL/USDC Orca Whirlpool positions and exposes safe read-only raw LP evidence through `/insights/sol-usdc/*`.
2. This repo collects raw observations, normalizes source data, derives deterministic features, builds evidence bundles, and generates schema-constrained research briefs.
3. This repo publishes structured evidence to `regime-engine` through the future evidence ingest contract.
4. `regime-engine` selects/scored evidence, combines it with deterministic market regime state, and synthesizes one canonical PolicyInsight.
5. `clmm-v2` reads that canonical PolicyInsight through backend-only adapters and displays it with freshness/risk/confidence context.
6. Execution outcomes flow from `clmm-v2` into `regime-engine`; this repo can later review those outcomes to measure signal quality and update memory.

In the mature product, a minimal Anchor receipt/claim program may record one execution receipt per epoch after a completed user-approved flow. That proof layer is not implemented here. This repo remains evidence-oriented.

## System boundary

```text
Git repo                     = prompts, policies, schemas, routines, durable memory, collector code
Hermes Gateway cron           = scheduled isolated agent runs
Postgres / backend database   = raw observations, normalized records, features, evidence bundles, briefs, publish attempts
clmm-v2 BFF                   = source of truth for live CLMM pool, position, alert, and bundle reads
regime-engine                 = source of truth for market regime, evidence ingest, policy synthesis, and result ledger
Wallet / signer               = final authority for user-approved execution
```

## Non-negotiable rule

The LLM may summarize and explain evidence. It may not directly rebalance, withdraw, swap, sign, submit, or execute. Any action that affects a user position must go through `clmm-v2` and the user's approval path.

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
     scheduled agent routine + durable memory
               |
               v
     advisory output / operator review
```

Durable Core Data Flow (Five-Source Core Set):

All core sources (CLMM bundle, Pyth oracle updates, Jupiter executable quotes, Orca pool statistics, and Solana RPC network status) are collected in a raw-first flow and persisted to Postgres before normalization. The Postgres database tables (`raw_observations` and `normalized_observations`) are the absolute authority. Local JSON compatibility snapshots are fallbacks only. Sibling source collectors execute concurrently and persist their raw observations and normalized rows independently within a single execution context (sharing a unique `runId`). A failure in one source does not roll back already committed evidence from sibling sources.

```text
  CLMM Bundle      Pyth Hermes      Jupiter Quote      Orca Stats      Solana RPC
       |                |                 |                 |              |
       +----------------+--------+--------+-----------------+--------------+
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

The overall command run status is mapped via a pure reducer truth table based on individual source outcomes:

- **COMPLETE**: All five core sources succeed or replay identically (requires five fresh usable outcomes).
- **PARTIAL**: At least one source succeeds (usable) while others fail or degrade (e.g. a Solana-only outage producing `PARTIAL` when the other four are usable).
- **UNAVAILABLE**: All sources are unavailable (e.g. rate-limiting 429s or total network outages).
- **FAILED**: Any validation conflict, DB integrity issue, or total failure with zero usable evidence.

Solana RPC collection queries `getHealth` and `getSlot` in a single JSON-RPC batch call, persisting HTTP 2xx responses raw-first. Local retry policy allows at most two attempts for the Solana leaf, while warnings such as `node_behind` or `slot_unavailable` allow observations to remain usable under degraded status. All credentials are redacted from log outputs and metadata; the endpoint URL measures only the configured RPC endpoint rather than global network consensus.

Orca `pool_statistics` metrics are defined as:

- `tvlUsdc`: Orca's current pool TVL mark.
- `volume24hUsdc`: Rolling traded notional.
- `fees24hUsdc`: Rolling total swap fees.
  Explicitly, these are decimal strings denominated in USDC and are not raw liquidity, wallet fees, LP-only revenue, APR, or guaranteed fiat USD.

## Evidence flow (current)

```text
raw source adapters
       |
       v
raw observations -> normalized records -> deterministic features
       |                  |                       |
       +------------------+-----------------------+
                          v
                  evidence bundle
                          |
                          v
         schema-constrained research brief
                          |
                          v
        publish attempt -> regime-engine /v1/evidence/sol-usdc
                          |
                          v
          Regime Engine canonical PolicyInsight synthesis
```

The intelligence pipeline never publishes final `PolicyInsight` or executes transactions. It publishes canonical evidence bundles to Regime Engine, which owns final policy synthesis.

## Evidence Bundle Assembly

The `pnpm assemble:bundle` command assembles a deterministic evidence bundle from derived features and observations. It reads a JSON request file, validates it, queries the database for candidate features, assembles the bundle, validates it against the pinned contract schema, and persists the result.

### Contract Provenance and Pinned Schema

The evidence bundle contract is pinned at a specific schema version with verified asset hashes:

- Schema file: `schemas/regime-engine/evidence-bundle.v1/schema.json`
- Provenance manifest: `schemas/regime-engine/evidence-bundle.v1/provenance.json`
- Schema SHA-256: `74b5c974bd945f63c4f5d8948a8040542b2f89d6d697a4008543be1a89ba33af`

The pinned contract (`createEvidenceBundleContract()`) verifies all asset hashes before performing validation. If any asset hash mismatches, validation aborts with `ASSET_HASH_MISMATCH`.

### Request File Example

```json
{
  "pair": "SOL/USDC",
  "poolId": "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
  "positionId": "Pos11111111111111111111111111111111111111111",
  "walletId": "Wallet1234567890abcdef",
  "pipelineRunId": "run-456",
  "correlationId": "corr-789",
  "evaluationTimeUnixMs": 1700000000000,
  "createdAtUnixMs": 1700000000000,
  "acceptedCalculatorVersions": {
    "range_location": "range-location/v1",
    "distance_to_lower": "distance-to-lower/v1",
    "distance_to_upper": "distance-to-upper/v1",
    "oracle_dex_divergence": "oracle-dex-divergence/v1",
    "oracle_confidence_width": "oracle-confidence-width/v1",
    "realized_volatility_1h": "realized-volatility-1h/v1",
    "volume_liquidity_ratio_24h": "volume-liquidity-ratio-24h/v1",
    "oi_trend_4h": "oi-trend-4h/v1",
    "funding_rate_annualized": "funding-rate-annualized/v1",
    "liquidation_cluster_1h": "liquidation-cluster-1h/v1",
    "basis_spread_bps": "basis-spread-bps/v1"
  },
  "schemaVersion": "evidence-bundle.v1",
  "assemblySelectionVersion": "selection/v1",
  "codeVersion": "1.0.0",
  "gitCommit": "abc123def456",
  "environment": "test"
}
```

`acceptedCalculatorVersions` must include an entry for every kind in `MVP_FEATURE_KINDS` (`src/contracts/derived-feature.ts`) — the seven canonical MVP kinds above plus the four Pack C perp/liquidation kinds (`oi_trend_4h`, `funding_rate_annualized`, `liquidation_cluster_1h`, `basis_spread_bps`). Assembly fails with `REQUEST_VALIDATION_ERROR` if any are missing, even if a given deployment doesn't populate perp features.

### Redacted Output

The script outputs a redacted JSON summary containing only operational fields:

```json
{
  "outcome": "persisted",
  "rowId": 99,
  "payloadHash": "hash-abc",
  "slotCount": 7,
  "warnings": []
}
```

**Never exposed in output:** wallet ID, canonical payload, full provenance details.

### Replay Behavior

Replaying the same request file with identical inputs produces an `identical_replay` outcome with the same `rowId` and `payloadHash`. The idempotency key is derived from the request's identity fields (schema version, publisher, source ID, run ID, correlation ID, pair, scope, and as-of timestamp).

### Seven-Slot Selection and Expiry

The assembler selects up to seven canonical feature slots from candidate derived features:

1. `range_location` — position range placement (PPM)
2. `distance_to_lower` — price distance to lower tick (PPM)
3. `distance_to_upper` — price distance to upper tick (PPM)
4. `oracle_dex_divergence` — oracle vs DEX price divergence (BPS)
5. `oracle_confidence_width` — oracle confidence interval width (BPS)
6. `realized_volatility_1h` — 1-hour realized volatility (BPS)
7. `volume_liquidity_ratio_24h` — 24h volume to TVL ratio (PPM)

Features are selected based on freshness (within 1 hour of `evaluationTimeUnixMs`) and version compatibility. Selection orders by: slot descending, then `observedAtUnixMs` descending, then `receivedAtUnixMs` descending, then ID ascending.

### Quality and Coverage Vocabulary

- **Quality levels:** `complete` (all slots usable), `partial` (some usable), `degraded` (major gaps)
- **Coverage statuses:** `available`, `partial`, `unavailable`, `not_applicable`
- **Confidence:** composite score in basis points (BPS), level `high`/`medium`/`low`
- **Warnings:** explicit codes for missing contextual evidence, unavailable research brief, expired-only slots

### Lineage Verification

The assembler verifies that selected features have valid lineage back to raw observations. It checks:

- Raw observation existence and consistency
- Normalized observation chain integrity
- Wallet/position/pool consistency with CLMM canonical source
- Feature derivation key authenticity

### Canonical Hash and Idempotency Semantics

The idempotency key is derived from: schema version, publisher, source ID, run ID, correlation ID, pair, scope (kind + identifiers), as-of timestamp, created timestamp, and sorted feature IDs with calculator versions.

The canonical payload hash is SHA-256 of the canonicalized JSON payload (deterministic key ordering, no undefined values).

### Publishing Boundary

Future publishing to regime-engine must send the stored `payloadCanonical` directly without reassembly. The stored canonical form is the authoritative idempotent representation.

### Migration Precondition

The migration that introduces evidence bundle constraints assumes `intelligence.evidence_bundles` is empty. If any row exists, the migration aborts. Do not rewrite or delete existing rows without lead engineer approval.

## Operational Research Brief Generation (`pnpm generate:brief`)

The `pnpm generate:brief <request-json-path>` command generates a schema-constrained LLM research brief over a bounded, stored evidence bundle.

### Command and Environment

```bash
pnpm generate:brief data/brief-request.json
```

Required environment variables:

- `LLM_BASE_URL`: Base URL for OpenAI-compatible LLM endpoint (e.g. `https://api.openai.com/v1`).
- `LLM_API_KEY`: API key for the LLM provider.
- `LLM_MODEL`: Target model identifier (e.g. `gpt-4o-mini`).

Optional environment variables:

- `LLM_MODEL_VERSION`: Optional model version tag.
- `LLM_TIMEOUT_MS`: Target timeout in milliseconds (defaults to finite 30,000 ms; no infinite wait and no generation retry loop).

### Request Structure and Caller Inputs

The request JSON file specifies target bundle lookup and context:

```json
{
  "evidenceBundleId": 42,
  "pair": "SOL/USDC",
  "evaluationTimeUnixMs": 1785398400000,
  "codeVersion": "1.2.3"
}
```

The request requires all four core fields:

- `evidenceBundleId`: Positive safe integer identifying the exact evidence bundle to target (e.g. `42`). There is no fallback to the "latest" bundle; `evidenceBundleId` is mandatory. A missing, non-positive, or non-integer ID exits nonzero and never selects the latest bundle.
- `pair`: Asset pair identifier (must be `"SOL/USDC"`).
- `evaluationTimeUnixMs`: Evaluation timestamp in unix milliseconds.
- `codeVersion`: Pipeline software version string.

Optional fields:

- `currentRegimeEvidence` (or `callerSuppliedCurrentRegime`): Caller-supplied regime context. If omitted or empty, regime assessment defaults to `not_applicable`.
- `runId`: Correlation identifier for the pipeline run.

### Authority Boundary and Bounded-Context Limits

- **Summarizes evidence only**: The LLM summarizes bounded, structured evidence. It does not invent numeric metrics, alter derived features, or synthesize policy decisions.
- **Strict JSON-Schema envelope**: Provider output is constrained by a strict JSON schema. Unvalidated or free-form responses fail closed.
- **Bounded prior context**: Prior-brief lookups are strictly bounded to at most 7 days and 10 bundles to prevent unbounded context growth.
- **No execution authority**: Briefs are advisory contextual research summaries.

### Complete vs Degraded Outcomes

- **`COMPLETE`**: Successfully generated over an active bundle, passes schema validation, and persisted. Eligible for outbound publication with evidence bundles.
- **`DEGRADED`**: Generated when input data or context is incomplete, expired, or degraded. Retained in Postgres as useful audit evidence but **not eligible for outbound attachment/publication**.

### Reading from `clmm-v2`

Required env vars:

```bash
CLMM_DATA_API_BASE=http://localhost:3001
CLMM_INSIGHTS_API_KEY=<must-match-clmm-v2-INSIGHTS_API_KEY>
WALLET_PUBLIC_KEY=<wallet-to-read>
```

Collector command:

```bash
pnpm collect:clmm-bundle
```

The collector calls:

```text
GET /insights/sol-usdc/bundle/:walletId
Header: x-insights-api-key: <CLMM_INSIGHTS_API_KEY>
```

The BFF response is validated before writing `data/latest-clmm-bundle.json`. Expected bundle content includes pair, source, pool snapshot, positions, range state, ticks, liquidity, unclaimed fees, actionable-trigger flags, alerts, observed time, and data-quality metadata.

Future bundle work in `clmm-v2` should add missing raw LP facts required for deterministic feature derivation while preserving the read-only character of this API.

### Writing to `regime-engine`

Current/legacy final-insight route:

```text
POST /v1/insights/sol-usdc
Header: X-Insight-Ingest-Token: <INSIGHT_INGEST_TOKEN>
```

Future evidence route:

```text
POST /v1/evidence/sol-usdc
Header: X-Evidence-Ingest-Token: <shared-secret>
```

New work should target the evidence route and evidence contract. The final PolicyInsight should be generated by Regime Engine, not authored by this repo.

## Operational Evidence Publication (`pnpm publish:evidence`)

The `pnpm publish:evidence <evidence-bundle-id>` command publishes a persisted evidence bundle to Regime Engine's evidence-ingest endpoint (`POST /v1/evidence/sol-usdc`).

### Command Invocation

```bash
pnpm publish:evidence 42
```

Invocation requires an explicit positive safe integer argument for the evidence bundle ID (e.g. `42`). Calling `pnpm publish:evidence` without an ID argument or with a non-positive/non-integer ID exits nonzero with an error without attempting any fallback lookup.

### Publication Semantics, Composition, and Degradation

- **Target Bundle Resolution**: Publication resolves target bundle ID `42` directly from `intelligence.evidence_bundles`.
- **Brief Composition**: Publication queries `intelligence.research_briefs` for an eligible complete brief tied to both that evidence bundle ID (`evidenceBundleId = 42`) and its exact payload hash (`payloadHash`).
- **Brief Eligibility and Fallback**: Only research briefs with `generationStatus = "complete"` are eligible for outbound composition and attachment. If no eligible complete brief exists (or if brief generation is degraded or missing), publication proceeds with the base evidence bundle without an attached brief.
- **`researchBriefState` Emission**: Outbound publication outcome emits `researchBriefState` (e.g. `attached`, `degraded`, `none`, `stale`) indicating brief composition status.
- **Audit Identity**: Every publish attempt persists an audit record in `intelligence.publish_attempts`. Audit identity fields (idempotency key, request hash, payload hash) are written directly from the actual outbound canonical payload sent over the wire, ensuring audit precision.

## Minimal setup

```bash
pnpm install
cp .env.example .env
pnpm cron:render
```

`pnpm cron:render` prints `hermes cron create` commands generated from `cron/jobs.yaml`. The actual scheduled runtime is **Hermes**; see `scheduling.md` for the full explanation and `pnpm cron:sync -- --apply` to actually register/update jobs against it.

### Scheduled cron jobs

Four jobs run against `cron/jobs.yaml`'s desired schedule, on Hermes:

| Job                | Schedule                    | Collector                       | Sources                                                     |
| ------------------ | --------------------------- | ------------------------------- | ----------------------------------------------------------- |
| `on-chain-flow`    | hourly (`0 * * * *`)        | `pnpm collect:on-chain-flow`    | Helius (whale_transfer), Birdeye (whale_swap, dex_net_flow) |
| `perp-liquidation` | every 5 min (`*/5 * * * *`) | `pnpm collect:perp-liquidation` | Binance fAPI, Drift (Velocity Data API)                     |
| `news-evidence`    | every 2h (`0 */2 * * *`)    | `pnpm collect:news-evidence`    | `crypto-news-api`, `regulatory-monitor-api`                 |
| `context-events`   | every 4h (`0 */4 * * *`)    | `pnpm collect:context-events`   | `solana-status-api` (live), `macro-calendar-api` (deferred) |

`context-events` defaults `SOLANA_STATUS_API_URL` to `https://status.solana.com`. `scheduled_event` is deferred when `MACRO_CALENDAR_API_URL` is unset, so a healthy incident-only run reports `PARTIAL`; missing scheduled coverage does not mean no scheduled risk.

## Useful commands

```bash
pnpm collect:core         # collects CLMM, Pyth, Jupiter, and Orca telemetry to Postgres
pnpm collect:price        # legacy command: collects Pyth and Jupiter telemetry to Postgres, updates compatibility snapshot
pnpm collect:clmm-bundle  # legacy command: fetches and writes SOL/USDC CLMM bundle from clmm-v2
pnpm collect:context-events  # collects contextual events (scheduled macro events, protocol incidents)
pnpm collect:support-resistance  # collects support/resistance levels from technical-analysis-api provider
pnpm collect:news-evidence  # collects ecosystem and regulatory news from two-source allowlist
pnpm collect:on-chain-flow    # collects on-chain flow evidence (whale transfers/swaps, DEX net flow) from Helius and Birdeye; stablecoin_flow and cex_flow_proxy are deferred
pnpm collect:perp-liquidation # collects perp/liquidation stress evidence (funding, OI, basis, liquidation clusters) from Binance fAPI and Drift
pnpm derive:mvp           # derives the seven canonical MVP evidence features from normalized observations
pnpm assemble:bundle      # assembles evidence bundle from derived features and observations
pnpm generate:brief data/brief-request.json # generates schema-constrained research brief over bounded evidence bundle
pnpm publish:evidence 42                    # publishes a persisted evidence bundle to regime-engine's evidence-ingest endpoint
pnpm contract:evidence-bundle:check     # verifies the pinned evidence-bundle contract asset hashes
pnpm contract:evidence-bundle:generate  # regenerates the evidence-bundle contract provenance manifest
pnpm db:generate          # generates Drizzle migrations from schema changes
pnpm db:migrate           # runs Drizzle migrations against DATABASE_URL
pnpm db:push              # pushes schema changes directly (dev only)
pnpm db:provision-roles   # provisions least-privilege Postgres roles for the intelligence schema
pnpm cron:render          # prints hermes cron create commands generated from cron/jobs.yaml (see scheduling.md)
pnpm cron:sync -- --apply # creates the jobs against Hermes (does not diff/delete existing jobs — see scheduling.md)
pnpm verify               # typecheck, lint, format, tests, boundaries
```

## Required env vars

See `.env.example`.

At minimum, for local deterministic runs:

```bash
CLMM_DATA_API_BASE=http://localhost:3001
CLMM_INSIGHTS_API_KEY=<shared-read-token-from-clmm-v2>
WALLET_PUBLIC_KEY=<your-solana-wallet-address>
SOL_MINT=So11111111111111111111111111111111111111112
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
ORCA_API_BASE=https://api.orca.so/v2/solana
WHIRLPOOL_ADDRESS=Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE
```

For `pnpm cron:sync -- --apply` (see `scheduling.md`), consumed only by that command — not by the Hermes gateway itself, which has its own separate config:

```bash
OPENCLAW_DELIVERY_CHANNEL=telegram
OPENCLAW_DELIVERY_TO=<chat-id-or-channel-id>
OPENCLAW_MODEL=opus
OPENCLAW_THINKING=high
```

`OPENCLAW_DELIVERY_CHANNEL`/`OPENCLAW_DELIVERY_TO` are used — mapped into each job's `--deliver <channel>:<to>`. `OPENCLAW_MODEL`/`OPENCLAW_THINKING` (and `OPENCLAW_AGENT`/`OPENCLAW_EXACT`) are read but currently have no effect: Hermes's `cron create` has no per-job model/thinking/agent/exact override, only a single gateway-wide default model configured separately on the Hermes side.

For Support Resistance collection:

```bash
SUPPORT_RESISTANCE_API_URL=<technical-analysis-api-provider-url>
SUPPORT_RESISTANCE_API_KEY=<optional-api-key>
```

For On-Chain Flow collection (Helius whale_transfer for position wallet, Birdeye whale_swap and dex_net_flow; see `docs/operator-runbook.md` for threshold overrides):

```bash
HELIUS_FLOW_API_URL=https://api.helius.xyz
HELIUS_API_KEY=<helius-api-key>
BIRDEYE_FLOW_API_URL=https://public-api.birdeye.so
BIRDEYE_API_KEY=<birdeye-api-key>
WALLET_PUBLIC_KEY=<position-wallet>
```

For Perp & Liquidation collection (Binance fAPI, Drift):

```bash
BINANCE_FAPI_BASE_URL=https://fapi.binance.com
BINANCE_SOL_PERP_SYMBOL=SOLUSDT
DRIFT_DATA_API_BASE_URL=https://data.velocity.exchange
DRIFT_SOL_PERP_SYMBOL=SOL-PERP
DRIFT_SOL_PERP_MARKET_INDEX=0
```

For Postgres:

```bash
DATABASE_URL=postgres://user:pass@host:5432/db
PG_SSL=true
PG_MAX_CONNECTIONS=10
```

## Database setup

This project uses Drizzle ORM with Postgres under the `intelligence` schema.

1. Set `DATABASE_URL` in `.env`.
2. Run migrations:

```bash
pnpm db:migrate
```

3. Verify schema:

```sql
SELECT nspname FROM pg_namespace WHERE nspname = 'intelligence';
```

The app sets `search_path=intelligence` automatically. See `drizzle.config.ts` for connection settings.

## Architecture

Pipeline code lives under `src/`:

```text
src/contracts       Canonical CLMM bundle, cron config, price snapshot, and evidence contracts
src/domain          Pure logic; no I/O, env, clock, or process access
src/ports           Interfaces for HTTP, JSON storage, text reading, env, clock, commands, persistence
src/application     Use cases for collectors, evidence assembly, publishing, and cron rendering/sync
src/jobs            Thin orchestration wrappers bound to runtime dependencies
src/adapters/node   Node implementations and createNodeRuntime() composition root
```

Scripts are thin entrypoints. They build the Node runtime, call one job, print output, and set `process.exitCode` on failure.

Boundary rules are enforced by dependency-cruiser:

```bash
pnpm boundaries
```

Full architecture notes live in `docs/architecture.md`.

## Repo layout

```text
AGENTS.md                         Agent operating contract
CLAUDE.md                         Claude/OpenClaw project instructions
scheduling.md                     Operator notes for scheduled cron (Hermes is the runtime; see file for why)
cron/jobs.yaml                    Desired cron schedule
cron/routines/                    Scheduled agent routine prompts
policies/                         Risk, range, rebalance, and execution boundaries
resources/                        Fundamental and market data source definitions
schemas/                          JSON contracts for outputs and snapshots
prompts/                          Reusable analysis prompts
scripts/                          Deterministic collectors/generators/cron helpers
src/                              Layered TypeScript pipeline code
tests/                            Vitest unit, application, and fixture regression tests
drizzle/                          Drizzle migrations
data/                             Local snapshots; raw high-frequency data belongs in persistence/backend systems
outputs/                          Latest structured outputs for dashboard/backend review
memory/                           Durable agent memory and review logs
docs/                             Architecture, runbooks, specs, and plans
```

## Guardrails

- This repo is not the source of truth for high-frequency market data.
- This repo is not the source of truth for live position execution state.
- Raw price ticks, pool snapshots, and every fee accrual update belong in Postgres or the backend owner service, not Git.
- Agent output is advisory evidence unless and until a downstream deterministic service accepts it through an explicit contract.
- Any future publish path to `regime-engine` must be schema-validated, authenticated, idempotent, and observable.
- The outbound payload should be evidence, not final policy conclusions.
- Recommendations must preserve the no-execution boundary.
