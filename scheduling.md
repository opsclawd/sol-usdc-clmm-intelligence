# Scheduling Operator Notes

Hermes owns the scheduled runtime today. This repo owns the desired logic (`cron/jobs.yaml`, `cron/routines/*.md`).

## Why Hermes, not OpenClaw

This repo's cron-generation tooling (`pnpm cron:render`, `pnpm cron:sync -- --apply`, `src/application/cron-command.ts`) was originally built against the OpenClaw CLI. As deployed, the OpenClaw gateway has no working model provider configured and cannot execute scheduled jobs. The actual scheduled runtime on the deployment VPS is **Hermes** (`hermes-agent`), a separate agent CLI running as its own systemd gateway service (`hermes-gateway.service`), configured with its own model/provider (MiniMax) entirely outside this repo's `.env`.

`cron-command.ts` now generates `hermes cron create` commands instead of `openclaw cron add` commands. `pnpm cron:sync -- --apply` is the recommended way to register/refresh jobs from `cron/jobs.yaml`/`cron/routines/*.md` — see below.

Hermes has no per-job model/thinking/agent override and no per-job timezone (it uses one gateway-wide model and the server's local timezone for all jobs), so `cron/jobs.yaml`'s `modelEnv`/`thinkingEnv`/`agentEnv`/`exactEnv`/`timezone`/`session` fields are still read (for schema continuity) but have no effect on the generated command. `delivery.channelEnv`/`delivery.toEnv` do have an effect — they're mapped into `--deliver <channel>:<to>`.

## Cron desired state

`cron/jobs.yaml` is the desired schedule and prompt-file mapping.

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
