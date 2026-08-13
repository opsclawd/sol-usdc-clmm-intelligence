# Operator Runbook

## First run

```bash
pnpm install
cp .env.example .env
pnpm typecheck
pnpm collect:core
```

If `pnpm collect:core` fails, check the configuration or credentials of the failing core sources. Legacy standalone commands (`pnpm collect:price` and `pnpm collect:clmm-bundle`) remain supported.

## Deploy live updates

On the production VPS, run the checked-in deployment entrypoint from the repository checkout:

```bash
pnpm deploy:live
```

Use `pnpm deploy:live` for routine production updates instead of a bare `git pull`. It runs the required stages in order:

1. `git pull --ff-only` fast-forwards the current branch from its configured upstream.
2. `pnpm install --frozen-lockfile` installs the lockfile-pinned dependency set.
3. `pnpm db:migrate` applies pending database migrations.
4. `pnpm cron:sync -- --apply` reconciles `cron/jobs.yaml` and its routine prompts into Hermes.

The command is fail-fast. A failed stage prevents every later stage from starting, but successful earlier stages are not rolled back. In particular, a migration may already be applied before cron reconciliation fails, and Hermes may accept some job edits before a later edit fails.

On failure, read the failing command's output, correct the checkout or host configuration, and rerun `pnpm deploy:live`. After a successful run, use the Hermes inspection commands under **Test a job** to confirm the expected jobs and recent runs. Do not manually reverse an applied migration or recreate all Hermes jobs as a recovery shortcut.

## Register scheduled jobs

The scheduled runtime is **Hermes**, not OpenClaw — see `scheduling.md` for the full explanation. `pnpm cron:render` prints create-command rendering without inspecting current Hermes state. `pnpm cron:sync -- --apply` reconciles desired jobs from `cron/jobs.yaml`/`cron/routines/*.md` against the host Hermes store:

```bash
pnpm cron:render          # print the hermes cron create commands without running them
pnpm cron:sync -- --apply # reconcile jobs against host Hermes store (create or edit)
```

Repeated runs of `pnpm cron:sync -- --apply` operate as **create-or-edit** by exact job name:

- Reads the host job store from `HERMES_JOBS_FILE_PATH` (or `$HOME/.hermes/cron/jobs.json` if unset; must be an absolute path on the host).
- Unique exact name matches are updated via `hermes cron edit <id> ...`.
- Missing job names are created via `hermes cron create ...`.
- Extra jobs present only in Hermes are preserved (no automatic deletion).
- An unreadable, missing, or malformed store acts as a fail-closed safety stop, preventing command execution (it is NOT permission to recreate every job).
- If the persisted store already contains duplicate job names for a configured job, `cron:sync` aborts and requires manual inspection and cleanup (`hermes cron rm <job-id>`).

Before registering scheduled jobs:

- Confirm `pnpm run:core-evidence-pipeline` is present before registration.
- Deploy both the five-minute #104 telemetry schedule (`price-observations`) and the 4-hour synthesis schedule (`core-evidence-pipeline`) before declaring the seven-feature pipeline scheduling-complete.
- Calculate the brief-attempt ceiling with `6 × configured position count` (e.g. two positions produce up to 12 daily attempts) and verify deployed model, provider rate-limit, and budget assumptions.
- Treat a synthesis duration approaching 4 hours as an overlap/capacity warning, without adding scheduler retry or concurrency policy.

Use `pnpm cron:render` to inspect and verify job generation without creating jobs on Hermes.

If migrating from an old OpenClaw-registered deployment, any legacy jobs live in OpenClaw's own job store and are unrelated to Hermes's — they do not need to be ported, since scheduling was rebuilt on Hermes from a clean slate.

## Test a job

```bash
H="/root/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main"
$H cron list
$H cron run <job-id>
$H cron runs --id <job-id> --limit 20
```

## Configuration & Credentials

Durable core telemetry collection requires the following credentials and environment variables to be configured in `.env` (configured via `.env.example` as a template):

- `CLMM_DATA_API_BASE`: Base URL for `clmm-v2` backend (default `http://localhost:3001`).
- `CLMM_INSIGHTS_API_KEY`: API key for backend access.
- `WALLET_PUBLIC_KEY`: Solana wallet public key under observation.
- `PYTH_HERMES_BASE_URL`: Base URL for the Pyth Hermes API (defaults to `https://hermes.pyth.network`).
- `PYTH_API_KEY`: API Key for Pyth Hermes. Optional for local development/low-frequency runs, but required in production.
- `PYTH_SOL_USD_FEED_ID`: The price feed ID for SOL/USD (canonical feed ID `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`).
- `JUPITER_API_BASE`: Base URL for Jupiter's quote API (defaults to `https://lite-api.jup.ag/swap/v1`). Existing deployments must update their local environment value; `.env.example` does not rewrite an existing `.env`.
- `JUPITER_API_KEY`: Optional Jupiter API Key for high-frequency or production rate-limit environments.
- `ORCA_API_BASE`: Base URL for Orca's public statistics API (defaults to `https://api.orca.so/v2/solana`).
- `WHIRLPOOL_ADDRESS`: The authoritative Orca SOL/USDC Whirlpool address used by pool statistics, MVP derivation, and on-chain flow (for example, `Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE`). Existing deployments must add this value to the Hermes on-chain-flow job before or concurrently with rollout; `.env.example` does not rewrite an existing environment.
- `SOLANA_RPC_URL`: Base URL for Solana RPC endpoint (defaults to `https://api.mainnet-beta.solana.com`).
- `SOLANA_RPC_API_KEY`: Optional API Key or auth query parameter for hosted Solana RPC endpoints.
- `BINANCE_FAPI_BASE_URL`: Base URL for Binance Futures public API (defaults to `https://fapi.binance.com`).
- `BINANCE_SOL_PERP_SYMBOL`: SOL perpetual symbol for Binance Futures (e.g., `SOLUSDT`). Required; collector fails closed if missing.
- `DRIFT_DATA_API_BASE_URL`: Base URL for Velocity Exchange Data API (`drift-api`). Required; collector fails closed if missing.
- `DRIFT_SOL_PERP_SYMBOL`: SOL perpetual symbol for Drift/Velocity (e.g., `SOL-PERP`). Required; collector fails closed if missing.
- `DRIFT_SOL_PERP_MARKET_INDEX`: Market index for SOL perpetual on Drift/Velocity (e.g., `0`). Required integer; collector fails closed if missing or non-integer.
- `DRIFT_PRICE_PRECISION`: Drift price precision scaling exponent factor (defaults to `1000000` / 10^6).
- `DRIFT_BASE_PRECISION`: Drift base precision scaling exponent factor (defaults to `1000000000` / 10^9).
- `DRIFT_QUOTE_PRECISION`: Drift quote precision scaling exponent factor (defaults to `1000000` / 10^6).
- `PERP_LIQUIDATION_LOOKBACK_MS`: Lookback window in milliseconds for perp and liquidation collection (defaults to `14400000` / 4 hours minimum). Must be an integer >= 14,400,000 to cover the `oi_trend_4h` window; collector fails closed if less than 14,400,000.
- `HERMES_JOBS_FILE_PATH`: Absolute path on the host running `cron:sync` to Hermes's job store JSON file (defaults to `$HOME/.hermes/cron/jobs.json` if omitted). Do not use `~` because `FsTextReader` does not expand tilde. Missing, malformed, or duplicate-name store files cause `cron:sync` to abort reconciliation before executing any CLI commands.

