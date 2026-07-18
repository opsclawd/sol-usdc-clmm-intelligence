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

Legacy price-only path (still supported alongside the DB-backed pipeline):

```text
Jupiter price API
       |
       v
data/latest-price-snapshot.json
       |
       +--> OpenClaw routine + durable memory
```
