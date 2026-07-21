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

## MVP Feature Derivation (`pnpm derive:mvp`)

The `pnpm derive:mvp` command derives the seven canonical deterministic features for explicit pool/position pairs. It is a pure function: identical inputs produce bit-for-bit identical outputs.

### Required environment variables

```bash
# Whirlpool address for the SOL/USDC pool
WHIRLPOOL_ADDRESS=HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw

# Comma-separated list of position IDs to derive features for
INTELLIGENCE_POSITION_IDS=Pos11111111111111111111111111111111111111111,Pos22222222222222222222222222222222222222222

# Version string for this code deployment (fallback: "development")
INTELLIGENCE_CODE_VERSION=abc1234
```

> [!STOP]
> **Migration precondition:** The migration that introduces `derived_features` constraints assumes `intelligence.derived_features` is empty. If any row exists, the migration aborts. Do not rewrite or delete existing rows without lead engineer approval.

### Pre-flight checks

Before running derivation, verify the database is ready:

```sql
-- Verify no existing derived feature rows (migration precondition)
SELECT COUNT(*) AS derived_feature_count FROM intelligence.derived_features;
-- If count > 0, abort and consult lead engineer

-- Verify source observations are present
SELECT source, observation_kind, COUNT(*) AS cnt
FROM intelligence.normalized_observations
GROUP BY source, observation_kind;
```

### Example invocation

```bash
pnpm derive:mvp
```

**Successful response example:**

```json
{
  "counts": {
    "AVAILABLE": 7,
    "PARTIAL": 0,
    "UNAVAILABLE": 0
  },
  "warnings": []
}
```

This indicates all seven canonical features were derived with `AVAILABLE` status.

**Unavailable response example:**

```json
{
  "counts": {
    "AVAILABLE": 4,
    "PARTIAL": 1,
    "UNAVAILABLE": 2
  },
  "warnings": [
    "oracle_dex_divergence: missing_oracle",
    "realized_volatility_1h: insufficient_coverage"
  ]
}
```

Unavailable features are persisted with `status: "UNAVAILABLE"` and explicit reason codes. They are stored as evidence but are **not numeric publication candidates** — they cannot be used as-is in regime-engine synthesis without further handling.

### Output artifacts

Each derived feature row is stored in `intelligence.derived_features` with:

- `feature_kind`: one of the seven canonical kinds
- `status`: `AVAILABLE`, `PARTIAL`, or `UNAVAILABLE`
- `value`: integer (PPM or BPS) when `AVAILABLE` or `PARTIAL`, null when `UNAVAILABLE`
- `derivation_key`: canonical hash of input identity (scope + reasons + versions)
- `input_observation_ids`: sorted array of source observation IDs used
- `rejected_observation_ids`: sorted array of observations rejected during selection

### Replay behavior

The system uses `derivation_key` as a idempotency key. Re-running derivation with identical inputs produces a replay result with the same `derivation_key` — no duplicate rows are created. The transaction conflict recovery preserves caller order.

## Evidence Bundle Assembly (`pnpm assemble:bundle`)

The `assemble:bundle` command assembles deterministic evidence bundles from derived features and observations. It is a pure function: identical inputs produce bit-for-bit identical outputs.

### Required Request File

The script accepts one argument: a path to a JSON request file.

```bash
pnpm assemble:bundle data/assembly-request.json
```

### Request File Format

```json
{
  "pair": "SOL/USDC",
  "poolId": "HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw",
  "positionId": "Pos11111111111111111111111111111111111111111",
  "walletId": "Wallet1234567890abcdef",
  "pipelineRunId": "run-456",
  "correlationId": "corr-789",
  "evaluationTimeUnixMs": 1700000000000,
  "createdAtUnixMs": 1700000000000,
  "acceptedCalculatorVersions": {
    "range_location": "range-location/v1",
    "distance_to_lower": "distance-to-lower/v1",
    "distance_to_upper": "distance-to-upper/v1",
    "oracle_dex_divergence": "oracle-dex-divergence/v1",
    "oracle_confidence_width": "oracle-confidence-width/v1",
    "realized_volatility_1h": "realized-volatility-1h/v1",
    "volume_liquidity_ratio_24h": "volume-liquidity-ratio-24h/v1"
  },
  "schemaVersion": "evidence-bundle.v1",
  "assemblySelectionVersion": "selection/v1",
  "codeVersion": "1.0.0",
  "gitCommit": "abc123def456",
  "environment": "test"
}
```