> [!WARNING]
> This release removes the on-chain-flow fallback name. Confirm the live Hermes job exposes `WHIRLPOOL_ADDRESS` before deploying the updated collector; otherwise the command intentionally exits before external collection or persistence.

Ensure no actual credentials, keys, or authorization tokens are logged. The CLI automatically redacts headers, URL credentials, and API keys. Note that `SOLANA_RPC_URL` measures only the configured RPC endpoint's health and slot rather than global Solana consensus.

## Core Collector Exit Behavior

When running `pnpm collect:core` or `runCoreCollectionJob` via scheduling:

1. **Complete Success (COMPLETE, Exit Code: 0)**: All five core sources (CLMM, Pyth, Jupiter, Orca, Solana RPC) collected, normalized, and persisted successfully (or replayed identically). Requires five fresh usable outcomes.
2. **Partial Success (PARTIAL, Exit Code: 0)**: At least one source succeeded yielding a usable observation, but some other sources failed or degraded (e.g. a Solana-only outage producing `PARTIAL` when the other four are usable). Structured warnings are output, but no rollback of already committed sibling evidence occurs.
3. **Unavailable (UNAVAILABLE, Exit Code: 1)**: All five sources are unavailable (e.g. rate-limiting HTTP 429s, API timeouts, or service outages).
4. **Failure (FAILED, Exit Code: 1)**: Total failure with zero usable evidence, or any database uniqueness/identity conflict (replay conflict). The pipeline fails closed to protect data integrity.

### 429/Outage Troubleshooting

1. Check endpoint rate-limits (unauthenticated endpoints like Jupiter and Orca may return 429). Configure `JUPITER_API_KEY` or wait for the rate limit window to reset.
2. Confirm Pyth Hermes endpoint status and check if subscription credentials/API key are required.
3. Check `clmm-v2` status and verify BFF API keys are correct.
4. **Solana RPC Troubleshooting**:
   - **Timeout / HTTP 408 / Network Error**: Verify connectivity to `SOLANA_RPC_URL`. Ensure timeout policy (5,000 ms, 2 max attempts) is respected.
   - **HTTP 429 (Too Many Requests)**: Rate-limiting encountered. Configure `SOLANA_RPC_API_KEY` or switch to an authenticated RPC endpoint URL.
   - **HTTP 5xx (Server Error)**: RPC node service disruption. The leaf-local retry will attempt twice before failing open into `PARTIAL` status (if other core sources succeed).
   - **Malformed JSON-RPC Batch**: Ensure the endpoint supports standard JSON-RPC 2.0 batching for `getHealth` and `getSlot`. Raw 2xx responses are persisted before normalization; malformed batches map to unparseable warnings.
   - **JSON-RPC Error Code -32005 (Node Unhealthy / Slot Unavailable)**: The node returned an internal RPC node error or health warning. The leaf produces a degraded observation with `node_behind` or `slot_unavailable` warning flags.

Note: Contextual protocol incidents from `solana-status-api` remain documented separately under research evidence so operators do not confuse qualitative protocol incidents with live RPC node health probes.

## Support Resistance Collector Exit Behavior

When running `pnpm collect:support-resistance` or `runSupportResistanceJob` via scheduling:

1. **Accepted (Exit Code: 0)**: Support/resistance levels collected, normalized, and persisted successfully (or replayed identically).
2. **Identical Replay (Exit Code: 0)**: Same payload detected; no new rows created.
3. **Stale (Exit Code: 0)**: Evidence has expired but raw data retained for contextual purposes.
4. **Degraded (Exit Code: 0)**: Evidence has warnings (e.g., duplicate equivalent claims, missing/malformed levels). Raw evidence retained but no usable level fabricated.
5. **Malformed (Exit Code: 1)**: Provider payload failed validation or structure parsing. No raw row written.
6. **Timeout (Exit Code: 1)**: Request timed out.
7. **Network (Exit Code: 1)**: Network error occurred.
8. **Unavailable (Exit Code: 1)**: Service unavailable (e.g., HTTP 429, 404, 5xx).
9. **Failed (Exit Code: 1)**: Normalization or persistence failure with zero usable evidence.
10. **Conflict (Exit Code: 1)**: Database uniqueness/identity conflict; pipeline fails closed.

**Missing or expired levels** are retained in bounded raw evidence and surfaced as degraded warnings, but **never become execution authority**.

### Support Resistance API Configuration

Required environment variables:

- `SUPPORT_RESISTANCE_API_URL`: Base URL for the technical analysis API provider.
- `SUPPORT_RESISTANCE_API_KEY`: Optional API key for authenticated endpoints.

The collector reads `SUPPORT_RESISTANCE_API_URL` and optional `SUPPORT_RESISTANCE_API_KEY` from environment. API credentials are redacted from all output, diagnostics, and persisted metadata.

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

Check the Hermes gateway and cron scheduler (not OpenClaw — see `scheduling.md`):

```bash
systemctl --user status hermes-gateway.service
H="/root/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main"
$H cron status
$H cron list
```

If a job's `Next run` never advances and it silently flips to `[inactive]`/`completed` after firing once, the gateway process likely started before `croniter` was installed in its venv — see `scheduling.md`'s note on this and restart the gateway service after installing it.

### Cron fired but no message arrived

Check the job's `--deliver` target (`hermes cron list` shows it per job). `OPENCLAW_DELIVERY_CHANNEL`/`OPENCLAW_DELIVERY_TO` are consumed by `pnpm cron:sync` at registration time (mapped into `--deliver <channel>:<to>`). Re-running `pnpm cron:sync -- --apply` updates matching jobs via `hermes cron edit <id> --deliver <target>`, or operators can edit a single job directly with `hermes cron edit <job-id> --deliver <target>`.

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
WHIRLPOOL_ADDRESS=Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE

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

## Evidence Bundle Assembly

There is no standalone assembly command. Evidence bundle assembly (both the per-position and
the pair bundle) runs only inside `pnpm run:core-evidence-pipeline`, as one stage of a single
in-process run: `collect -> derive -> prepare -> generate/reuse brief -> finalize -> persist
brief link -> publish`. The two-phase `prepare`/`finalize` split lets the pipeline generate (or
reuse) a research brief between assembling the bundle and persisting it, so a bundle is never
finalized without an attached brief outcome.

```bash
pnpm run:core-evidence-pipeline
```

### Configuration

Required environment variables (see `.env.example`):

- `INTELLIGENCE_POSITION_IDS`: comma-separated (or JSON array) list of position IDs to run the
  per-position pipeline for.
- `WHIRLPOOL_ADDRESS`: the SOL/USDC pool address used for both the pair bundle and every
  position bundle.
- `WALLET_PUBLIC_KEY`: wallet address attached to position-scoped bundles.
- `INTELLIGENCE_CODE_VERSION`: code version stamped into bundle provenance.
- `INTELLIGENCE_GIT_COMMIT`: 64-character lowercase hex git commit stamped into bundle
  provenance.
- `INTELLIGENCE_ENVIRONMENT`: one of `production`, `staging`, `development`, `test`.
- `DATABASE_URL`, `REGIME_ENGINE_BASE_URL`, `REGIME_ENGINE_AUTH_TOKEN`, and the LLM provider
  credentials required by `generate:brief` (see that section) — the pipeline drives collection,
  derivation, assembly, brief generation, and publishing in one run, so it needs every
  downstream stage's credentials up front.

