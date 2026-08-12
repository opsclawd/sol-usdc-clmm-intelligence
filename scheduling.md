# Scheduling Operator Notes

Hermes owns the scheduled runtime today. This repo owns the desired logic (`cron/jobs.yaml`, `cron/routines/*.md`).

## Why Hermes, not OpenClaw

This repo's cron-generation tooling (`pnpm cron:render`, `pnpm cron:sync -- --apply`, `src/domain/cron-command.ts`) was originally built against the OpenClaw CLI. As deployed, the OpenClaw gateway has no working model provider configured and cannot execute scheduled jobs. The actual scheduled runtime on the deployment VPS is **Hermes** (`hermes-agent`), a separate agent CLI running as its own systemd gateway service (`hermes-gateway.service`), configured with its own model/provider (MiniMax) entirely outside this repo's `.env`.

`cron-command.ts` now generates `hermes cron create` commands instead of `openclaw cron add` commands. `pnpm cron:sync -- --apply` is the recommended way to register/refresh jobs from `cron/jobs.yaml`/`cron/routines/*.md` — see below.

Hermes has no per-job model/thinking/agent override and no per-job timezone (it uses one gateway-wide model and the server's local timezone for all jobs), so `cron/jobs.yaml`'s `modelEnv`/`thinkingEnv`/`agentEnv`/`exactEnv`/`timezone`/`session` fields are still read (for schema continuity) but have no effect on the generated command. `delivery.channelEnv`/`delivery.toEnv` do have an effect — they're mapped into `--deliver <channel>:<to>`.

## Cron desired state

`cron/jobs.yaml` is the desired schedule and prompt-file mapping.

### Core evidence cadences

| Job                         | Cadence          | Responsibility                                                                                                |
| --------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `price-observations` (#104) | Every 5 minutes  | Build historical price density for `realized_volatility_1h`.                                                  |
| `on-chain-flow`             | Every 15 minutes | Collect SOL/USDC on-chain flow observations (Helius whale_transfer, Birdeye whale_swap and dex_net_flow).     |
| `perp-liquidation`          | Every 5 minutes  | Collect perp/liquidation stress evidence (funding, OI, basis, liquidation clusters).                          |
| `news-evidence`             | Every 2 hours    | Collect ecosystem and regulatory news evidence.                                                               |
| `context-events`            | Every 4 hours    | Collect contextual events (scheduled macro events, protocol incidents).                                       |
| `support-resistance`        | Every 4 hours    | Collect support/resistance levels from technical analysis providers.                                          |
| `core-evidence-pipeline`    | Every 4 hours    | Collect core observations, derive features, assemble evidence, generate briefs, and publish the exact bundle. |

The synthesis cadence is 4 hours (`0 */4 * * *`), matching the core evidence pipeline schedule. The five-minute sampler remains a separate job because historical telemetry density and synthesis have different cadence and cost requirements.

Specifically, for `on-chain-flow` (15-minute cadence):

- The job runs every 15 minutes (`*/15 * * * *`) with a matching 900,000 ms (15-minute) default lookback window so adjacent runs have no structural gap. Helius queries `WHIRLPOOL_ADDRESS`, not `WALLET_PUBLIC_KEY` (though `addressContext.addressType` remains `wallet` for compatibility).
- Implemented live thresholds by exact repository name and value:

```bash
ON_CHAIN_WHALE_TRANSFER_MIN_USDC=100000
ON_CHAIN_WHALE_SWAP_MIN_USDC=100000
ON_CHAIN_DEX_NET_FLOW_MIN_USDC=250000
```

- Calibration arithmetic:
  Current snapshot: $72,954,595 24h volume and $26,150,296 TVL.
  $72,954,595 / 96 fifteen-minute windows = approximately $759,944 gross volume per window.
  $100,000 / $759,944 = approximately 13.2% of a typical window.

- Note: Observed VPS variable names `ON_CHAIN_STABLECOIN_FLOW_MIN_USDC` and `ON_CHAIN_CEX_PROXY_MIN_USDC` are parsed for deferred signal kinds and do not replace the live whale-transfer/whale-swap variables.
- Operator Callout: The deployment VPS must set the two live whale values (`ON_CHAIN_WHALE_TRANSFER_MIN_USDC` and `ON_CHAIN_WHALE_SWAP_MIN_USDC`) to `100000`; repository documentation cannot mutate host-local environment state.
- The 15-minute schedule makes four times as many collection attempts per hour (Helius and Birdeye) compared to the old hourly schedule; operators must monitor provider rate limits (429s) and costs after rollout.

Specifically, for five-minute sampling:

- The five-minute `price-observations` job supplies historical Pyth/Jupiter observation density while the `collect:core` stage remains the fresh snapshot source for derivation/assembly.
- Ten healthy five-minute ticks require approximately 45-50 minutes after startup or prolonged downtime before `realized_volatility_1h` can satisfy coverage.
- A missing/delayed tick that creates a gap over ten minutes returns the feature to `UNAVAILABLE` with `insufficient_coverage` or `excessive_gap`, never fabricated zero volatility.
- Concurrent price collection near each quarter hour is accepted but source rate-limit/command failures must remain visible to operators.

At the ungated MVP cadence, maximum brief attempts are `6 runs/day × configured position count`; two positions can therefore produce up to 12 attempts per day. Pipeline duration approaching 4 hours is an overlap/capacity warning. Confirm the deployed LLM model, provider rate limits, and budget can sustain the configured position count before registration. Material-change gating and a slower brief-only cadence remain future work.

This repository change declares desired state only and does not register the job on Hermes (issue #96 remains the live-registration boundary).

## Registering / updating jobs

```bash
pnpm cron:render          # print create-command rendering without inspecting Hermes state
pnpm cron:sync -- --apply # reconcile jobs against host Hermes store (create or edit)
```

`pnpm cron:render` displays create-command rendering for inspection without inspecting live Hermes state.

`pnpm cron:sync -- --apply` performs job-store-backed create-or-edit reconciliation against the host Hermes store:

1. `cron:sync` reads and validates the full host-local job store from `HERMES_JOBS_FILE_PATH` (or `$HOME/.hermes/cron/jobs.json` if unset; relative paths and `~` are not expanded).
2. A unique exact name match becomes `hermes cron edit <id> --prompt ... --schedule ... --deliver ...`.
3. A missing job name becomes `hermes cron create ...`.
4. Jobs present only in Hermes are untouched (retained, no deletion).
5. Missing or malformed stores, invalid identities, relative paths, and duplicate names in the store abort reconciliation before any CLI commands run.
6. A CLI command failure stops execution of later commands, but does not roll back commands Hermes already accepted.

Manual CLI commands remain available for inspection, deletion of unneeded jobs, or exceptional maintenance:

```bash
H="/root/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main"
$H cron list
$H cron rm <job-id>
$H cron edit <job-id> --prompt "<new prompt text>" --schedule "<new cron-expr>"
```

Every generated prompt is prefixed with an explicit working-directory instruction (`cron/jobs.yaml`'s `workingDirectory` field) — Hermes's terminal backend does not default into this repo's checkout:

```
Working directory for this task: /opt/apps/sol-usdc-clmm-intelligence — run all shell commands from there (cd into it first).

<routine content>
```

## Runtime assumptions

- Jobs run in isolated sessions (`session: isolated` in `cron/jobs.yaml` reflects the intent; Hermes runs each cron tick as its own agent turn by default).
- Job prompts are sourced from `cron/routines/*.md`.
- Requires `croniter` installed in the Hermes venv for cron-expression (as opposed to simple interval) schedules — without it, cron-kind jobs silently fail to compute their next run and get auto-disabled after firing once. Verify with `pip3 show croniter` in the venv if jobs stop recurring after their first tick.
- The Hermes gateway process must be restarted after installing new Python dependencies into its venv — it does not pick up newly-installed packages while already running.
- Gateway must remain running (`systemctl --user status hermes-gateway.service`).

## Operational checks

```bash
H="/root/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main"
$H status
$H cron status
$H cron list
$H cron runs --id <job-id> --limit 20
```

## Failure rules

If a job fails due to missing data:

1. Do not invent a recommendation.
2. Write an output with `dataQuality = stale` or `partial`.
3. Recommend `hold` or `watch`.
4. Log the missing input.
