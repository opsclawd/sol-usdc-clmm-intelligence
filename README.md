# SOL/USDC CLMM Intelligence

This repo is the advisory/evidence pipeline for the SOL/USDC CLMM Autopilot system.

It stores prompts, policies, schemas, OpenClaw routines, source definitions, durable memory, local snapshots, deterministic collector code, and evidence-pipeline infrastructure used to research a user-managed Orca SOL/USDC Whirlpool LP position.

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
- a hard no-execution boundary: analysis is allowed, direct execution is not.

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
       OpenClaw routines, evidence memory, advisory outputs
```

Today:

- `clmm-v2` is the operational product. It owns wallet connection, monitored positions, alerts, preview approval, signing handoff, transaction submission, reconciliation, and history.
- `regime-engine` is the deterministic analytics and ledger service. It stores candles, computes current regime, stores S/R/current insight blocks, and records CLMM execution-result events.
- `sol-usdc-clmm-intelligence` is the advisory/evidence pipeline. It pulls CLMM bundles from `clmm-v2`, combines them with price/source/research context, runs OpenClaw routines, and maintains durable memory.

## Open roadmap and future state

Open issues #2 and #7 through #13 define the corrected architecture: this repo should become a durable evidence pipeline, not the final policy author.

The corrected boundary is:

```text
intelligence engine = collect + normalize + derive + summarize evidence
regime-engine       = synthesize canonical PolicyInsight
clmm-v2             = consume/display final policy and own live LP state
```

### Evidence-pipeline epic

Tracked by #2.

The roadmap refactors this repo from a script-first OpenClaw artifact pipeline into a durable evidence pipeline that gathers, normalizes, stores, derives, summarizes, and publishes structured research evidence for Regime Engine.

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

Tracked by #7.

The ingestion layer should collect and normalize at least:

- `clmm-v2` SOL/USDC insight bundle for raw LP/pool/alert facts;
- Orca pool/public stats for pool-level volume, fees, and TVL context where needed;
- Pyth or equivalent canonical SOL/USD oracle observations;
- Jupiter quotes and price observations for DEX comparison and route context;
- Solana network/status inputs needed for deterministic availability warnings.

Raw responses should be persisted before normalization. Partial source failures should produce explicit warnings, not fabricated values.

### Deterministic feature derivation

Tracked by #8.

Numerical features should be computed by code, not by an LLM. Required feature families include:

- price quality: oracle/DEX divergence, oracle confidence-width warnings, wick/spike flags, breakout confirmation inputs;
- CLMM economics: fee APR/yield, expected fee capture, volume/liquidity ratio, inventory skew, fee-to-volatility ratio, rebalance cost, range-distance metrics, breach-risk inputs;
- market/execution context: realized volatility, volume confirmation, liquidity-cliff candidates, and generic route/slippage context that does not become user-specific execution authority.

Every feature should carry input lineage, as-of time, freshness, and confidence. Missing inputs should degrade explicitly.

### Contextual research collectors

Tracked by #9, #10, and #11.

Research collector packs should add:

- support/resistance theses;
- macro calendar and high-impact scheduled events;
- Solana protocol incidents and ecosystem news;
- regulatory headlines relevant to SOL/USDC market risk;
- whale transfers and whale swaps;
- stablecoin mint/burn and transfer flows;
- DEX net flow and SOL buy/sell pressure;
- defensible CEX flow proxies;
- funding rates, open interest, perp/spot basis, liquidation clusters, and leverage-crowding proxies.

Facts and interpretations must remain separate. A transfer is a fact; motive is an interpretation. Noisy signals should carry explicit source-quality and confidence metadata.

### Schema-constrained research briefs

Tracked by #12.

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

Tracked by #13 and #21.

The future outbound publisher should target Regime Engine's evidence-ingest endpoint, not the legacy final-insight route.

Expected payload content:

- deterministic feature summaries;
- contextual evidence summaries;
- LLM research brief;
- freshness/confidence/provenance metadata;
- source refs;
- versioning and idempotency fields.

Publish attempts should be persisted with target endpoint, evidence bundle ID, optional research brief ID, idempotency key, request/payload hashes, status, HTTP status, response body, error information, attempt number, and timestamps.

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
OpenClaw Gateway cron         = scheduled isolated agent runs
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

## Future evidence flow

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
data/                             Local snapshots; raw high-frequency data belongs in persistence/backend systems
outputs/                          Latest structured outputs for dashboard/backend review
memory/                           Durable agent memory and review logs
docs/                             Architecture, runbooks, specs, and plans
```

## Guardrails

- This repo is not the source of truth for high-frequency market data.
- This repo is not the source of truth for live position execution state.
- Raw price ticks, pool snapshots, and every fee accrual update belong in Postgres or the backend owner service, not Git.
- OpenClaw output is advisory evidence unless and until a downstream deterministic service accepts it through an explicit contract.
- Any future publish path to `regime-engine` must be schema-validated, authenticated, idempotent, and observable.
- The outbound payload should be evidence, not final policy conclusions.
- Recommendations must preserve the no-execution boundary.