If any required variable is missing or malformed, the command fails closed before touching the
database: it prints a single-line JSON result with `status: "failed"` and a
`diagnostics[0].code: "CONFIG_INVALID"` entry, and exits `1`. No lock is acquired and no bundle
is assembled.

### Result Shape

The command prints one redacted JSON object to stdout — never wallet IDs, canonical payloads,
or full provenance:

```json
{
  "pipelineRunId": "run-...",
  "collectionStartedAtUnixMs": 1700000000000,
  "evaluationTimeUnixMs": 1700000000000,
  "collectionStatus": "complete",
  "pair": {
    "correlationId": "corr-...",
    "bundleId": 99,
    "assemblyOutcome": "persisted",
    "briefOutcome": "generated",
    "publishOutcome": "created",
    "status": "complete",
    "warnings": [],
    "diagnostic": null
  },
  "positions": [
    {
      "positionId": "Pos1...",
      "correlationId": "corr-...",
      "bundleId": 101,
      "assemblyOutcome": "persisted",
      "briefOutcome": "generated",
      "publishOutcome": "created",
      "status": "complete",
      "warnings": [],
      "diagnostic": null
    }
  ],
  "status": "complete",
  "warnings": [],
  "diagnostics": [],
  "cleanupErrors": []
}
```

`assemblyOutcome` reflects the `prepare`/`finalize` result (`persisted`, `identical_replay`,
`conflict`, `no_bundle`, or an error code) for the pair and for each position independently.
`briefOutcome` is `generated`, `reused` (an eligible persisted brief already existed for an
`identical_replay` bundle and was reused instead of re-calling the LLM), `degraded`, or `null`
when no brief attempt applies. `status` (top-level and per-pair/position) is one of `complete`,
`degraded`, `skipped_already_running`, or `failed`.

Deterministic orchestration must inspect these typed fields, not the process exit code, to
decide what happened to each bundle. The process exit code (`0` for `complete`/`degraded`/
`skipped_already_running`, `1` otherwise) exists only to drive cron/Hermes alerting.

### Pre-flight Checks

Before the first run, verify:

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

| Slot                       | Kind             | Unit         |
| -------------------------- | ---------------- | ------------ |
| range_location             | pool + position  | percent ×100 |
| distance_to_lower          | pool + position  | percent ×100 |
| distance_to_upper          | pool + position  | percent ×100 |
| oracle_dex_divergence      | pool-independent | BPS          |
| oracle_confidence_width    | pool-independent | BPS          |
| realized_volatility_1h     | pool-independent | BPS          |
| volume_liquidity_ratio_24h | pool only        | percent ×100 |

### Replay Behavior

The idempotency key is derived from request identity fields. Re-running with identical inputs
produces `identical_replay` with the same `bundleId` and payload hash — no new row is created.
When the matched row already carries an embedded research brief, `prepare` looks up the
matching persisted brief (same bundle ID and payload hash, `complete` or `degraded`, not
expired) via the brief repo and reuses it instead of calling the LLM again; this is reported as
`briefOutcome: "reused"`.

### Verifying Real Publication

To confirm a run actually assembled a bundle with a brief and published it (rather than
short-circuiting on missing config or stale data), query the database directly with `psql`
rather than an ad hoc Node/tsx script — the ESM pipeline modules cannot be `require`d from a
one-off `-e` script:

```bash
psql "$DATABASE_URL" -c "
SELECT eb.id,
       eb.received_at_unix_ms,
       (eb.payload -> 'researchBrief') IS NOT NULL AS has_embedded_brief,
       eb.payload -> 'assessment' ->> 'quality' AS quality,
       pa.status AS publish_status,
       pa.http_status
FROM intelligence.evidence_bundles eb
LEFT JOIN intelligence.publish_attempts pa ON pa.evidence_bundle_id = eb.id
ORDER BY eb.received_at_unix_ms DESC
LIMIT 10;
"
```

A healthy run shows `has_embedded_brief = true` and a `publish_status` of `created` or
`idempotent_replay` for the most recent rows. See the Evidence Bundle Publishing section below
for the full set of publish-attempt audit queries.

### Migration Precondition

> [!STOP]
> **Migration precondition:** The migration that introduces `evidence_bundles` constraints assumes the table is empty. If any row exists, the migration aborts. Do not rewrite or delete existing rows without lead engineer approval.

## Evidence Bundle Publishing (`pnpm publish:evidence`)

The `publish:evidence` command publishes the latest evidence bundle to Regime Engine via `POST /v1/evidence/sol-usdc`. It never publishes final `PolicyInsight` or executes transactions.

### Configuration

Required environment variables:

- `REGIME_ENGINE_BASE_URL`: Base URL for Regime Engine (e.g., `http://localhost:4000`).
- `REGIME_ENGINE_AUTH_TOKEN`: Shared secret for authentication with Regime Engine.

### Exit codes

- **0**: Success — `created` (new bundle accepted) or `idempotent_replay` (duplicate detected by Regime Engine).
- **1**: Failure — any other outcome.

### Outcomes and meanings

| Outcome                       | Meaning                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `created`                     | Bundle accepted by Regime Engine on attempt 1, 2, or 3.                                     |
| `idempotent_replay`           | Bundle already accepted; Regime Engine returned 200.                                        |
| `bundle_not_found`            | No evidence bundle exists to publish.                                                       |
| `local_validation_failed`     | Local config/URL validation failed (e.g., missing `REGIME_ENGINE_AUTH_TOKEN`, invalid URL). |
| `validation_failed`           | Regime Engine returned 400/422; bundle payload failed remote validation.                    |
| `auth_failed`                 | Regime Engine returned 401/403; authentication or authorization failed.                     |
| `conflict`                    | Regime Engine returned 409; idempotency key mismatch or concurrent conflict.                |
| `unknown_failed`              | Regime Engine returned another 4xx error.                                                   |
| `permanent_http_failed`       | Non-retryable HTTP error (e.g., DNS failure, connection refused).                           |
| `audit_store_failed`          | Local audit insert failed or conflicted; publishing outcome is unknown.                     |
| `transient_failure_exhausted` | Retryable error exhausted all 3 attempts without success.                                   |

### Retry bounds

The publisher retries transient failures up to **3 attempts** with an exponential delay capped at **2,000 ms** plus jitter. The scheduler should NOT implement its own retry loop — scheduler-level retries must remain bounded and operator-controlled to avoid unbounded backoff.

### Notification behavior

A **nonzero exit code** plus a structured **terminal event** (e.g., `created`, `idempotent_replay`, `transient_failure_exhausted`) is the repository's operator-visible failure mechanism. Scheduled Hermes cron delivery should alert on nonzero exit.

> [!SECRET]
> Logs and audit rows must never contain `REGIME_ENGINE_AUTH_TOKEN`. Authorization headers are redacted before persistence.

### Audit queries

All SQL queries below are read-only. Do not manually mutate immutable publish-attempt audit rows.

#### Inspect attempts by bundle ID and idempotency key

