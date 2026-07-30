# Scheduling Operator Notes

Hermes owns the scheduled runtime today. This repo owns the desired logic (`cron/jobs.yaml`, `cron/routines/*.md`).

## Why Hermes, not OpenClaw

This repo's cron-generation tooling (`pnpm cron:render`, `pnpm cron:sync -- --apply`, `src/application/cron-command.ts`) was originally built against the OpenClaw CLI. As deployed, the OpenClaw gateway has no working model provider configured and cannot execute scheduled jobs. The actual scheduled runtime on the deployment VPS is **Hermes** (`hermes-agent`), a separate agent CLI running as its own systemd gateway service (`hermes-gateway.service`), configured with its own model/provider (MiniMax) entirely outside this repo's `.env`.

`cron-command.ts` now generates `hermes cron create` commands instead of `openclaw cron add` commands. `pnpm cron:sync -- --apply` is the recommended way to register/refresh jobs from `cron/jobs.yaml`/`cron/routines/*.md` — see below.

Hermes has no per-job model/thinking/agent override and no per-job timezone (it uses one gateway-wide model and the server's local timezone for all jobs), so `cron/jobs.yaml`'s `modelEnv`/`thinkingEnv`/`agentEnv`/`exactEnv`/`timezone`/`session` fields are still read (for schema continuity) but have no effect on the generated command. `delivery.channelEnv`/`delivery.toEnv` do have an effect — they're mapped into `--deliver <channel>:<to>`.

## Cron desired state

`cron/jobs.yaml` is the desired schedule and prompt-file mapping.

### Core evidence cadences

| Job                         | Cadence          | Responsibility                                                                                                |
| --------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `price-observations` (#104) | Every 5 minutes  | Build historical price density for `realized_volatility_1h`.                                                  |
| `core-evidence-pipeline`    | Every 30 minutes | Collect core observations, derive features, assemble evidence, generate briefs, and publish the exact bundle. |

The synthesis cadence is shorter than the one-hour core-feature validity boundary so scheduler drift, collection latency, bounded retries, and brief generation do not consume the entire freshness window. The five-minute sampler remains a separate job because historical telemetry density and expensive synthesis have different cadence and cost requirements.

Specifically, for five-minute sampling:

- The five-minute `price-observations` job supplies historical Pyth/Jupiter observation density while the 30-minute `collect:core` stage remains the fresh snapshot source for derivation/assembly.
- Ten healthy five-minute ticks require approximately 45-50 minutes after startup or prolonged downtime before `realized_volatility_1h` can satisfy coverage.
- A missing/delayed tick that creates a gap over ten minutes returns the feature to `UNAVAILABLE` with `insufficient_coverage` or `excessive_gap`, never fabricated zero volatility.
- Concurrent price collection near `xx:00`/`xx:30` is accepted but source rate-limit/command failures must remain visible to operators.

At the ungated MVP cadence, maximum brief attempts are `48 runs/day × configured position count`; two positions can therefore produce up to 96 attempts per day. Confirm the deployed LLM model, provider rate limits, and budget can sustain the configured position count before registration. Material-change gating and a slower brief-only cadence remain future work.

This repository change declares desired state only and does not register the job on Hermes (issue #96 remains the live-registration boundary).

## Registering / updating jobs

```bash
pnpm cron:render          # print the hermes cron create commands without running them
pnpm cron:sync -- --apply # actually create the jobs against Hermes
```

This only _adds_ jobs — it has no diff/delete logic, so re-running it against an already-synced gateway creates duplicate jobs. Remove stale ones first:

```bash
H="/root/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main"
$H cron list
$H cron rm <job-id>
```

For a one-off tweak to a single already-registered job without a full re-sync, edit it directly:

```bash
H="/root/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main"
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
