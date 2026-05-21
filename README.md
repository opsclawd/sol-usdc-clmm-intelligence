# SOL/USDC CLMM Intelligence

This repo is the advisory/evidence pipeline for the SOL/USDC CLMM Autopilot system.

It stores prompts, policies, schemas, OpenClaw routines, source definitions, durable memory, local snapshots, and deterministic collector code used to produce higher-level PolicyInsights for a user managing an Orca SOL/USDC Whirlpool LP position.

It is not the execution product. It does not own the mobile app, wallet connection, transaction preparation, signing flow, Solana RPC fan-out, or CLMM worker jobs. Those belong to `clmm-v2`.

## Current state

This repo currently provides:

- OpenClaw cron/routine definitions for scheduled SOL/USDC analysis;
- durable policy, prompt, routine, memory, resource, and schema assets;
- a layered TypeScript monolith under `src/` with contracts, domain logic, ports, application use cases, jobs, adapters, and DB schema;
- deterministic collectors for Jupiter price snapshots and CLMM bundles from the `clmm-v2` BFF;
- local JSON outputs under `data/` and `outputs/` for agent consumption and operator review;
- Drizzle/Postgres support under the `intelligence` schema;
- dependency-cruiser boundaries that keep domain/application logic separated from Node adapters;
- a hard no-execution boundary: recommendations are allowed, direct execution is not.

The intelligence pipeline is allowed to analyze, summarize, score, remember, and publish advisory artifacts. It is not allowed to submit transactions or bypass the product's user-approval flow.

## How the three repos work together today

```text
                    GeckoTerminal / market candles
                                |
                                v
                         regime-engine
              regime, S/R, S/R theses, policy insights
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
       OpenClaw routines, evidence memory, advisory outputs
```

Today:

- `clmm-v2` is the operational product. It owns wallet connection, monitored positions, alerts, preview approval, signing handoff, transaction submission, reconciliation, and history.
- `regime-engine` is the deterministic analytics and ledger service. It stores candles, computes current regime, stores S/R and insight blocks, and records CLMM execution-result events.
- `sol-usdc-clmm-intelligence` is the advisory/evidence pipeline. It pulls CLMM bundles from `clmm-v2`, combines them with price/source/research context, runs OpenClaw routines, and maintains durable advisory memory.

## Mature system vision

The mature system is a closed loop:

1. `clmm-v2` observes supported SOL/USDC Orca Whirlpool positions and exposes safe read-only snapshots through `/insights/sol-usdc/*`.
2. `regime-engine` maintains deterministic market context: candle history, trend/chop classification, CLMM suitability, support/resistance, S/R theses, and stored policy insights.
3. This repo runs scheduled intelligence routines against CLMM bundles, market sources, prior predictions, durable memory, and policy constraints.
4. This repo publishes structured PolicyInsights back to `regime-engine`.
5. `clmm-v2` reads those insights through backend-only adapters and uses them as context in the product experience.
6. Execution outcomes flow from `clmm-v2` into `regime-engine`; this repo can later review those outcomes to measure signal quality and update memory.

In the mature product, a minimal Anchor receipt/claim program may record one execution receipt per epoch after a completed user-approved execution. That proof layer is not implemented here. This repo remains advisory and evidence-oriented.

## System boundary

```text
Git repo                     = prompts, policies, schemas, routines, durable memory, collector code
OpenClaw Gateway cron         = scheduled isolated agent runs
Postgres / backend database   = durable intelligence records and low-frequency evidence state
clmm-v2 BFF                   = source of truth for live CLMM pool, position, alert, and bundle reads
regime-engine                 = source of truth for market regime, S/R, policy insight storage, and result ledger
Wallet / signer               = final authority for user-approved execution
```

## Non-negotiable rule

The LLM may produce recommendations. It may not directly rebalance, withdraw, swap, sign, submit, or execute. Any action that affects a user position must go through `clmm-v2` and the user's wallet approval path.

## Data flow today

```text
Jupiter price API              clmm-v2 /insights/sol-usdc/bundle/:walletId
       |                                           |
       v                                           v
data/latest-price-snapshot.json       data/latest-clmm-bundle.json
       |                                           |
       +-------------------+-----------------------+
                           v
                OpenClaw routine + durable memory
                           |
                           v
              advisory output / operator review
                           |
                           v
      optional publish to regime-engine /v1/insights/sol-usdc
```

## Integration contracts

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

### Writing to `regime-engine`

When configured, OpenClaw-generated policy insights should be published to:

```text
POST /v1/insights/sol-usdc
Header: X-Insight-Ingest-Token: <INSIGHT_INGEST_TOKEN>
```

`regime-engine` then becomes the serving layer for current and historical PolicyInsights, which `clmm-v2` can read through its backend-only `CurrentPolicyInsightsAdapter`.

## Minimal setup

```bash
pnpm install
cp .env.example .env
pnpm cron:render
```

The render step prints the OpenClaw commands needed to register cron jobs defined in `cron/jobs.yaml`.

## Useful commands

```bash
pnpm collect:price        # writes data/latest-price-snapshot.json from Jupiter
pnpm collect:clmm-bundle  # fetches and writes SOL/USDC CLMM bundle from clmm-v2
pnpm db:generate          # generates Drizzle migrations from schema changes
pnpm db:migrate           # runs Drizzle migrations against DATABASE_URL
pnpm db:push              # pushes schema changes directly (dev only)
pnpm cron:render          # prints OpenClaw cron add commands
pnpm cron:sync -- --apply # creates OpenClaw cron jobs
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
```

For OpenClaw delivery:

```bash
OPENCLAW_DELIVERY_CHANNEL=telegram
OPENCLAW_DELIVERY_TO=<chat-id-or-channel-id>
OPENCLAW_MODEL=opus
OPENCLAW_THINKING=high
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
src/contracts       Canonical CLMM bundle, cron config, and price snapshot types
src/domain          Pure logic; no I/O, env, clock, or process access
src/ports           Interfaces for HTTP, JSON storage, text reading, env, clock, commands
src/application     Use cases for collectors and cron rendering/sync
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
openclaw.md                       Operator notes for OpenClaw cron
cron/jobs.yaml                    Desired cron schedule
policies/                         Risk, range, rebalance, and execution boundaries
resources/                        Fundamental and market data source definitions
schemas/                          JSON contracts for outputs and snapshots
routines/                         OpenClaw routine prompts
prompts/                          Reusable analysis prompts
scripts/                          Deterministic collectors/generators/OpenClaw helpers
src/                              Layered TypeScript pipeline code
tests/                            Vitest unit, application, and fixture regression tests
drizzle/                          Drizzle migrations
data/                             Local snapshots; raw high-frequency data belongs elsewhere
outputs/                          Latest structured outputs for dashboard/backend review
memory/                           Durable agent memory and review logs
docs/                             Architecture, runbooks, specs, and plans
```

## Guardrails

- This repo is not the source of truth for high-frequency market data.
- This repo is not the source of truth for live position execution state.
- Raw price ticks, pool snapshots, and every fee accrual update belong in Postgres or the backend owner service, not Git.
- OpenClaw output is advisory unless and until a downstream deterministic service accepts it through an explicit contract.
- Any future publish path to `regime-engine` must be schema-validated, authenticated, idempotent, and observable.
- Recommendations must preserve the no-execution boundary.
