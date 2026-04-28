# OpenClaw Operator Notes

OpenClaw owns the scheduled runtime. This repo owns the desired logic.

## Cron desired state

`cron/jobs.yaml` is the desired schedule. Use:

```bash
pnpm cron:render
```

To print the OpenClaw CLI commands.

Use:

```bash
pnpm cron:sync -- --apply
```

To create the jobs through the OpenClaw CLI.

## Runtime assumptions

- Jobs should run in isolated sessions.
- Job prompts should be read from `routines/*.md`.
- Delivery should be handled by OpenClaw cron, not by the agent trying to send a separate message.
- Gateway must remain running.
- The configured timezone should be explicit.

## Operational checks

```bash
openclaw status
openclaw gateway status
openclaw cron status
openclaw cron list
openclaw logs --follow
```

## Failure rules

If a job fails due to missing data:

1. Do not invent a recommendation.
2. Write an output with `dataQuality = stale` or `partial`.
3. Recommend `hold` or `watch`.
4. Log the missing input.
