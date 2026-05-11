# Operator Runbook

## First run

```bash
pnpm install
cp .env.example .env
pnpm typecheck
pnpm collect:price
pnpm collect:clmm-bundle
```

If `pnpm collect:clmm-bundle` fails, your clmm-v2 insight endpoint is not ready, `CLMM_DATA_API_BASE` is wrong, or `CLMM_INSIGHTS_API_KEY` is missing.

## Register OpenClaw jobs

```bash
pnpm cron:render
pnpm cron:sync -- --apply
openclaw cron list
```

### Migrating from legacy collector (first time only)

If you had the old `cron/jobs.yaml` registered, four legacy jobs may still be active:

```bash
openclaw cron remove --name clmm-daily-sol-usdc-insight
openclaw cron remove --name clmm-range-review
openclaw cron remove --name clmm-emergency-volatility-check
openclaw cron remove --name clmm-weekly-performance-review
```

These jobs reference deleted scripts (`pnpm collect:backend`, `pnpm insight:daily`, `pnpm review:range`) and will fail harmlessly but noisily until removed. Verify cleanup:

```bash
openclaw cron list
```

## Test a job

```bash
openclaw cron list
openclaw cron run <jobId>
openclaw cron runs --id <jobId> --limit 20
```

## Failure modes

### Cron not firing

Check:

```bash
openclaw gateway status
openclaw cron status
openclaw cron list
```

### Cron fired but no message arrived

Check delivery config:

```bash
OPENCLAW_DELIVERY_CHANNEL
OPENCLAW_DELIVERY_TO
```

### Missing data

Correct behavior is conservative:

- hold
- watch
- pause_rebalances
- low confidence
- partial/stale data quality

If the agent invents missing data, tighten `AGENTS.md`, the routine prompt, or the relevant schema.
