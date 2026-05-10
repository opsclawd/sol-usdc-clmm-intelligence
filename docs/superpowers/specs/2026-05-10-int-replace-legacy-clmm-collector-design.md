# Design Spec: INT-REPLACE-LEGACY-CLMM-COLLECTOR (#4) + INT-REMOVE-LEGACY-RECOMMENDATION-FLOWS (#14)

## Status

**Approved.** One PR closing both #4 and #14.

## Motivation

The legacy backend snapshot collector at `/api/clmm/sol-usdc/*` made three separate HTTP
calls (pool, position, performance), wrote three separate files, and fed into three
recommendation flows (daily insight, range review, weekly review) that acted as a
second policy brain — duplicating responsibility that the new architecture vests in
regime-engine. Meanwhile, clmm-v2 exposes a single canonical bundle endpoint at
`/insights/sol-usdc/bundle/:walletId` that returns all relevant data (pool, positions,
support/resistance levels, alerts, data quality) in one call.

This spec replaces the legacy collector with the clmm-v2 bundle consumer and removes
all recommendation-oriented code that the new evidence pipeline rejects.

### Key design decisions

1. **Single PR, atomic cut.** Both #4 and #14 close from one PR so `main` never
   lands in a broken transitional state (generators trying to read nonexistent files).
