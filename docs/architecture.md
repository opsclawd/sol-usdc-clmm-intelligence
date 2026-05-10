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

- `src/contracts` — typed snapshot input and output shapes plus cron config types.
- `src/domain` — pure decision logic (range status, fee classification, data-quality classification, advisory policy, daily / range / weekly decision assembly, cron command building). No I/O, no clock, no env.
- `src/ports` — interfaces for HTTP, JSON file storage, text reading, env, clock, and command execution.
- `src/application` — use cases that orchestrate domain functions through ports (collect price, collect backend snapshot, generate daily/range/weekly reviews, render and sync cron jobs).
- `src/jobs` — thin orchestration wrappers that bind use cases to dependency objects so cron-driven entrypoints have a single import point.
- `src/adapters/node` — concrete Node implementations of every port plus a `createNodeRuntime()` composition root.

`scripts/*` are thin entrypoints. Each builds the Node runtime, calls one job, prints output, and sets `process.exitCode` on failure. `pnpm` script names and JSON output paths are unchanged.

Boundary rules are enforced by `dependency-cruiser` (`pnpm boundaries`). The combined `pnpm verify` script runs typecheck, tests, and boundary checks.

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

```text
Raydium/Jupiter/DefiLlama/CoinGecko
          ↓
Fastify CLMM backend + database
          ↓
repo scripts collect snapshots
          ↓
outputs/*.json
          ↓
OpenClaw agent summary + memory updates
          ↓
dashboard / Telegram / ClickUp / operator review
```
