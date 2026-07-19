# Operator Runbook

## First run

```bash
pnpm install
cp .env.example .env
pnpm typecheck
pnpm collect:core
```

If `pnpm collect:core` fails, check the configuration or credentials of the failing core sources. Legacy standalone commands (`pnpm collect:price` and `pnpm collect:clmm-bundle`) remain supported.

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

## Configuration & Credentials

Durable core telemetry collection requires the following credentials and environment variables to be configured in `.env` (configured via `.env.example` as a template):

- `CLMM_DATA_API_BASE`: Base URL for `clmm-v2` backend (default `http://localhost:3001`).
- `CLMM_INSIGHTS_API_KEY`: API key for backend access.
- `WALLET_PUBLIC_KEY`: Solana wallet public key under observation.
- `PYTH_HERMES_BASE_URL`: Base URL for the Pyth Hermes API (defaults to `https://hermes.pyth.network`).
- `PYTH_API_KEY`: API Key for Pyth Hermes. Optional for local development/low-frequency runs, but required in production.
- `PYTH_SOL_USD_FEED_ID`: The price feed ID for SOL/USD (canonical feed ID `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`).
- `JUPITER_API_BASE`: Base URL for Jupiter's quote API (defaults to `https://api.jup.ag`).
- `JUPITER_API_KEY`: Optional Jupiter API Key for high-frequency or production rate-limit environments.
- `ORCA_API_BASE`: Base URL for Orca's public statistics API (defaults to `https://api.orca.so/v2/solana`).
- `ORCA_SOL_USDC_WHIRLPOOL` / `WHIRLPOOL_ADDRESS`: The Orca whirlpool pool address (e.g. `HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw`).

Ensure no actual credentials, keys, or authorization tokens are logged. The CLI automatically redacts headers and keys.

## Core Collector Exit Behavior

When running `pnpm collect:core` or `runCoreCollectionJob` via scheduling:

1. **Complete Success (COMPLETE, Exit Code: 0)**: All core sources (CLMM, Pyth, Jupiter, Orca) collected, normalized, and persisted successfully (or replayed identically).
2. **Partial Success (PARTIAL, Exit Code: 0)**: At least one source succeeded yielding a usable observation, but some other sources failed or degraded. Structured warnings are output, but no rollback of already committed sibling evidence occurs.
3. **Unavailable (UNAVAILABLE, Exit Code: 1)**: All sources are unavailable (e.g. rate-limiting HTTP 429s, API timeouts, or service outages).
4. **Failure (FAILED, Exit Code: 1)**: Total failure with zero usable evidence, or any database uniqueness/identity conflict (replay conflict). The pipeline fails closed to protect data integrity.

### 429/Outage Troubleshooting

1. Check endpoint rate-limits (unauthenticated endpoints like Jupiter and Orca may return 429). Configure `JUPITER_API_KEY` or wait for the rate limit window to reset.
2. Confirm Pyth Hermes endpoint status and check if subscription credentials/API key are required.
3. Check `clmm-v2` status and verify BFF API keys are correct.

## Pre-deployment Preflight Checks

Before deploying any schema migrations or running taxonomy updates, check if there are any historical `price_quote` rows in the database:

```sql
SELECT COUNT(*) AS price_quote_count
FROM intelligence.normalized_observations
WHERE observation_kind = 'price_quote';
```

> [!STOP]
> If `price_quote_count > 0`, abort deployment immediately. Check with the lead engineer regarding compatibility/migration policies. Do not rewrite history or overwrite kinds without approval.

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

If a provider payload fails validation or structure parsing, no raw row is written. Check the collector log for network or payload schema errors. You can inspect recently fetched raw records:

```sql
SELECT received_at_unix_ms, source, parse_status, payload_hash
FROM intelligence.raw_observations
WHERE source IN ('pyth-hermes', 'jupiter-quote')
ORDER BY received_at_unix_ms DESC
LIMIT 10;
```

### Uniqueness Conflict (fail closed)

Source identity/hash collisions surface as conflicts. The pipeline fails closed — no normalized row is written:

```sql
-- Check for conflict status on raw or normalized observation boundaries
SELECT raw_observation_id, source, observation_kind, payload_hash, confidence_level
FROM intelligence.normalized_observations
WHERE payload_hash = $1;
```

### Failed/pending raw replay

A raw observation remains in `pending` if normalization failed, was interrupted, or didn't proceed:

```sql
-- Find pending raw observations that may need replay
SELECT observed_at_unix_ms, source, source_observation_key, parse_status
FROM intelligence.raw_observations
WHERE parse_status = 'pending'
ORDER BY observed_at_unix_ms DESC
LIMIT 20;
```

### Post-commit pending status

After a successful normalized commit, the raw row's `parse_status` should be updated to `parsed`. A raw row stuck in `pending` after its normalized counterpart is complete indicates a post-commit update failed:

```sql
-- Find raw rows stuck in pending after their normalized counterpart completed
SELECT r.observed_at_unix_ms, r.source, r.parse_status AS raw_parse_status,
       n.id AS normalized_id, n.is_stale
FROM intelligence.raw_observations r
JOIN intelligence.normalized_observations n ON n.raw_observation_id = r.id
WHERE r.parse_status = 'pending'
ORDER BY r.observed_at_unix_ms DESC
LIMIT 20;
```

### Freshness and Staleness Queries

Check the status of observations to see which are currently marked as stale or within their freshness validity windows:

```sql
-- Check for stale vs fresh observations by source and kind
SELECT source, observation_kind, is_stale, COUNT(*) AS cnt
FROM intelligence.normalized_observations
GROUP BY source, observation_kind, is_stale;

-- Retrieve fresh observations only
SELECT id, source, observation_kind, valid_until_unix_ms, received_at_unix_ms
FROM intelligence.normalized_observations
WHERE is_stale = false
ORDER BY received_at_unix_ms DESC
LIMIT 10;
```

### Latest-file repair

The compatibility artifact at `data/latest-price-snapshot.json` or `data/latest-clmm-bundle.json` may lag after a replay. Repair by re-running the collector:

```bash
pnpm collect:price
pnpm collect:clmm-bundle
```

The DB remains the source of authority; local JSON files are compatibility fallbacks only.

### Guaranteed connection close

All adapter operations use try/finally to ensure connections close even on error. If a connection leak is suspected:

```sql
-- Check for active backend queries/connections (requires pg_stat_activity view)
SELECT pid, state, query_start, query
FROM pg_stat_activity
WHERE datname = current_database()
  AND state = 'active'
  AND query LIKE '%intelligence.%';
```

### Diagnosing by source key

To find observations for a specific source key:

```sql
SELECT observed_at_unix_ms, source, source_observation_key, payload_hash, parse_status
FROM intelligence.raw_observations
WHERE source_observation_key = $1
ORDER BY observed_at_unix_ms DESC
LIMIT 10;
```

### Diagnosing by payload hash

To check for duplicate source content:

```sql
SELECT payload_hash, COUNT(*) AS cnt, MIN(observed_at_unix_ms) AS first_observed, MAX(observed_at_unix_ms) AS last_observed
FROM intelligence.raw_observations
GROUP BY payload_hash
HAVING COUNT(*) > 1;
```

### Diagnosing by parse status

To get a count of observations by parse status:

```sql
SELECT parse_status, COUNT(*) AS cnt, MIN(observed_at_unix_ms), MAX(observed_at_unix_ms)
FROM intelligence.raw_observations
GROUP BY parse_status;
```