```sql
SELECT id, evidence_bundle_id, idempotency_key, attempt_number, status,
       http_status, error_message, received_at_unix_ms, completed_at_unix_ms
FROM intelligence.publish_attempts
WHERE evidence_bundle_id = $1
  AND idempotency_key = $2
ORDER BY attempt_number ASC, id ASC;
```

#### Recent failures by status

```sql
SELECT status, COUNT(*) AS attempts,
       MIN(received_at_unix_ms) AS oldest,
       MAX(received_at_unix_ms) AS newest
FROM intelligence.publish_attempts
WHERE status IN ('validation_failed', 'auth_failed', 'conflict', 'network_failed', 'unknown_failed')
  AND received_at_unix_ms >= $1
GROUP BY status
ORDER BY status;
```

#### Exhausted attempt 3 (transient failures)

```sql
SELECT pa.id, pa.evidence_bundle_id, pa.idempotency_key, pa.status,
       pa.http_status, pa.error_message, pa.first_attempted_at_unix_ms,
       pa.completed_at_unix_ms
FROM intelligence.publish_attempts AS pa
WHERE pa.attempt_number = 3
  AND pa.status IN ('network_failed', 'unknown_failed')
ORDER BY pa.received_at_unix_ms DESC
LIMIT 20;
```

### Recovery procedures

| Failure                       | Recovery                                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `auth_failed`                 | Verify `REGIME_ENGINE_AUTH_TOKEN` matches the shared secret in Regime Engine. Correct the config and rerun.                             |
| `validation_failed`           | Inspect `error_message` for details. Correct the upstream bundle assembly or schema version before rerunning.                           |
| `conflict`                    | Investigate idempotency payload mismatch. Rerun with the **same idempotency key** (same bundle) only after transient or store recovery. |
| `network_failed`              | Check network connectivity between this service and `REGIME_ENGINE_BASE_URL`.                                                           |
| `audit_store_failed`          | Check database connectivity and disk space. Resolve the store issue, then rerun with the same bundle identity.                          |
| `transient_failure_exhausted` | Check Regime Engine health. If healthy, rerun with the same bundle identity after the transient issue resolves.                         |

### Migration Precondition

> [!STOP]
> **Migration precondition:** The migration that introduces `publish_attempts` constraints assumes the table is empty. If any row exists, the migration aborts. Do not rewrite or delete existing rows without lead engineer approval.

## Research Brief Generation & Operational Lifecycle (`pnpm generate:brief`)

The `pnpm generate:brief <request-json-path>` command generates schema-constrained LLM research briefs over bounded evidence bundles.

### Command & Configuration

```bash
pnpm generate:brief data/brief-request.json
```

Required environment variables:

- `LLM_BASE_URL`: Base URL for OpenAI-compatible structured output API.
- `LLM_API_KEY`: API authentication key (redacted from all logs/audit entries).
- `LLM_MODEL`: Target model identifier.

Optional:

- `LLM_MODEL_VERSION`: Explicit model version.
- `LLM_TIMEOUT_MS`: Request timeout (finite default 30,000 ms; generation has no retry loop).

### Authority Boundary & Current-Regime Evidence

The LLM summarizes bounded, structured evidence. It does NOT synthesize policy or make position rebalance decisions.

If the request JSON includes `callerSuppliedCurrentRegime`, the generator uses it to assess regime alignment. If omitted, the assessment defaults to `not_applicable`. Current regime assessment is only performed when an explicit caller-owned input is supplied — the pipeline never infers or scrapes policy state.

### Complete vs Degraded Brief Outcomes

- **`COMPLETE`**: Created over an unexpired evidence bundle with valid structured output. **Only complete, unexpired, source-matching briefs are eligible to be composed into outbound publication.**
- **`DEGRADED`**: Generated when evidence is stale, missing, or degraded. Degraded briefs are persisted in Postgres as audit evidence but **are NOT eligible for publication attachment**.

### Persistence Diagnostics & Audit Queries

Brief persistence fields in `intelligence.research_briefs` include:

- `structured_output.generationStatus`: Status of generation (`COMPLETE` or `DEGRADED`).
- `prompt_version`: Version of prompt template used.
- `model`: Provider model tag.
- `input_hash`: SHA-256 hash of the bounded input prompt context.

#### Join Research Briefs to Source Bundle and Publish Attempts

```sql
SELECT rb.id AS brief_id,
       rb.evidence_bundle_id,
       rb.structured_output->>'generationStatus' AS generation_status,
       rb.prompt_version,
       rb.model,
       rb.input_hash,
       eb.payload_hash AS bundle_hash,
       pa.id AS publish_attempt_id,
       pa.status AS publish_status
FROM intelligence.research_briefs rb
JOIN intelligence.evidence_bundles eb ON eb.id = rb.evidence_bundle_id
LEFT JOIN intelligence.publish_attempts pa ON pa.research_brief_id = rb.id
ORDER BY rb.id DESC
LIMIT 20;
```

#### Brief Publication Eligibility Diagnostics

```sql
SELECT rb.id,
       rb.evidence_bundle_id,
       rb.structured_output->>'generationStatus' AS status,
       rb.expires_at_unix_ms,
       (rb.expires_at_unix_ms > EXTRACT(EPOCH FROM NOW()) * 1000) AS is_unexpired
FROM intelligence.research_briefs rb
WHERE rb.structured_output->>'generationStatus' = 'COMPLETE'
ORDER BY rb.id DESC;
```

### Recovery Guidance

- If brief generation fails due to provider rate limits, network timeouts, or invalid configuration: **rerun generation** after provider/config recovery.
- **Never manually edit immutable bundle or brief rows** in Postgres. If an updated brief is needed, execute a new generation run against the evidence bundle.

## Contextual Events Collection (`pnpm collect:context-events`)

The `collect:context-events` command collects contextual evidence from two sources: scheduled macro events (token unlocks, protocol upgrades, governance votes) and Solana protocol incidents. Contextual evidence supplements core telemetry but is explicitly **lower-confidence** and **never becomes execution authority**.

### Authority Boundary

- **Severity and materiality are deterministic evidence metadata.** Severity ranks (CRITICAL > HIGH > MEDIUM > LOW) are provider-supplied facts, not LLM determinations.
- **Missing feeds do not imply no risk.** A source outage produces a diagnostic outcome, not a "no upcoming events/no incidents" fact.
- **Unconfirmed reports remain unconfirmed.** Protocol incidents with `status: UNCONFIRMED` are excluded from selection eligibility regardless of severity.
- **Event direction is always unknown.** Contextual events describe what happened or what is scheduled; they do not indicate market direction or prescribe rebalancing.
- **Only regime-engine can synthesize final policy.** This repo collects, normalizes, and publishes contextual evidence. Final PolicyInsight synthesis belongs to regime-engine.

### Context Event Source Configuration

```bash
# Solana status API (protocol incidents - live, unauthenticated default)
SOLANA_STATUS_API_URL=https://status.solana.com
SOLANA_STATUS_API_KEY=<optional-api-key>

# Macro calendar API (scheduled events - optional/deferred)
MACRO_CALENDAR_API_URL=
MACRO_CALENDAR_API_KEY=
```

`SOLANA_STATUS_API_URL` defaults to `https://status.solana.com`. Both `SOLANA_STATUS_API_KEY` and `MACRO_CALENDAR_API_KEY` are optional. `MACRO_CALENDAR_API_URL` is optional and deferred pending a verified compatible provider. When `MACRO_CALENDAR_API_URL` is unset, scheduled event collection is deferred and a healthy incident-only run reports aggregate status `PARTIAL` with exit code 0. API credentials are redacted from all output, diagnostics, and persisted metadata.

