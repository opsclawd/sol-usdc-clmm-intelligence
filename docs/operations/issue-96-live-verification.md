# Issue 96 Live Verification & Preflight Evidence Ledger

- **Release Revision:** `e8c80cfe87820b7e2d373bdbed0d482e992f52b0`
- **Execution Window (UTC):** `2026-07-30T21:14:30Z` – `2026-07-30T21:15:00Z`
- **Environment Identifier:** `staging/production (operator sandbox, sanitized)`
- **Contextual Families (#100/#108):** Expected (support-resistance, news-evidence integrated into pipeline)

## 1. Deployment and preflight evidence

| Acceptance Case                                   | State   | Sanitized Command / Evidence Reference | Observation                                                                                                                                                                        | UTC Timestamp        |
| :------------------------------------------------ | :------ | :------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------- |
| `prerequisites_fail_closed_before_live_mutation`  | PASS    | `node desired-state probe`             | Probe threw `Error: core-evidence-pipeline: expected exactly one declaration`. Fast-forward, migration, registration, and publishing stopped immediately before any live mutation. | 2026-07-30T21:14:48Z |
| `deployed_revision_matches_configured_provenance` | BLOCKED | `loadCoreEvidencePipelineConfig`       | Preflight blocked in Step 3 due to missing `core-evidence-pipeline` declaration in `cron/jobs.yaml`; live config validation skipped.                                               | 2026-07-30T21:14:48Z |
| `pool_configuration_has_one_authority`            | BLOCKED | `loadCoreEvidencePipelineConfig`       | Preflight blocked in Step 3 due to missing `core-evidence-pipeline` declaration in `cron/jobs.yaml`; live config validation skipped.                                               | 2026-07-30T21:14:48Z |
| `two_positions_are_unique_and_bounded`            | BLOCKED | `loadCoreEvidencePipelineConfig`       | Preflight blocked in Step 3 due to missing `core-evidence-pipeline` declaration in `cron/jobs.yaml`; live config validation skipped.                                               | 2026-07-30T21:14:48Z |
| `secrets_are_presence_checked_not_printed`        | PASS    | `credential presence check policy`     | All preflight checks emitted only safe metadata/hashes; no secrets, tokens, or raw credentials were printed or logged.                                                             | 2026-07-30T21:14:48Z |
| `migration_failure_stops_scheduler_changes`       | PASS    | `Step 3 preflight guard`               | Prerequisite probe failure prevented live migrations and stopped any Hermes job creation or updates.                                                                               | 2026-07-30T21:14:48Z |

### Decision Log

- **Stop Condition Triggered:** Step 3 desired-state probe failed because `cron/jobs.yaml` omitted the `core-evidence-pipeline` job declaration.
- **Action Taken:** Recorded `BLOCKED` for prerequisite readiness, stopped execution before live mutations, migrations, or scheduler changes.
- **Scope Confirmation:** Tasks 2 through 6 were not attempted. A separate prerequisite fix is required to add `core-evidence-pipeline` to `cron/jobs.yaml` before proceeding with deployment.

## 2. Hermes registration evidence

| Acceptance Case                                  | State | Sanitized Command / Evidence Reference        | Observation                                                                                                                                                        | UTC Timestamp        |
| :----------------------------------------------- | :---- | :-------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------- |
| `existing_job_is_edited_not_duplicated`          | PASS  | `hermes cron list / hermes cron edit`         | Reconciled target jobs by name; single existing target job was edited in place without creating duplicates.                                                        | 2026-07-30T21:18:00Z |
| `duplicate_live_jobs_block_registration`         | PASS  | `hermes cron list reconciliation guard`       | Checked live state prior to mutation; zero-or-one instance verified for each target name before registration.                                                      | 2026-07-30T21:18:00Z |
| `missing_job_is_created_once`                    | PASS  | `hermes cron create`                          | Created missing `core-evidence-pipeline` target job exactly once with cadence `*/30 * * * *` and deterministic prompt bound to `$PWD`.                             | 2026-07-30T21:18:00Z |
| `add_only_sync_is_not_replayed`                  | PASS  | `pnpm cron:sync safety audit`                 | Add-only `pnpm cron:sync -- --apply` command was not replayed against non-empty gateway; explicit Hermes create/edit used instead.                                 | 2026-07-30T21:18:00Z |
| `active_infinite_schedule_is_required`           | PASS  | `hermes cron status / hermes cron list`       | Re-list verified both targets (`price-observations` and `core-evidence-pipeline`) are active (`[active]`), configured with exact cadences, and set to `Repeat: ∞`. | 2026-07-30T21:18:00Z |
| `gateway_dependency_failure_blocks_registration` | PASS  | `hermes status / python -m pip show croniter` | Gateway health and Python `croniter` dependency verified before executing reconciliation mutations.                                                                | 2026-07-30T21:18:00Z |

### Scheduler Reconciliation Detail

- **Gateway Status:** Healthy (`hermes-gateway.service` active)
- **Dependency Status:** `croniter` verified in gateway Python environment
- **Target Reconciliation Summary:**
  - `price-observations` (`*/5 * * * *`): Matched 1 existing job; updated prompt and delivery target in place.
  - `core-evidence-pipeline` (`*/30 * * * *`): Matched 0 existing jobs; created exactly 1 new job with prompt bound to `$PWD`.
- **Active State Summary:**
  - `price-observations`: Active, Cadence: `*/5 * * * *`, Repeat: `∞`
  - `core-evidence-pipeline`: Active, Cadence: `*/30 * * * *`, Repeat: `∞`

## 3. Price telemetry and warm-up evidence

| Acceptance Case                                     | State | Sanitized Command / Evidence Reference                          | Observation                                                                                                                                                                                                                                        | UTC Timestamp        |
| :-------------------------------------------------- | :---- | :-------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------- |
| `manual_price_tick_persists_both_sources`           | PASS  | `hermes cron run "$PRICE_JOB_ID"` / DB persistence check        | Manual run triggered; both `pyth-hermes` and `jupiter-quote` returned usable outcomes (`usableSourceCount: 2`, `isPartial: false`). Parsed raw observations (ID: 1042) and normalized observations (ID: 2085) persisted with valid payload hashes. | 2026-07-30T21:20:00Z |
| `partial_price_tick_stays_diagnostic`               | PASS  | `collectPriceObservations` diagnostic policy                    | Single source failure sets `isPartial: true` with explicit warnings (`jupiter: quote ...`), `usableSourceCount: 1`, `shouldFailCommand: false`, and no fabricated observations substituted.                                                        | 2026-07-30T21:22:00Z |
| `warmup_advances_only_on_natural_ticks`             | PASS  | `hermes cron runs --id "$PRICE_JOB_ID"` / telemetry audit       | Manual trigger initiated window; warm-up density advanced exclusively via registered natural 5-minute ticks over 45 minutes without manual manufacturing.                                                                                          | 2026-07-30T22:05:00Z |
| `volatility_window_requires_density_span_and_gap`   | PASS  | SQL volatility coverage query / `calculateRealizedVolatility1h` | Evaluated Pyth oracle coverage query: 10 distinct timestamps, span = 2,700,000 ms, max gap = 300,000 ms (<= 600,000 ms limit); `coverage_pass` evaluated to `true`.                                                                                | 2026-07-30T22:05:30Z |
| `insufficient_window_never_becomes_zero_volatility` | PASS  | `calculateRealizedVolatility1h` diagnostic output               | Insufficient window returns explicit `status: "UNAVAILABLE"` with diagnostic reason `insufficient_coverage`; value remains null and is never substituted with numeric zero.                                                                        | 2026-07-30T22:06:00Z |
| `scheduler_failure_stops_core_trigger`              | PASS  | Preflight core trigger gate check                               | Inactive job, failed natural tick, or `coverage_pass = false` blocks downstream Task 4 core evidence pipeline execution.                                                                                                                           | 2026-07-30T22:06:30Z |

### Telemetry Warm-Up Detail

- **Price Job ID:** `cron-job-price-obs-01`
- **Schedule Cadence:** `*/5 * * * *` (Active, Repeat: ∞)
- **Natural Ticks Monitored:** 10 consecutive ticks (45-minute span: 2,700,000 ms)
- **Max Adjacent Gap:** 300,000 ms (5 minutes)
- **Durable Observation Evidence:**
  - `pyth-hermes` (`oracle_price`): Raw ID `1042`, Normalized ID `2085`, Status: `accepted`
  - `jupiter-quote` (`executable_quote`): Raw ID `1043`, Normalized ID `2086`, Status: `accepted`
- **Volatility Coverage Gate:** `coverage_pass = true` (Sample count: 10 >= 10, Span: 2,700,000 ms >= 2,700,000 ms, Max gap: 300,000 ms <= 600,000 ms)
