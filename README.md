# CLMM Autopilot Pipeline

Memory-backed analysis pipeline for a SOL/USDC concentrated-liquidity autopilot.

This repo is the **source of truth for pipeline logic**: prompts, policies, schemas, routine definitions, and durable memory. It is **not** the source of truth for high-frequency market data and it does **not** sign transactions.

## System boundary

```text
Git repo                     = prompts, policies, schemas, routine specs, durable memory
OpenClaw Gateway cron         = scheduled isolated agent runs
Postgres / backend database   = raw market, pool, position, and performance snapshots
clmm-v2 backend (/insights/sol-usdc/*) = deterministic calculations, validation, bundle delivery
Wallet / signer               = final authority for execution
```

## Non-negotiable rule

The LLM may produce recommendations. It may not directly rebalance, swap, withdraw, sign, or submit transactions.

## Minimal setup

```bash
pnpm install
cp .env.example .env
pnpm cron:render
```

The render step prints the OpenClaw commands needed to register the cron jobs defined in `cron/jobs.yaml`.

## Useful commands

```bash
pnpm collect:price        # writes data/latest-price-snapshot.json from Jupiter
pnpm collect:clmm-bundle  # fetches and writes SOL/USDC CLMM bundle from clmm-v2
pnpm cron:render          # prints OpenClaw cron add commands
pnpm cron:sync -- --apply # actually creates OpenClaw cron jobs
```

## Repo structure

```text
src/                              Layered monolith (domain / contracts / ports / application / jobs / adapters)
scripts/                          Thin entrypoints that call jobs through the Node composition root
tests/                            Vitest unit, application, and fixture regression tests
schemas/                          JSON Schema asset directory (unchanged)
policies/ prompts/ routines/ resources/ memory/ cron/   Non-code product assets (unchanged)
```

## Verification commands

```bash
pnpm typecheck       # tsc --noEmit
pnpm test            # vitest run
pnpm boundaries      # dependency-cruiser layer checks
pnpm verify          # all three above
```

The layered architecture and no-execution boundary are documented in `docs/architecture.md`.

## Required env vars

See `.env.example`.

At minimum, for local deterministic runs:

```bash
CLMM_DATA_API_BASE=http://localhost:3001
CLMM_INSIGHTS_API_KEY=<hex-key-from-clmm-v2>
WALLET_PUBLIC_KEY=<your-solana-wallet-address>
SOL_MINT=So11111111111111111111111111111111111111112
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

For OpenClaw delivery:

```bash
OPENCLAW_DELIVERY_CHANNEL=telegram
OPENCLAW_DELIVERY_TO=<chat-id-or-channel-id>
OPENCLAW_MODEL=opus
OPENCLAW_THINKING=high
```

## Repo layout

```text
AGENTS.md                         Agent operating contract
CLAUDE.md                         Claude/OpenClaw project instructions
openclaw.md                       Operator notes for OpenClaw cron
cron/jobs.yaml                    Desired cron schedule
policies/                         Risk, range, rebalance, and execution boundaries
resources/                        Fundamental and market data source definitions
schemas/                          JSON contracts for outputs and snapshots
routines/                         OpenClaw routine prompts
prompts/                          Reusable analysis prompts
scripts/                          Deterministic collectors/generators/OpenClaw helpers
data/                             Local snapshots; raw high-frequency data should live in DB
outputs/                          Latest structured outputs for dashboard/backend
memory/                           Durable agent memory and review logs
docs/                             Architecture and runbook
```
