# Task Context: Task 8

Title: Orchestrate raw-first collection and replay state transitions

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-22
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-22
Start Commit: 354e656925912cc7e58de7220277b1694b69286d

## Task Requirements

**Files:**

- Modify: `src/application/collect-clmm-bundle.ts`
- Modify: `tests/application/collect-clmm-bundle.test.ts`
- Modify: `tests/fakes/fake-json-store.ts`

**Behavioral invariants to test first:**

- `successful collection orders raw insert normalized batch parsed status then latest file write` enforces the durable boundary.
- `malformed input persists neither raw nor normalized data` distinguishes rejection from accepted processing failure.
- `identical parsed replay skips normalization and refreshes the latest file` implements the parsed replay path.
- `identical pending or failed replay normalizes from stored canonical payload` implements recovery without trusting the response object.
- `conflicting replay throws ClmmObservationConflictError with identity and both hashes` fails closed without overwrite or file write.
- `normalization or normalized batch failure preserves raw and marks failed before rethrowing the original error` preserves audit evidence and error causality.
- `status failure after normalized commit fails and safely replays idempotently later` covers the commit/status crash window.
- `latest file failure leaves parsed raw and normalized rows durable and an identical replay repairs the file` defines dual-write recovery.
- `request metadata contains only method path wallet hash and versions and never API key or headers` protects secrets.

- [ ] **Step 1: Replace the current application tests with fixture-based tests for the exact named invariants above plus environment/base-URL behavior.** Extend `FakeJsonStore` with a configurable write error; use repo fakes and a deterministic `FakeClock`. Assert event ordering via small callbacks/log arrays rather than implementation-private state.
- [ ] **Step 2: Run `pnpm vitest run tests/application/collect-clmm-bundle.test.ts` and confirm the new persistence/replay tests fail.**
- [ ] **Step 3: Expand `CollectClmmBundleDeps` with `clock`, `rawObservationRepo`, and `normalizedObservationRepo`; add `CollectClmmBundleResult` and typed `ClmmObservationConflictError`.** Keep `EnvReader` for optional `INTELLIGENCE_CODE_VERSION` (fallback `development`) and `INTELLIGENCE_PIPELINE_RUN_ID` (fallback `null`). Parse `Clock.now()` with `Date.parse` at explicit fetch/receive/derive boundaries; reject non-finite clock values.
- [ ] **Step 4: Implement the state machine exactly:** accept response; canonicalize; derive wallet identity and redacted request metadata; `insertOrClassify`; reject conflict; skip normalization only for parsed replay; otherwise reload and parse `row.payloadCanonical`, validate with `acceptClmmBundle` (the unwrapped bundle validator, not the envelope validator), map/enrich, `insertMany`, then update parsed; on mapping/enrichment/batch error best-effort update failed and rethrow original; finally write the compatibility file only after parsed/skip success.
- [ ] **Step 5: Return `{ rawObservationId, rawOutcome, normalizedCount, parseStatus }`.** A parsed replay reports zero newly normalized records; pending/failed replay reports the batch size even when rows were already present from a prior commit/status failure.
- [ ] **Step 6: Rerun the focused application test, then run `pnpm exec eslint src/application/collect-clmm-bundle.ts tests/application/collect-clmm-bundle.test.ts tests/fakes/fake-json-store.ts --max-warnings 0` and `pnpm exec prettier --check src/application/collect-clmm-bundle.ts tests/application/collect-clmm-bundle.test.ts tests/fakes/fake-json-store.ts`.**
- [ ] **Step 7: Commit:** `git add src/application/collect-clmm-bundle.ts tests/application/collect-clmm-bundle.test.ts tests/fakes/fake-json-store.ts && git commit -m "feat(clmm): persist and replay raw-first collection"`.

## Repository Targets

### Expected Files

- src/application/collect-clmm-bundle.ts
- tests/application/collect-clmm-bundle.test.ts
- tests/fakes/fake-json-store.ts

## Validation Commands

```bash
pnpm vitest run tests/application/collect-clmm-bundle.test.ts
pnpm exec eslint src/application/collect-clmm-bundle.ts tests/application/collect-clmm-bundle.test.ts tests/fakes/fake-json-store.ts --max-warnings 0
pnpm exec prettier --check src/application/collect-clmm-bundle.ts tests/application/collect-clmm-bundle.test.ts tests/fakes/fake-json-store.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **raw-first success order**: Raw commit precedes normalized batch, parsed status, and latest compatibility write. (Test: `successful collection orders raw insert normalized batch parsed status then latest file write`)
- **rejected input durability**: A malformed response is never accepted into raw or normalized storage. (Test: `malformed input persists neither raw nor normalized data`)
- **parsed replay transition**: An identical parsed observation skips normalization and may refresh the compatibility file. (Test: `identical parsed replay skips normalization and refreshes the latest file`)
- **replay from persisted evidence**: Pending and failed replays normalize only the canonical payload reloaded from the raw row. (Test: `identical pending or failed replay normalizes from stored canonical payload`)
- **collector conflict failure**: A conflicting replay fails with identity and both hashes without overwrite, normalization, or file write. (Test: `conflicting replay throws ClmmObservationConflictError with identity and both hashes`)
- **normalization failure transition**: An accepted row survives normalization or batch failure and is best-effort marked failed while the original error is rethrown. (Test: `normalization or normalized batch failure preserves raw and marks failed before rethrowing the original error`)
- **post-commit status recovery**: Status failure after normalized commit leaves idempotently replayable normalized rows and reports failure. (Test: `status failure after normalized commit fails and safely replays idempotently later`)
- **compatibility file recovery**: A file failure cannot undo DB durability and a parsed replay can repair the file. (Test: `latest file failure leaves parsed raw and normalized rows durable and an identical replay repairs the file`)
- **redacted audit metadata**: Request metadata contains useful versions and wallet hash but no secret header or API key. (Test: `request metadata contains only method path wallet hash and versions and never API key or headers`)
