# Scheduling Operator Notes

Hermes owns the scheduled runtime today. This repo owns the desired logic (`cron/jobs.yaml`, `cron/routines/*.md`).

## Why Hermes, not OpenClaw

This repo's cron-generation tooling (`pnpm cron:render`, `pnpm cron:sync -- --apply`, `src/application/cron-command.ts`) was originally built against the OpenClaw CLI. As deployed, the OpenClaw gateway has no working model provider configured and cannot execute scheduled jobs. The actual scheduled runtime on the deployment VPS is **Hermes** (`hermes-agent`), a separate agent CLI running as its own systemd gateway service (`hermes-gateway.service`), configured with its own model/provider (MiniMax) entirely outside this repo's `.env`.

The `cron:render`/`cron:sync` tooling and `cron/jobs.yaml`'s field names (`modelEnv: OPENCLAW_MODEL`, etc.) still target OpenClaw's CLI syntax and are **not currently used** to register the real jobs. Jobs are registered directly against Hermes using its own CLI, with schedule/prompt content still sourced from `cron/jobs.yaml` and `cron/routines/*.md` by hand. There is no automated sync between this repo's desired-state files and the live Hermes job list — if you change a schedule or routine prompt here, you must manually re-apply it to Hermes (see below).

## Cron desired state

`cron/jobs.yaml` is still the desired schedule and prompt-file mapping, read manually rather than via `cron:sync`.

## Registering / updating a job on Hermes

From the Hermes install directory on the target host:

```bash
H="/root/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main"

# create
$H cron create "<cron-expr>" "<prompt text>" --name <job-name> --deliver local

# update an existing job's prompt/schedule
$H cron edit <job-id> --prompt "<new prompt text>" --schedule "<new cron-expr>"
```

Prompt text should be the corresponding `cron/routines/<name>.md` content, prefixed with an explicit working-directory instruction (Hermes's terminal backend does not default into this repo's checkout):

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
