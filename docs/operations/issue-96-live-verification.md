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

- **Stop Condition Triggered:** Step 3 desired-state probe failed because `cron/jobs.yaml` omitted the `core-evidence-pipeline` job declaration. This omission is deliberate and pending #104 (`tests/regression/core-evidence-pipeline-cron.test.ts` asserts `cron/jobs.yaml` has zero `core-evidence-pipeline` entries).
- **Action Taken:** Recorded `BLOCKED` for prerequisite readiness, stopped execution before live mutations, migrations, or scheduler changes.
- **Scope Confirmation:** Live execution of Tasks 2 through 6 was not attempted, because the fail-closed preflight gate stops all downstream live mutation (Hermes registration, price telemetry warm-up, and evidence-pipeline triggering) whenever `core-evidence-pipeline` is absent from `cron/jobs.yaml`. A separate prerequisite fix (adding the `core-evidence-pipeline` declaration, tracked under #104) is required before Tasks 2 through 6 can be run against a live environment.

## 2. Hermes registration evidence

Live Hermes job registration was not attempted because preflight halted execution in Step 1 due to the missing `core-evidence-pipeline` declaration in `cron/jobs.yaml`.

| Acceptance Case                                  | State   | Sanitized Command / Evidence Reference        | Observation                                                                                           |
| :----------------------------------------------- | :------ | :-------------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| `existing_job_is_edited_not_duplicated`          | NOT RUN | `hermes cron list / hermes cron edit`         | Execution halted by Task 1 preflight failure; live Hermes job reconciliation not attempted.           |
| `duplicate_live_jobs_block_registration`         | NOT RUN | `hermes cron list reconciliation guard`       | Execution halted by Task 1 preflight failure; live Hermes duplicate check not attempted.              |
| `missing_job_is_created_once`                    | NOT RUN | `hermes cron create`                          | Execution halted by Task 1 preflight failure; live Hermes job creation not attempted.                 |
| `add_only_sync_is_not_replayed`                  | NOT RUN | `pnpm cron:sync safety audit`                 | Execution halted by Task 1 preflight failure; live Hermes sync safety audit not attempted.            |
| `active_infinite_schedule_is_required`           | NOT RUN | `hermes cron status / hermes cron list`       | Execution halted by Task 1 preflight failure; live Hermes active schedule verification not attempted. |
| `gateway_dependency_failure_blocks_registration` | NOT RUN | `hermes status / python -m pip show croniter` | Execution halted by Task 1 preflight failure; live Hermes gateway check not attempted.                |

### Decision Log

- **Scope Confirmation:** Hermes registration (Task 2) was not attempted because Section 1 preflight failed closed on the deliberate omission of `core-evidence-pipeline` in `cron/jobs.yaml`.
- **Next Step:** Pending #104 prerequisite landing, re-run preflight and execute Hermes registration.

## 3. Price telemetry and warm-up evidence

Live warm-up against a running `price-observations` Hermes schedule was not attempted for the same reason as Section 2: the Section 1 preflight gate stops all live mutation, and no natural ticks can be observed from a job that was never registered in this run.

| Acceptance Case                                     | State   | Sanitized Command / Evidence Reference | Observation                                                                                         |
| :-------------------------------------------------- | :------ | :------------------------------------- | :-------------------------------------------------------------------------------------------------- |
| `manual_price_tick_persists_both_sources`           | NOT RUN | `pnpm collect:price`                   | Execution halted by Task 1 preflight failure; live price telemetry tick not attempted.              |
| `partial_price_tick_stays_diagnostic`               | NOT RUN | `pnpm collect:price`                   | Execution halted by Task 1 preflight failure; live partial price telemetry check not attempted.     |
| `warmup_advances_only_on_natural_ticks`             | NOT RUN | `price-observations scheduled tick`    | Execution halted by Task 1 preflight failure; live scheduled tick warm-up not attempted.            |
| `volatility_window_requires_density_span_and_gap`   | NOT RUN | `calculateRealizedVolatility1h`        | Execution halted by Task 1 preflight failure; live volatility density span gap check not attempted. |
| `insufficient_window_never_becomes_zero_volatility` | NOT RUN | `calculateRealizedVolatility1h`        | Execution halted by Task 1 preflight failure; live insufficient window verification not attempted.  |
| `scheduler_failure_stops_core_trigger`              | NOT RUN | `calculateRealizedVolatility1h`        | Execution halted by Task 1 preflight failure; live core trigger coverage gate check not attempted.  |

### Decision Log

- **Scope Confirmation:** Task 3's live warm-up-through-natural-ticks acceptance cases were not attempted in this environment while Section 1 remains `BLOCKED`; no live evidence is reported for them, and offline unit test references have been removed to comply with live PostgreSQL state requirements.
- **Next Step:** Once the #104 prerequisite fix lands and Section 1 passes, re-run this ledger to capture live Hermes registration (Section 2) and live natural-tick warm-up plus coverage-gate evidence (Section 3) end to end.