2. **No compatibility layer.** The legacy three-file output is replaced by a single
   `data/latest-clmm-bundle.json`. Downstream consumers (INT-CORE #7 onward) read the
   bundle. No backward compat shim.
3. **No recommendation flows.** Daily insight, range review, weekly review, the
   emergency volatility check, and all their supporting domain modules are deleted,
   not migrated. Regime-engine owns policy synthesis.
4. **Keep `collect:price` + `PriceSnapshot`.** Jupiter price ingestion is not legacy;
   it is a legitimate future data source for INT-CORE. Deleted when INT-CORE #7
   replaces it properly.

## Scope

### In scope

- New bundle collector: single HTTP call to `GET /insights/sol-usdc/bundle/:walletId`
- Canonical persisted bundle contract in `src/contracts/clmm-bundle.ts`
- Removal of all domain modules for recommendation flows
- Removal of all application, job, script, test, and fixture files for legacy flows
- Removal of all LLM routine prompts, memory files, and schemas for legacy flows
- Removal of legacy cron jobs from `cron/jobs.yaml`
- Update `src/contracts/snapshots.ts` to retain only `PriceSnapshot`
- Update env config, sources, docs, AGENTS.md

### Out of scope

- DB persistence layer (INT-PERSIST #5)
- Evidence taxonomy types (INT-TAXONOMY #6)
- Core intelligence / features extraction (INT-CORE #7 / INT-FEATURES #8)
- Evidence bundle publication (INT-PUBLISH #13)
- CLMM-v2 API surface or auth changes

## Upstream Contract: clmm-v2 Bundle Endpoint

### Endpoint

```
GET {CLMM_DATA_API_BASE}/insights/sol-usdc/bundle/{walletId}
Header: x-insights-api-key: {CLMM_INSIGHTS_API_KEY}
```

- `walletId`: base58 Solana address (validated server-side, 400 on invalid format)
- Returns `{ bundle: SolUsdcInsightInputBundleDto }` on success
- Returns `503` with `SolUsdcInsightErrorDto` on upstream failures

### Envelope shape

```typescript
{
  bundle: {
    pair: "SOL/USDC",
    source: "orca",
    observedAtUnixMs: number,
    pool: { /* PoolSnapshotDto fields */ },
    srLevels: SrLevelsBlock | null,
    positions: SolUsdcPositionInsightDto[],
    alerts: Array<{
      triggerId: string,
      positionId: string,
      breachDirection: "lower-bound-breach" | "upper-bound-breach",
      triggeredAt: number
    }>,
    dataQuality: {
      warnings: string[],
      isPartial: boolean,
      missingSources: string[]
    }
  }
}
```

### Pool data

| Field            | Type                        | Notes                          |
| ---------------- | --------------------------- | ------------------------------ |
| poolId           | string                      | Orca Whirlpool address         |
| pair             | "SOL/USDC"                  | Literal                        |
| source           | "orca"                      | Literal                        |
| currentPrice     | number                      | Derived from sqrtPrice         |
| sqrtPrice        | string                      | Decimal-string of on-chain u64 |
| tickCurrentIndex | number                      | Current tick index             |
| tickSpacing      | number                      | Whirlpool tick spacing         |
| feeRate          | number                      | Basis points                   |
| poolLiquidity    | string                      | Decimal-string of on-chain u64 |
| priceSource      | "orca_whirlpool_sqrt_price" | Literal                        |

### Position data (multi-position)

Each position entry includes:

| Field                                               | Type                                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| positionId                                          | string                                                                                             |
| rangeState                                          | "in-range" \| "below-range" \| "above-range"                                                       |
| lowerTick, upperTick, currentTick                   | number                                                                                             |
| lowerPriceLabel, upperPriceLabel, currentPriceLabel | string                                                                                             |
| currentPrice                                        | number                                                                                             |
| rangeDistance                                       | { belowLowerTickPercent, aboveUpperTickPercent, belowLowerPricePercent?, aboveUpperPricePercent? } |
| unclaimedFees                                       | { feeOwedA, feeOwedB } each with raw/decimals/symbol/mint                                          |
| unclaimedFeesUsd, unclaimedRewardsUsd               | number \| null                                                                                     |
| positionLiquidity, poolLiquidity                    | string                                                                                             |
| hasActionableTrigger                                | boolean                                                                                            |
| triggerId, breachDirection                          | optional                                                                                           |

### Auth

`x-insights-api-key` header matching the server's `INSIGHTS_API_KEY` env var.
`401` with `{ code: "unauthorized", retryable: false }` on mismatch.

## New Files

### src/contracts/clmm-bundle.ts

Canonical persisted bundle contract. Mirrors the upstream bundle shape as a
self-contained set of types (no clmm-v2 imports). Serves as the inbound wire
contract for the persisted artifact consumed by INT-CORE onward.

```typescript
export interface ClmmBundle {
  pair: "SOL/USDC";
  source: "orca";
  observedAtUnixMs: number;
  pool: PoolData;
  srLevels: SrLevels | null;
  positions: PositionData[];
  alerts: AlertData[];
  dataQuality: DataQuality;
}

export interface PoolData {
  /* pool fields */
}
export interface PositionData {
  /* position fields, multi-position */
}
export interface SrLevels {
  supports: SrLevel[];
  resistances: SrLevel[]; /* etc */
}
export interface AlertData {
  triggerId: string;
  positionId: string; /* etc */
}
export interface DataQuality {
  warnings: string[];
  isPartial: boolean;
  missingSources: string[];
}
```

### src/application/collect-clmm-bundle.ts

```typescript
export interface CollectClmmBundleDeps {
  http: HttpClient;
  jsonStore: JsonStore;
  env: EnvReader;
}

// Reads CLMM_DATA_API_BASE, CLMM_INSIGHTS_API_KEY, WALLET_PUBLIC_KEY from env
// Fetches bundle, validates envelope, writes data/latest-clmm-bundle.json
// Throws on missing env vars, non-OK HTTP, malformed envelope, malformed payload
```

### src/jobs/clmm-bundle-job.ts

Thin factory: `clmmBundleJob(deps: CollectClmmBundleDeps) => () => Promise<void>`

### scripts/collectors/clmm-bundle.ts

Entrypoint:

```typescript
import { createNodeRuntime } from "../../src/adapters/node/index.js";
import { clmmBundleJob } from "../../src/jobs/index.js";
// loads .env, creates runtime, calls clmmBundleJob(...)
```

## Bundle Collector Behaviour

| Scenario                             | Behaviour                                                      |
| ------------------------------------ | -------------------------------------------------------------- |
| Missing `CLMM_DATA_API_BASE`         | Throw with descriptive message                                 |
| Missing `CLMM_INSIGHTS_API_KEY`      | Throw with descriptive message                                 |
| Missing `WALLET_PUBLIC_KEY`          | Throw with descriptive message                                 |
| HTTP non-OK status                   | Throw with status + body excerpt                               |
| Malformed envelope (no bundle field) | Throw with parse failure detail                                |
| Malformed bundle payload (bad types) | Throw with parse failure detail                                |
| Base URL has trailing slash          | Normalize (strip trailing slash in URL construction)           |
| Success                              | Write `data/latest-clmm-bundle.json` with the validated bundle |

The collector does NOT parse/validate the full bundle schema. It performs
envelope validation (`bundle` field exists, top-level fields present) but trusts
the upstream for structural correctness. Malformed payload detection ensures
we do not persist garbage; it does not attempt structural validation of every
nested field.

## Deletion Scope

### Domain modules (all dead, no surviving consumers)

| File                                   | Reason                                                          |
| -------------------------------------- | --------------------------------------------------------------- |
| `src/domain/types.ts`                  | All types consumed only by deleted decision functions           |
| `src/domain/data-quality.ts`           | Only consumed by daily-insight-decision + range-review-decision |
| `src/domain/range-status.ts`           | Only consumed by daily-insight-decision + range-review-decision |
| `src/domain/fee-classification.ts`     | Only consumed by daily-insight-decision                         |
| `src/domain/advisory-policy.ts`        | Only consumed by daily-insight-decision                         |
| `src/domain/daily-insight-decision.ts` | Root of legacy recommendation flows                             |
| `src/domain/range-review-decision.ts`  | Root of legacy recommendation flows                             |
| `src/domain/weekly-review-decision.ts` | Root of legacy recommendation flows                             |
| `tests/domain/*.test.ts` (7 files)     | Tests for deleted domain modules                                |

### Contracts

| File                         | Action                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| `src/contracts/outputs.ts`   | Delete (depends on legacy decision types)                                                 |
| `src/contracts/snapshots.ts` | **Trim** — remove PoolSnapshot, PositionSnapshot, PerformanceSnapshot; keep PriceSnapshot |
| `src/contracts/index.ts`     | Update barrel: remove outputs.ts, add clmm-bundle.ts                                      |

### Application modules

| File                                          | Reason                       |
| --------------------------------------------- | ---------------------------- |
| `src/application/collect-backend-snapshot.ts` | Replaced by bundle collector |
| `src/application/generate-daily-insight.ts`   | Legacy recommendation flow   |
| `src/application/generate-range-review.ts`    | Legacy recommendation flow   |
| `src/application/generate-weekly-review.ts`   | Legacy recommendation flow   |

### Job modules

| File                               | Reason        |
| ---------------------------------- | ------------- |
| `src/jobs/backend-snapshot-job.ts` | Replaced      |
| `src/jobs/daily-insight-job.ts`    | Legacy        |
| `src/jobs/range-review-job.ts`     | Legacy        |
| `src/jobs/weekly-review-job.ts`    | Legacy        |
| `src/jobs/index.ts`                | Update barrel |

### Scripts

| File                                        | Reason                              |
| ------------------------------------------- | ----------------------------------- |
| `scripts/collectors/backend-snapshot.ts`    | Replaced                            |
| `scripts/collectors/raydium-placeholder.ts` | References deleted backend-snapshot |
| `scripts/generate/daily-insight.ts`         | Legacy                              |
| `scripts/generate/range-review.ts`          | Legacy                              |
| `scripts/generate/weekly-review.ts`         | Legacy                              |

### Routines (LLM prompt files, all depend on `pnpm collect:backend`)

| File                                     | Reason                                                       |
| ---------------------------------------- | ------------------------------------------------------------ |
| `routines/daily-sol-usdc-insight.md`     | Runs deleted `pnpm collect:backend` and `pnpm insight:daily` |
| `routines/range-review.md`               | Runs deleted `pnpm collect:backend` and `pnpm review:range`  |
| `routines/emergency-volatility-check.md` | Runs deleted `pnpm collect:backend` and `pnpm review:range`  |
| `routines/weekly-performance-review.md`  | Runs deleted `pnpm collect:backend` and `pnpm review:weekly` |

### Prompts (only used by deleted routines)

| File                                  |
| ------------------------------------- |
| `prompts/daily-insight.prompt.md`     |
| `prompts/volatility-regime.prompt.md` |
| `prompts/weekly-review.prompt.md`     |

### Memory (only referenced by deleted routines, except lessons-learned)

| File                        | Action                            |
| --------------------------- | --------------------------------- |
| `memory/daily-insights.md`  | Delete                            |
| `memory/rebalance-log.md`   | Delete                            |
| `memory/weekly-reviews.md`  | Delete                            |
| `memory/strategy.md`        | Delete                            |
| `memory/lessons-learned.md` | **Keep** — generic durable memory |

### Schemas

| File                                           | Action                                               |
| ---------------------------------------------- | ---------------------------------------------------- |
| `schemas/sol-usdc-daily-insight.schema.json`   | Delete (output of deleted flow)                      |
| `schemas/rebalance-recommendation.schema.json` | Delete (output of deleted flow)                      |
| `schemas/pool-snapshot.schema.json`            | Delete (describes removed legacy artifact)           |
| `schemas/position-snapshot.schema.json`        | Delete (describes removed legacy artifact)           |
| `schemas/price-snapshot.schema.json`           | **Keep** — describes PriceSnapshot which is retained |

### Test files

| Category                  | Files                                                                                                     | Action   |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | -------- |
| Domain tests              | 7 files (advisory-policy, range-status, fee-classification, data-quality, daily/range/weekly-decision)    | Delete   |
| Application tests         | 4 files (collect-backend-snapshot, generate-daily-insight, generate-range-review, generate-weekly-review) | Delete   |
| Regression tests          | 3 files (daily-insight.fixture, range-review.fixture, weekly-review.fixture)                              | Delete   |
| Cron infrastructure tests | 4 files (cron-command, load-cron-config, sync-cron, render-cron-commands, cron-render.fixture)            | **Keep** |

### Fixture data

| Path                                                              | Action   |
| ----------------------------------------------------------------- | -------- |
| `tests/fixtures/expected/daily-insight-*.json` (3 files)          | Delete   |
| `tests/fixtures/expected/range-review-*.json` (2 files)           | Delete   |
| `tests/fixtures/expected/weekly-review-stale.json`                | Delete   |
| `tests/fixtures/snapshots/complete/latest-pool-snapshot.json`     | Delete   |
| `tests/fixtures/snapshots/complete/latest-position-snapshot.json` | Delete   |
| `tests/fixtures/snapshots/partial/latest-pool-snapshot.json`      | Delete   |
| `tests/fixtures/snapshots/complete/latest-price-snapshot.json`    | **Keep** |
| `tests/fixtures/snapshots/partial/latest-price-snapshot.json`     | **Keep** |
| `tests/fixtures/cron/*`                                           | **Keep** |
| `tests/fixtures/expected/cron-render.txt`                         | **Keep** |

## Modified Files

### src/jobs/index.ts

Remove: `backendSnapshotJob`, `dailyInsightJob`, `rangeReviewJob`, `weeklyReviewJob`
Add: `clmmBundleJob`

### src/contracts/index.ts

Remove: `outputs.ts`
Add: `clmm-bundle.ts`
Keep: trimmed `snapshots.ts` (only PriceSnapshot), `cron-config.ts`

### src/contracts/snapshots.ts

Remove: `PoolSnapshot`, `PositionSnapshot`, `PerformanceSnapshot`
Keep: `PriceSnapshot`

### package.json

| Change | Before            | After                 |
| ------ | ----------------- | --------------------- |
| Rename | `collect:backend` | `collect:clmm-bundle` |
| Remove | `insight:daily`   | —                     |
| Remove | `review:range`    | —                     |
| Remove | `review:weekly`   | —                     |

### .env.example

- Add: `CLMM_INSIGHTS_API_KEY=` — API key for clmm-v2 insight endpoints
- Keep: `CLMM_DATA_API_BASE` — base URL for clmm-v2 server
- Keep: `WALLET_PUBLIC_KEY` — wallet ID for bundle endpoint path param
- Keep: all other existing vars unchanged

### resources/sources.yaml

Replace `backend-clmm-api` source with `clmm-v2`:

```yaml
- name: clmm-v2
  priority: critical
  type: internal-api
  env: CLMM_DATA_API_BASE
  purpose:
    - pool_state
    - positions
    - alerts
    - sr_context
    - data_quality_warnings
```

### cron/jobs.yaml

Remove all 4 legacy jobs: `clmm-daily-sol-usdc-insight`, `clmm-range-review`,
`clmm-emergency-volatility-check`, `clmm-weekly-performance-review`.

The file should contain only defaults (timezone, session, delivery config) with
an empty or removed `jobs:` list (no LLM-driven cron jobs remain in this repo).

### docs/architecture.md

- Remove recommendation flow references from the layered monolith description
- Remove issue #14 from the downstream split section (both closed by this PR)
- Update data flow diagram: replace Fastify backend + snapshot collectors with clmm-v2 bundle
- Add clmm-bundle.ts to contracts layer description
- Remove recommendation-oriented language from domain layer description

### AGENTS.md

- Remove #14 from the key issues list (closed in this PR)
- Update #4 description to reflect it is done
- Remove reference to #14 blocker text
- Update `src/domain` description to remove recommendation-oriented language
- Update `src/contracts` description
- Update decision hierarchy to remove recommendation-language (it is a pure evidence pipeline)

### README.md

- Remove `insight:daily`, `review:range`, `review:weekly` from useful commands
- Rename `collect:backend` to `collect:clmm-bundle` in any references
- Remove references to `outputs/*.json` for recommendation artifacts
- Remove promotion path section (recommendation-only → paper → human → autonomous — no longer relevant)
- Update minimal setup section
- Update system boundary / data flow diagrams

### docs/operator-runbook.md

- Remove `pnpm collect:backend` troubleshooting entry
- Remove `pnpm insight:daily` from first-run example
- Update failure mode section (bad recommendation no longer applicable)

## Bundle Output Path

```typescript
const CLMM_BUNDLE_PATH = "data/latest-clmm-bundle.json";
```

## NPM Script Name

```
pnpm collect:clmm-bundle     # tsx scripts/collectors/clmm-bundle.ts
```

## Retained Infrastructure

The following are **shared** and **not** legacy-specific:

- `src/domain/cron-command.ts` — cron command building logic
- `src/application/load-cron-config.ts` — YAML config loader
- `src/application/sync-cron.ts` — OpenClaw cron sync
- `src/application/render-cron-commands.ts` — command renderer
- `src/contracts/cron-config.ts` — cron config types
- `src/jobs/cron-render-job.ts`, `cron-sync-job.ts`
- `src/jobs/jupiter-price-job.ts`, `coingecko-job.ts`, `defillama-job.ts`
- `src/application/collect-jupiter-price.ts`, `collect-coingecko.ts`, `collect-defillama.ts`
- `src/adapters/node/` — entire adapter layer
- `src/ports/` — all port interfaces
- `tests/fakes/` — all fake implementations
- `tests/domain/cron-command.test.ts`
- `tests/application/load-cron-config.test.ts`, `sync-cron.test.ts`, `render-cron-commands.test.ts`
- `tests/regression/cron-render.fixture.test.ts`
- `tests/application/collect-jupiter-price.test.ts`, `ancillary-collectors.test.ts`
- `tests/fixtures/cron/` and `tests/fixtures/expected/cron-render.txt`
- `tests/fixtures/snapshots/complete/latest-price-snapshot.json`
- `tests/fixtures/snapshots/partial/latest-price-snapshot.json`
- `scripts/collectors/jupiter-price.ts`, `coingecko.ts`, `defillama.ts`
- `scripts/openclaw/render-cron-commands.ts`, `sync-cron.ts`

## Blocker Status

Issue #14 (`INT-REMOVE-LEGACY-RECOMMENDATION-FLOWS`) will be closed by this PR.
Its blocker text should be updated to `CLOSED — folded into #4`.

## Verification

Before merge:

```bash
pnpm typecheck       # must pass (deleted files removed from type graph)
pnpm test            # must pass (surviving tests, no stale imports)
pnpm boundaries      # must pass (dependency-cruiser layer rules)
pnpm verify          # all three above
```