### Retention and Licensing

All bounded factual extracts carry `retentionMode: "bounded_factual_extract"` and a provider-supplied or adapter-declared `license` string (the Statuspage adapter declares fixed `MIT` license). Providers must supply:

1. A non-empty `license` declaration
2. Stable `sourceEventId` values (provider incident ID, not synthesized)
3. Original source timestamps (`sourceObservedAtUnixMs`)

If a provider payload fails validation or cannot supply a non-empty license/retention declaration, the collector aborts with `malformed` status.

### Raw-First Append-Only Lifecycle

```
Provider API
    |
    v (raw observation, append-only)
raw_observations
    |
    v (normalized, validated, immutable)
normalized_observations (scheduled_event | protocol_incident)
```

- **Raw-first:** Raw observations are persisted before normalization. Malformed provider payloads that fail validation produce no raw row.
- **Append-only:** Lifecycle state transitions (SCHEDULED → ACTIVE → RESOLVED, or CANCELLED) are recorded as new rows, never mutations.
- **Immutable normalized:** Once written, normalized observation rows are never updated or deleted.

### Exact Replay Semantics

Replay detection uses a deterministic identity key derived from:

- `source` (e.g., `macro-calendar-api`, `solana-status-api`)
- `providerId`
- `sourceObservedAtUnixMs`
- `payloadHash` (canonical SHA-256 of the bounded snapshot)

Replaying the same provider snapshot with identical inputs produces `identical_replay` with no new rows created.

### Latest-State Selection

When multiple normalized rows exist for the same `sourceEventId`, selection uses **group-then-filter**:

1. **Group by identity:** Group all rows by `${source}::${observationKind}::${sourceEventId}`
2. **Pick latest:** Sort each group by `asOfUnixMs DESC, receivedAtUnixMs DESC, id DESC` and keep only the most recent
3. **Filter eligibility:** Apply freshness, expiry, and status filters to the latest-only set
4. **Sort result:** Order eligible events by severity ASC, then event time DESC, then sourceEventId ASC
5. **Cap:** Return at most `maxItems` (default 64)

This prevents older ACTIVE rows from being incorrectly revived after cancellation/expiry.

### Exit Statuses

| Status             | Exit Code | Meaning                                                                                              |
| ------------------ | --------- | ---------------------------------------------------------------------------------------------------- |
| `accepted`         | 0         | Collection succeeded with no warnings for all active sources                                         |
| `PARTIAL`          | 0         | Healthy incident-only run; scheduled macro coverage deferred                                         |
| `identical_replay` | 0         | Same snapshot detected; no new rows created                                                          |
| `stale`            | 0         | Evidence expired but raw data retained for contextual purposes                                       |
| `degraded`         | 0         | Evidence has warnings; raw data retained but usable                                                  |
| `malformed`        | 1         | Provider payload failed validation or Statuspage shape checks failed                                 |
| `timeout`          | 1         | Request timed out                                                                                    |
| `network`          | 1         | Network error occurred                                                                               |
| `unavailable`      | 1         | Protocol incident coverage unavailable when scheduled coverage deferred (or all sources unavailable) |
| `failed`           | 1         | Normalization or persistence failure with zero usable evidence                                       |

### Freshness Windows

Each contextual event carries:

- `asOfUnixMs`: Provider-supplied event observation time
- `expiresAtUnixMs`: Calculated expiry (typically `asOfUnixMs + 86400000` for scheduled events, provider-supplied for incidents)
- `validUntilUnixMs`: Normalized row validity cutoff

Events are excluded from selection when:

- `isStale === true`
- `asOfUnixMs > evaluationTimeUnixMs` (future-dated)
- `validUntilUnixMs <= evaluationTimeUnixMs`
- `expiresAtUnixMs <= evaluationTimeUnixMs`

### Source Unavailable Behavior

When `scheduled_event` coverage is deferred (`MACRO_CALENDAR_API_URL` unset), an `UNAVAILABLE` outcome with exit code 1 means protocol incident coverage (`solana-status-api`) is also unavailable. When both macro-calendar and solana-status APIs are configured and both are unavailable, the job returns `UNAVAILABLE` with exit code 1. This is a **diagnostic outcome**, not a "no events" fact. Operators should:

1. Check `https://status.solana.com` API endpoint status and rate limits
2. Verify network connectivity
3. Confirm credentials are correct (if required)
4. Inspect diagnostic message for specifics

A source outage is **ambiguous** — it may indicate genuine no-events or a service problem. The pipeline never fabricates a "clean" result to hide the ambiguity.

### Troubleshooting

#### All sources return empty events/incidents

Empty responses are valid (no scheduled events this period, no active incidents). Combined with a `degraded` status, this may indicate the provider is filtering by scope incorrectly. Verify `pair: "SOL/USDC"` and `network: "solana-mainnet"` are correct.

#### Timeout errors

Increase `timeoutMs` in the adapter or add `SOLANA_STATUS_API_KEY` if the provider rate-limits unauthenticated requests.

#### Statuspage payload shape validation failures

The Statuspage adapter expects a valid JSON response containing an `incidents` array where each incident has required fields (`id`, `name`, `impact`, `shortlink`). If the response is missing the `incidents` array or required incident fields, the collector rejects the payload as `malformed`. Verify `SOLANA_STATUS_API_URL` points to a valid Statuspage API endpoint (e.g., `https://status.solana.com`).

#### Incident stays UNCONFIRMED forever

UNCONFIRMED incidents are correctly excluded from selection. Once the provider confirms the incident (e.g., via official post-mortem), a new normalized row with `status: ACTIVE` or `status: RESOLVED` will be created on the next collection run.

## News Evidence Collection (`pnpm collect:news-evidence`)

The `collect:news-evidence` command collects bounded factual extracts from two allowed news sources: `crypto-news-api` for ecosystem news and `regulatory-monitor-api` for regulatory risk. News evidence is lower-confidence contextual evidence that supplements core telemetry but never becomes execution authority.

### Authority Boundary

