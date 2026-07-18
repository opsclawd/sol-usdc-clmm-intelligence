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

## Database Operations

### Run migrations

```bash
pnpm db:migrate
```

### Generate new migration (after schema changes)

```bash
pnpm db:generate
```

### Push schema to DB (dev only, no migration file)

```bash
pnpm db:push
```

### Verify DB connection

```bash
tsx -e "import { createDb } from './src/db/db.js'; const { db, client } = createDb(process.env.DATABASE_URL); await db.execute({ sql: 'SELECT 1' }); console.log('OK'); await client.end();"
```

## Observation Pipeline Diagnosis

All SQL queries below are read-only. Do not manually mutate immutable raw evidence.

### Malformed rejection (no raw row)

If a bundle parse fails validation, no raw row is written. Check the collector log for field-path errors:

```sql
-- No rows expected; confirm no raw row was written for a rejected bundle
SELECT observedAtUnixMs, sourceKey, parseState
FROM intelligence.raw_observations
WHERE sourceKey = $1
ORDER BY observedAtUnixMs DESC
LIMIT 10;
```

### Conflict (fail closed)

Source identity collisions surface as conflicts. The pipeline fails closed — no normalized row is written:

```sql
-- Check for conflict state in normalized observations
SELECT observedAtUnixMs, sourceKey, status, parseState, version
FROM intelligence.normalized_observations
WHERE status = 'conflict'
ORDER BY observedAtUnixMs DESC
LIMIT 20;
```

### Failed/pending raw replay

A raw observation may remain in `pending` if normalization failed or was interrupted:

```sql
-- Find pending raw observations that may need replay
SELECT observedAtUnixMs, sourceKey, parseState, createdAt
FROM intelligence.raw_observations
WHERE parseState = 'pending'
ORDER BY observedAtUnixMs DESC
LIMIT 20;
```

### Batch rollback

If a normalized batch fails mid-commit, individual normalized rows remain in their pre-commit state. Check batch integrity:

```sql
-- Check normalized observations for batch integrity issues
SELECT observedAtUnixMs, sourceKey, status, parseState, batchId
FROM intelligence.normalized_observations
WHERE status = 'pending'
ORDER BY observedAtUnixMs DESC
LIMIT 20;
```

### Post-commit pending status

After a successful normalized commit, the raw row's `parseState` should be `complete`. A raw row stuck in `pending` after its normalized counterpart is `complete` indicates a post-commit update was missed:

```sql
-- Find raw rows stuck in pending after their normalized counterpart completed
SELECT r.observedAtUnixMs, r.sourceKey, r.parseState AS raw_parse_state,
       n.status AS normalized_status, n.parseState AS normalized_parse_state
FROM intelligence.raw_observations r
JOIN intelligence.normalized_observations n
  ON n.sourceKey = r.sourceKey AND n.observedAtUnixMs = r.observedAtUnixMs
WHERE r.parseState = 'pending' AND n.status = 'complete'
ORDER BY r.observedAtUnixMs DESC
LIMIT 20;
```

### Latest-file repair

The compatibility artifact at `data/latest-clmm-bundle.json` may lag after a replay. Repair by re-running the collector:

```bash
pnpm collect:clmm-bundle
```

This re-fetches from clmm-v2 and writes a fresh compatibility artifact. The DB remains authoritative; the file is only a compatibility fallback.

### Guaranteed connection close

All adapter operations use try/finally to ensure connections close even on error. If a connection leak is suspected:

```sql
-- Check for unclosed connections (requires pg_stat_activity view)
SELECT pid, state, query_start, query
FROM pg_stat_activity
WHERE datname = current_database()
  AND state = 'active'
  AND query LIKE '%intelligence.%';
```

### Diagnosing by source key

To find observations for a specific wallet/pool:

```sql
SELECT observedAtUnixMs, sourceKey, sourceHash, parseState, createdAt
FROM intelligence.raw_observations
WHERE sourceKey = $1
ORDER BY observedAtUnixMs DESC
LIMIT 10;
```

### Diagnosing by source hash

To check for duplicate source content:

```sql
SELECT sourceHash, COUNT(*) AS cnt, MIN(observedAtUnixMs), MAX(observedAtUnixMs)
FROM intelligence.raw_observations
WHERE sourceHash IS NOT NULL
GROUP BY sourceHash
HAVING COUNT(*) > 1;
```

### Diagnosing by parse state

To get a count of observations by parse state:

```sql
SELECT parseState, COUNT(*) AS cnt, MIN(observedAtUnixMs), MAX(observedAtUnixMs)
FROM intelligence.raw_observations
GROUP BY parseState;
```
