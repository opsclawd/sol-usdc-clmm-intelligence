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