### Successful Response Example

```json
{
  "outcome": "persisted",
  "rowId": 99,
  "payloadHash": "hash-abc",
  "slotCount": 7,
  "warnings": []
}
```

### Identical Replay Response

```json
{
  "outcome": "identical_replay",
  "rowId": 42,
  "payloadHash": "identical-hash",
  "slotCount": 7,
  "warnings": []
}
```

### Conflict Response (Exit Code 1)

```json
{
  "outcome": "conflict",
  "rowId": 1,
  "incomingPayloadHash": "new-different-hash",
  "warnings": []
}
```

### Pre-flight Checks

Before running assembly, verify:

```sql
-- Verify no existing evidence bundle rows (migration precondition)
SELECT COUNT(*) AS bundle_count FROM intelligence.evidence_bundles;
-- If count > 0, abort and consult lead engineer

-- Verify derived features are present
SELECT feature_kind, COUNT(*) AS cnt
FROM intelligence.derived_features
GROUP BY feature_kind;
```

### Seven-Slot Selection

The assembler selects up to seven canonical feature slots:

| Slot                       | Kind             | Unit |
| -------------------------- | ---------------- | ---- |
| range_location             | pool + position  | PPM  |
| distance_to_lower          | pool + position  | BPS  |
| distance_to_upper          | pool + position  | BPS  |
| oracle_dex_divergence      | pool-independent | BPS  |
| oracle_confidence_width    | pool-independent | BPS  |
| realized_volatility_1h     | pool-independent | BPS  |
| volume_liquidity_ratio_24h | pool only        | PPM  |

### Exit Codes

- **0:** Success (persisted or identical_replay)
- **1:** Failure (conflict, validation error, malformed request, database error)

### Replay Behavior

The idempotency key is derived from request identity fields. Re-running with identical inputs produces `identical_replay` with the same `rowId` and `payloadHash`. The system permits identical replay — no new row is created.

### Redacted Output

The script never outputs:

- Wallet ID
- Canonical payload
- Full provenance details

Only operational summary fields are printed: outcome, row ID, payload hash, slot count, and warnings.

### Migration Precondition

> [!STOP]
> **Migration precondition:** The migration that introduces `evidence_bundles` constraints assumes the table is empty. If any row exists, the migration aborts. Do not rewrite or delete existing rows without lead engineer approval.

## Publish-attempt persistence

All SQL queries below are read-only. Do not manually mutate immutable publish-attempt audit rows.

### Inspect attempts by target and idempotency key

```sql
SELECT target, idempotency_key, attempt_number, status, http_status, received_at_unix_ms
FROM intelligence.publish_attempts
WHERE target = '<target>' AND idempotency_key = '<idempotency-key>'
ORDER BY attempt_number ASC, id ASC;
```

### Volume summary by status since timestamp

```sql
SELECT status, COUNT(*) AS attempts
FROM intelligence.publish_attempts
WHERE received_at_unix_ms >= <since-unix-ms>
GROUP BY status
ORDER BY status;
```

### Diagnostic: temporarily unresolved logical references

```sql
SELECT pa.id, pa.evidence_bundle_id, pa.research_brief_id
FROM intelligence.publish_attempts AS pa
LEFT JOIN intelligence.evidence_bundles AS eb ON eb.id = pa.evidence_bundle_id
LEFT JOIN intelligence.research_briefs AS rb ON rb.id = pa.research_brief_id
WHERE eb.id IS NULL OR (pa.research_brief_id IS NOT NULL AND rb.id IS NULL);
```

This query is diagnostic, not proof of corruption: logical references may be temporarily unresolved during out-of-order replay. Do not add foreign keys, cascades, repair updates, or deletes to resolve these. To retry a failed attempt, append a new row with a higher `attempt_number` for the same `(target, idempotency_key)` pair.

### Normal migration command

```bash
pnpm db:migrate
```

Do not execute migrations or any write/delete SQL against shared infrastructure without explicit operator authorization.