- **No trading recommendations**: This routine explicitly forbids headline-based trading recommendations. News evidence describes what happened; it does not indicate market direction or prescribe rebalancing.
- **No LLM briefs**: Schema-constrained research brief generation is INT-BRIEFS (#12). This routine ends at persisted normalized observations.
- **No policy synthesis**: Final PolicyInsight synthesis belongs to regime-engine.
- **No full-text retention**: Only bounded factual extracts are stored (title, summary, claims, metadata). Full article bodies, copyrighted content, or paywalled material are not retained.
- **Missing coverage not meaning no risk**: A source returning empty results or an unavailable source is a diagnostic outcome, not a "no risk" determination.

### Two-Source Allowlist and Environment Variables

Required environment variables:

```bash
# Comma-separated allowlist - must be exactly these two sources in this order
NEWS_SOURCE_ALLOWLIST=crypto-news-api,regulatory-monitor-api

# Crypto news API (ecosystem news)
CRYPTO_NEWS_API_URL=https://api.example.com/news
CRYPTO_NEWS_API_KEY=<optional-api-key>

# Regulatory monitor API (regulatory risk)
REGULATORY_MONITOR_API_URL=https://api.example.com/regulatory
REGULATORY_MONITOR_API_KEY=<optional-api-key>
```

The allowlist is validated before any HTTP work begins. Duplicate entries, unknown source names, whitespace-only entries after trimming, and missing required URLs all cause collection to abort before external work.

### Bounded Extract Limits and HTTPS/License/Robots/Terms Requirements

Each article record carries `retentionMode: "bounded_factual_extract"` and contains:

- Title, factual summary, extracted claims (max 20), topic tags
- Publisher metadata (stable ID, display name, tier)
- Source quality indicators (reliability score 0.0-1.0, completeness, confirmation status, paywall flag)
- Immutable article identity (`articleId`) and version marker (`sourceVersionId`)
- Correction reference (`correctsSourceVersionId`, null if not a correction)
- Corroboration state (`unconfirmed`, `single_source`, `independently_corroborated`, `conflicting`)
- Affected assets, protocols, and jurisdictions
- Source references (HTTPS URLs only)

**Compliance requirements:**

- Provider must declare non-empty `license` string
- `robotsCompliance: true` must be set (page was not scraped in violation of robots.txt)
- `termsAccepted: true` must be set (content licensed for bounded retention)

Missing or negative declarations cause collection to abort with `malformed` status.

### Immutable Article/Version and Correction Semantics

Each article has:

- `articleId`: Stable provider-supplied article identity (never changes)
- `sourceVersionId`: Immutable version marker for this specific content snapshot

When an article is corrected:

- A new record is created with `correctsSourceVersionId` pointing to the earlier version
- The original version remains in the database as historical evidence
- Corrections are new records, never mutations

**Hard conflict**: If a provider reuses `sourceVersionId` for materially different content, this creates a hard conflict rather than an inferred correction. The pipeline fails closed to protect data integrity.

### 24-Hour Ecosystem and 72-Hour Regulatory Freshness Caps

| Evidence kind     | Freshness cap                              |
| ----------------- | ------------------------------------------ |
| `ecosystem_news`  | 24 hours (`retrievedAtUnixMs + 86400000`)  |
| `regulatory_risk` | 72 hours (`retrievedAtUnixMs + 259200000`) |

Stale articles (past `expiresAtUnixMs`) are excluded from selection but retained as historical evidence. Freshness is evaluated at collection time.

### Syndication vs Independent Corroboration

`corroborationState` distinguishes:

- `unconfirmed`: Single source, unverified
- `single_source`: Single source, verification status unknown
- `independently_corroborated`: Multiple independent sources confirm the same facts
- `conflicting`: Sources materially disagree on facts

Syndicated content (same `syndicationId` across sources) is distinguished from independent reporting. Independent corroboration elevates confidence but does not create deterministic-evidence authority.

### Conflict and Stale Behavior

- **Hard conflict**: `sourceVersionId` collision with different content = fail closed
- **Stale**: Past `expiresAtUnixMs` = excluded from selection, retained as historical
- **Partial loop persistence**: Per-article persistence is not one transaction across a provider response. Valid earlier writes survive a later failure; source outcome becomes PARTIAL.

### Command Exit Statuses

| Status        | Exit Code | Meaning                                                         |
| ------------- | --------- | --------------------------------------------------------------- |
| `COMPLETE`    | 0         | All configured sources succeeded (or replayed identically)      |
| `PARTIAL`     | 0         | At least one source succeeded; others failed or degraded        |
| `UNAVAILABLE` | 1         | All sources unavailable (HTTP 429, 404, 5xx, timeouts)          |
| `FAILED`      | 1         | Validation conflict, malformed payload, or zero usable evidence |

### Troubleshooting

#### Empty results from both sources

Empty responses are valid (no recent ecosystem news or regulatory developments). Combined with a `degraded` status, this may indicate providers are filtering incorrectly. Verify `pair: "SOL/USDC"` and `network: "solana-mainnet"` are correct scope filters.

#### License/retention validation failures

Providers must declare non-empty `license` and `retention: "bounded"`, with `robotsCompliance: true` and `termsAccepted: true`. If a provider cannot supply these, the collector aborts. Contact the provider to update their API contract or use a compliant provider.

#### Hard conflict on sourceVersionId reuse

If a provider begins reusing `sourceVersionId` for changed content, collection will fail closed. Report this to the provider as a data quality issue. Do not modify collection logic to accept version collisions.

#### All sources unavailable (UNAVAILABLE)

Check:

1. API endpoint status and rate limits
2. Network connectivity
3. Credentials correctness (if required)
4. Diagnostic message for specifics

A source outage is ambiguous: it may indicate genuine no-coverage or a service problem. The pipeline never fabricates a "clean" result to hide ambiguity.

## On-Chain Flow Collection (`pnpm collect:on-chain-flow`)

The `collect:on-chain-flow` command collects on-chain SOL/USDC flow events from two providers: Helius (windowed DEX net flow querying the Whirlpool contract address) and Birdeye (whale swaps and DEX net flows). On-chain flow data describes what happened on-chain, not why. No output claims motive or policy; final synthesis belongs to regime-engine.

### Authority Boundary

- **Factual evidence only**: Flow events (swaps, stablecoin flows, DEX net flows, CEX proxies) are factual metadata about on-chain activity. The collector does not infer intent, motive, or policy.
- **No stablecoin or CEX coverage in this phase**: `stablecoin_flow` is deferred pending Circle address verification. `cex_flow_proxy` is deferred indefinitely (paid identity API required; self-maintained address book rejected as ongoing burden).
- **No execution authority**: This collector captures evidence only. It does not construct instructions, sign transactions, or execute swaps.

### Pool Target Boundary

Helius `dex_net_flow` queries `WHIRLPOOL_ADDRESS` (`addressContext.addressType: "contract"`).

### Event Coverage Matrix

| Event kind        | Status                               | Source                                                |
| ----------------- | ------------------------------------ | ----------------------------------------------------- |
| `whale_swap`      | Live                                 | Birdeye pair trades                                   |
| `dex_net_flow`    | Live                                 | Birdeye pair trades, Helius address history aggregate |
| `whale_transfer`  | Retired                              | Retired (replaced by Helius windowed net flow)        |
| `stablecoin_flow` | Deferred pending source verification | No clean free-tier source confirmed                   |
| `cex_flow_proxy`  | Deferred                             | Paid identity/self-maintained address book rejected   |

### Environment Variables

Required environment variables:

```bash
# Helius flow API (dex_net_flow, Whirlpool contract target)
HELIUS_FLOW_API_URL=https://api.helius.xyz
HELIUS_API_KEY=<your-helius-api-key>

# Birdeye flow API (whale_swap, dex_net_flow)
BIRDEYE_FLOW_API_URL=https://public-api.birdeye.so
BIRDEYE_API_KEY=<your-birdeye-api-key>

# Threshold overrides
ON_CHAIN_WHALE_SWAP_MIN_USDC=100000            # Default: 100,000 USDC
ON_CHAIN_DEX_NET_FLOW_MIN_USDC=250000          # Default: 250,000 USDC
ON_CHAIN_FLOW_LOOKBACK_MS=900000               # Default: 900,000 ms (15 minutes)

# Whirlpool address and position wallet
WHIRLPOOL_ADDRESS=<orca-sol-usdc-whirlpool-address>
WALLET_PUBLIC_KEY=<position-wallet-address>
```

> Note: `stablecoin_flow` and `cex_flow_proxy` have no threshold env vars because they are not implemented in this phase.

### Cadence and Calibration Rationale

- **Schedule & Cadence**: `on-chain-flow` runs every 15 minutes (`*/15 * * * *`).
- **Lookback Window**: `ON_CHAIN_FLOW_LOOKBACK_MS` defaults to 900,000 ms (15 minutes), ensuring adjacent runs have no structural gap.
- **Implemented Live Thresholds**:

  ```bash
  ON_CHAIN_WHALE_TRANSFER_MIN_USDC=100000
  ON_CHAIN_WHALE_SWAP_MIN_USDC=100000
  ON_CHAIN_DEX_NET_FLOW_MIN_USDC=250000
  ```

- **Threshold Calibration Arithmetic**:
  ```text
  Current snapshot: $72,954,595 24h volume and $26,150,296 TVL.
  $72,954,595 / 96 fifteen-minute windows = approximately $759,944 gross volume per window.
  $100,000 / $759,944 = approximately 13.2% of a typical window.
  ```
- **Deferred VPS Variables**: Observed VPS names `ON_CHAIN_STABLECOIN_FLOW_MIN_USDC` and `ON_CHAIN_CEX_PROXY_MIN_USDC` are parsed for deferred signal kinds and do not replace the live whale-transfer/whale-swap variables.
- **Operator Callout**: The deployment VPS must set the two live whale values (`ON_CHAIN_WHALE_TRANSFER_MIN_USDC` and `ON_CHAIN_WHALE_SWAP_MIN_USDC`) to `100000`; repository documentation cannot mutate host-local environment state.
- **Provider Costs & Rate Limits**: The 15-minute cadence makes four times as many Helius/Birdeye collection attempts as the old hourly cadence; monitor provider rate limits (429s) and costs after rollout.

### Command and Statuses

```bash
pnpm collect:on-chain-flow
```

Status semantics:

- `empty`: the provider request completed, but no event became accepted or replayed; this is healthy source execution, not usable evidence.

Truth table reducer rules:

```text
all empty -> COMPLETE / exit 0
empty + accepted/replayed -> COMPLETE / exit 0
empty + unavailable/failed -> PARTIAL / exit 0
all unavailable -> UNAVAILABLE / exit 1
all non-empty failures -> FAILED / exit 1
```

Exit codes:

| Status        | Exit Code | Meaning                                                                     |
| ------------- | --------- | --------------------------------------------------------------------------- |
| `COMPLETE`    | 0         | All configured sources succeeded, replayed identically, or reported `empty` |
| `PARTIAL`     | 0         | At least one source succeeded/empty while others failed or were unavailable |
| `UNAVAILABLE` | 1         | All sources unavailable (HTTP 429, 404, 5xx, timeouts, saturated page)      |
| `FAILED`      | 1         | Validation conflict, malformed payload, or non-empty source failure         |

A saturated Helius page (100 transactions returned, incomplete window) maps to `unavailable` — not a clean no-event (`empty`) result. See "Legacy Endpoint and Completeness Guard" above.

### Threshold Semantics

Thresholds are exact decimal strings parsed with arbitrary-precision arithmetic. All thresholds are denominated in USDC:

- `whaleTransferMinUsdc`: Whale transfer transactions (Helius, Whirlpool target)
- `whaleSwapMinUsdc`: Whale swap transactions (Birdeye)
- `dexNetFlowMinUsdc`: DEX net flow magnitude (Birdeye)

`stablecoinFlowMinUsdc` and `cexFlowProxyMinUsdc` are not implemented in this phase.

### Real Amount and Address Semantics

- **`amountUsdc`**: Converted from raw token amounts using proper decimal arithmetic. Raw native-unit amounts mislabeled as USDC are rejected at normalization.
- **`addressContext.address`**: The Whirlpool address (`WHIRLPOOL_ADDRESS`). Note that `addressContext.addressType` remains `wallet` for compatibility even though `addressContext.address` is the Whirlpool address. Transfer attribution uses `fromUserAccount`/`toUserAccount` fields; ambiguous records (address absent or appears on both sides) are omitted rather than guessed.

### Existing-Deployment Rollout

Editing `.env.example` does not rewrite deployed environment overrides on active systems. To roll out the calibrated thresholds and 15-minute schedule:

1. Update deployed environment variables for all three live thresholds:
   ```bash
   ON_CHAIN_WHALE_TRANSFER_MIN_USDC=100000
   ON_CHAIN_WHALE_SWAP_MIN_USDC=100000
   ON_CHAIN_DEX_NET_FLOW_MIN_USDC=250000
   ```
2. Deploy the updated code.
3. Reconcile desired state with Hermes cron registration:
   ```bash
   pnpm cron:render
   pnpm cron:sync -- --apply
   ```

### Live Acceptance Evidence

> **Warning**: The collector persists immutable raw and normalized rows directly to the database. Use the intended deployment database intentionally.

To produce bounded live acceptance proof without contacting Birdeye while its quota is exhausted:

1. Confirm the deployed live thresholds are `100000`; do not use threshold-lowering.
2. Run the collector with `BIRDEYE_FLOW_API_URL=http://127.0.0.1:1` as a process-local override, leaving the Helius URL/key and database configuration intact:

   ```bash
   BIRDEYE_FLOW_API_URL=http://127.0.0.1:1 pnpm collect:on-chain-flow
   ```

3. Require a Helius outcome with `accepted > 0` or `replayed > 0` over a representative recent window. `empty` is correctly reported but does not satisfy the live-evidence acceptance criterion.
4. Query `intelligence.raw_observations` for a `helius-api` row received at or after the recorded run start. Do not delete immutable observations afterward.

> **Note**: Zero accepted transfers (`empty`) is correctly reported but is **inconclusive** for live acceptance evidence. A saturated Helius page, provider failure, or absent genuine transfer is not permission to insert synthetic data or claim success. If no genuine transfer occurs, record the run as inconclusive and re-test when live activity occurs.

### Live Smoke Command

To verify the collector against the deployment target without committing data:

```bash
pnpm collect:on-chain-flow
```

The command persists immutable raw and normalized observations. Use the configured deployment target intentionally and record the run ID from the output. Do not delete observations as cleanup.

### No-Event Semantics

`empty` responses from providers are valid (no qualifying events in the lookback window). The collector returns `COMPLETE` with zero accepted events, not an error. An `unavailable` status from Helius due to a saturated page is distinct from a clean no-event (`empty`) result — see "Legacy Endpoint and Completeness Guard" above.

### Retention and Licensing

All events carry `retention: "bounded"` and a provider-supplied `license` string. Providers must supply stable `providerRunId` values and non-empty source references. Missing or invalid license declarations cause collection to abort.

### Troubleshooting

#### Both sources return empty events (`empty`)

Empty responses are valid (no qualifying events in the lookback window). `empty: the provider request completed, but no event became accepted or replayed; this is healthy source execution, not usable evidence.` If combined with a `degraded` status, this may indicate providers are filtering incorrectly. Verify the lookback window and threshold values are appropriate.

#### Helius returns `unavailable` with saturated page

A saturated page (100 transactions returned, window not covered) produces `unavailable`. This is expected for highly active pool targets and indicates the lookback window is not fully covered. Keep saturated Helius pages `unavailable`, not `empty`. A clean empty response (fewer than 100 transactions, window fully covered) is distinct (`empty`) and indicates genuine no qualifying events.

#### Timeout errors

Increase timeout values in the adapter configuration or reduce the lookback window (`ON_CHAIN_FLOW_LOOKBACK_MS`).

#### License/retention validation failures

Providers must declare non-empty `license` and `retention: "bounded"`. If a provider cannot supply these, the collector cannot legally accept the data. Contact the provider to update their API contract or use a compliant provider.

#### All sources unavailable (UNAVAILABLE)

Check:

1. API endpoint status and rate limits
2. Network connectivity
3. Credentials correctness
4. Diagnostic message for specifics

A source outage is ambiguous: it may indicate genuine no-events or a service problem. The pipeline never fabricates a "clean" result to hide ambiguity.

## Perp & Liquidation Collection (`pnpm collect:perp-liquidation`)

The `collect:perp-liquidation` command collects SOL perp market and liquidation-stress evidence from two providers: Binance Futures (`binance-fapi`) and Velocity Exchange Data API (retaining `drift-api` as the canonical internal venue identifier). It runs both venues concurrently, persists raw and normalized observations, and derives four deterministic feature kinds per venue in the same run. Liquidation clusters and funding-rate spikes are market-stress evidence, not execution triggers; final synthesis belongs to regime-engine.

### Authority Boundary

- **Factual market evidence only**: Funding rate, open interest, perp/spot basis, and liquidation-event evidence describe observed market state. The collector does not infer motive, sentiment, or policy.
- **No execution authority**: This collector captures evidence only. It does not construct instructions, sign transactions, or execute swaps.
- **Not a direct trigger**: A liquidation-cluster spike or extreme funding rate does not itself imply an action; it is contextual evidence for regime-engine's synthesis.

### Environment Variables

Required environment variables:

```bash
# Binance Futures public API (funding rate, open interest, perp/spot basis)
BINANCE_FAPI_BASE_URL=https://fapi.binance.com
BINANCE_SOL_PERP_SYMBOL=SOLUSDT

# Velocity Exchange Data API (funding rate, open interest, perp/spot basis, public liquidation stream)
# Note: drift-api is retained as the canonical internal venue identifier.
DRIFT_DATA_API_BASE_URL=https://data.velocity.exchange
DRIFT_SOL_PERP_SYMBOL=SOL-PERP
DRIFT_SOL_PERP_MARKET_INDEX=0

# Drift numeric precision exponents (defaults shown; rarely need overriding)
DRIFT_PRICE_PRECISION=1000000
DRIFT_BASE_PRECISION=1000000000
DRIFT_QUOTE_PRECISION=1000000

# Lookback window in ms; must be >= 14,400,000 (4 hours) to cover the oi_trend_4h window
PERP_LIQUIDATION_LOOKBACK_MS=14400000
```

`BINANCE_SOL_PERP_SYMBOL`, `DRIFT_SOL_PERP_SYMBOL`, and `DRIFT_SOL_PERP_MARKET_INDEX` have no default instrument — the collector fails closed with exit code 1 if any is unset or malformed, rather than guessing an instrument.

`DRIFT_SOL_PERP_SYMBOL` routes funding rate and market statistics endpoints, while `DRIFT_SOL_PERP_MARKET_INDEX` filters global liquidation records. All three endpoints are unauthenticated, and liquidations are bounded locally to the collector lookback (`PERP_LIQUIDATION_LOOKBACK_MS`). Velocity Exchange is a provisional host; if its schema changes, malformed or unavailable coverage status is expected.

### Command and Statuses

```bash
pnpm collect:perp-liquidation
```

Exactly two sources (one `binance-fapi`, one `drift-api`) are required; the job throws before any network call if the source configuration is missing, duplicated, or miscounted.

Exit codes:

| Status        | Exit Code | Meaning                                                                 |
| ------------- | --------- | ----------------------------------------------------------------------- |
| `COMPLETE`    | 0         | Both venues succeeded (or replayed identically)                         |
| `PARTIAL`     | 0         | One venue succeeded; the other failed, degraded, or was unavailable     |
| `UNAVAILABLE` | 1         | Both venues unavailable (HTTP 429, network/timeout errors)              |
| `FAILED`      | 1         | Validation conflict, malformed payload, or zero usable evidence overall |

### Observation and Feature Kinds

Normalized observation kinds: `funding_rate`, `open_interest`, `perp_basis`, `liquidation_event`, `leverage_proxy`.

Derived feature kinds (computed per venue, one row each when inputs are available):

- `oi_trend_4h` (BPS): open-interest change over the earliest vs. latest sample in a 4-hour window. Requires at least 2 open-interest samples for the venue; otherwise `UNAVAILABLE` (`fewer_than_two_oi_samples`).
- `funding_rate_annualized` (BPS): the venue's latest funding-rate sample, annualized from its native funding interval.
- `basis_spread_bps` (BPS): the venue's latest perp price vs. spot price spread.
- `liquidation_cluster_1h` (BPS): deduplicated liquidation notional summed over the trailing 1-hour window, divided by the venue's latest open-interest notional. `UNAVAILABLE` (`no_same_venue_oi_denominator`) when no same-venue open-interest sample exists to denominate against.

All four calculations use `bigint`-backed exact rational arithmetic with ties-away-from-zero rounding — no floating-point rounding drift.

### Binance Liquidation Limitation

Binance's public futures REST API does not expose market-wide liquidation history without account-scoped (`USER_DATA`) authentication. Consequently:

- `binance-fapi` supplies perp market state only: funding rate, open interest, perp/spot basis.
- `drift-api` (sourced via Velocity Exchange Data API) is the sole source of `liquidation_event` evidence, from Velocity's public liquidation endpoint.
- `liquidation_cluster_1h` is therefore always derived from Drift-venue observations; Binance never contributes to this feature.

### Coverage Gating

If a provider reports coverage for an observation kind as anything other than `available` (e.g. `unavailable` or `malformed`), any feature depending on that kind is forced to `UNAVAILABLE` with reason `coverage_unavailable`, even if a prior sample would otherwise have produced a value. Coverage status is authoritative over stale cached values.

### Troubleshooting

#### One venue always shows `UNAVAILABLE`

Check the venue-specific base URL and instrument config (`BINANCE_SOL_PERP_SYMBOL` / `DRIFT_SOL_PERP_SYMBOL` / `DRIFT_SOL_PERP_MARKET_INDEX`), then check rate limits and network connectivity for that venue's endpoint. A single-venue outage produces `PARTIAL` at the job level, not a hard failure.

#### `liquidation_cluster_1h` is always `UNAVAILABLE`

This is expected if Drift is unavailable or has no recent open-interest sample — Binance does not supply liquidation data, so the feature has no denominator without a Drift OI sample in the current run.

#### Collector fails closed at startup

`BINANCE_SOL_PERP_SYMBOL`, `DRIFT_DATA_API_BASE_URL`, `DRIFT_SOL_PERP_SYMBOL`, or `DRIFT_SOL_PERP_MARKET_INDEX` is unset, or `PERP_LIQUIDATION_LOOKBACK_MS` is below the 4-hour floor. Fix the env var; the collector will not fall back to a default instrument.

#### Database connection error

Failure to initialize or close the database connection produces a diagnostic message with exit code 1. All secrets in error strings are automatically redacted.

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
