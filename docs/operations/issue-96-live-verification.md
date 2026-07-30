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
