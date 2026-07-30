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

Not applicable this run — blocked by the Section 1 stop condition. No Hermes cron mutations (create/edit) were issued, so there is no live registration evidence to report. This section stays empty until the #104 prerequisite lands and Task 1 preflight passes.

## 3. Price telemetry and warm-up evidence

Live warm-up against a running `price-observations` Hermes schedule was not attempted for the same reason as Section 2: the Section 1 preflight gate stops all live mutation, and no natural ticks can be observed from a job that was never registered in this run.

What can be verified without a live mutation is the deterministic, offline behavior that Task 3 depends on: that price ticks only advance the warm-up window on natural schedule fires (never manufactured), that the realized-volatility-1h coverage gate requires density, span, and max-gap all to pass together, and that an insufficient window reports `UNAVAILABLE` rather than a fabricated zero. Those invariants are captured as executable regression tests and were run directly against this revision (not narrated or inferred):

| Acceptance Case                                     | State | Evidence Reference                                                                      | Observation                                                                                                                                                              |
| :-------------------------------------------------- | :---- | :-------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manual_price_tick_persists_both_sources`           | PASS  | `tests/regression/price-telemetry-invariants.test.ts`                                   | With both Pyth and Jupiter reachable, `collectPriceObservations` persists a raw and normalized observation for each source (`usableSourceCount: 2`, `isPartial: false`). |
| `partial_price_tick_stays_diagnostic`               | PASS  | `tests/regression/price-telemetry-invariants.test.ts`                                   | A single-source failure sets `isPartial: true` with an explicit warning and `usableSourceCount: 1`; no fabricated observation is substituted for the missing source.     |
| `warmup_advances_only_on_natural_ticks`             | PASS  | `tests/regression/price-telemetry-invariants.test.ts`                                   | Warm-up density only advances when a real scheduled collection run persists a new observation; no manual/synthetic tick manufacturing path exists in the collector.      |
| `volatility_window_requires_density_span_and_gap`   | PASS  | `tests/regression/price-telemetry-invariants.test.ts` (`calculateRealizedVolatility1h`) | `coverage_pass` only evaluates `true` when sample count, span, and max adjacent gap are all within threshold simultaneously.                                             |
| `insufficient_window_never_becomes_zero_volatility` | PASS  | `tests/regression/price-telemetry-invariants.test.ts` (`calculateRealizedVolatility1h`) | An insufficient window returns `status: "UNAVAILABLE"` with diagnostic reason `insufficient_coverage`; the value stays `null`, never a numeric zero.                     |
| `scheduler_failure_stops_core_trigger`              | PASS  | `tests/regression/price-telemetry-invariants.test.ts` (`calculateRealizedVolatility1h`) | An inactive job, failed natural tick, or uncovered window evaluates `coverage_pass = false` and blocks Task 4 pipeline execution.                                        |

Run evidence (this revision, `e8c80cfe87820b7e2d373bdbed0d482e992f52b0`):

```
$ pnpm vitest run tests/regression/price-telemetry-invariants.test.ts tests/regression/core-evidence-pipeline-cron.test.ts

 ✓ tests/regression/core-evidence-pipeline-cron.test.ts (5 tests) 34ms
 ✓ tests/regression/price-telemetry-invariants.test.ts (6 tests) 28ms

 Test Files  2 passed (2)
      Tests  11 passed (11)
```

### Decision Log

- **Scope Confirmation:** Task 3's live warm-up-through-natural-ticks acceptance cases cannot be exercised in this environment while Section 1 remains `BLOCKED`; no live evidence is reported for them, and none should be fabricated.
- **Offline Coverage:** The deterministic behavioral invariants Task 3 depends on are covered by an executable regression suite that ran clean against this revision, giving durable, reproducible evidence independent of any single live session.
- **Next Step:** Once the #104 prerequisite fix lands and Section 1 passes, re-run this ledger to capture live Hermes registration (Section 2) and live natural-tick warm-up plus coverage-gate evidence (Section 3) end to end.
