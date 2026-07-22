# Task Context: Task 2

Title: Implement local validation, terminal response mapping, and attempt auditing (single-shot, retry stub)

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-13
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-13
Start Commit: 6abbf0c97574a6b795be47dfb1e295226f6085bf

## Task Requirements

**Files:**

- Create: `src/application/publish-evidence-bundle.ts`
- Create: `tests/application/publish-evidence-bundle.test.ts`

**Signature changes:** Add exported `PublishEvidenceBundleDeps` (with optional `retry?: RetryControl`), `PublishEvidenceBundleConfig`, `PublishEvidenceBundleEvent`, `PublishEvidenceBundleResult`, and `publishEvidenceBundle`. These are new application API declarations; later callers must use these exact names. `retry` is optional here to allow single-shot tests to compile; Task 3 makes it required and implements the retry loop.

- [ ] Write the named invariant tests first: `local invalid never sends and audits validation_failed`, `exact persisted payload and identity are sent unchanged`, `201 audits created and terminates`, `200 audits idempotent replay and terminates`, `400 and 422 audit validation_failed without retry`, `401 and 403 audit auth_failed without retry`, `409 audits conflict without retry`, `other permanent 4xx audit unknown_failed without retry`, `audit insert completes before terminal outcome is returned`, `deterministic-only null-brief fixture publishes unchanged`, and `response secrets are redacted before audit persistence`.
- [ ] Define a discriminated result with success outcomes `created | idempotent_replay` and failure outcomes `bundle_not_found | local_validation_failed | validation_failed | auth_failed | conflict | permanent_http_failed | audit_store_failed`; include bundle ID/attempt count where available, but never token/config secrets.
- [ ] Load `REGIME_ENGINE_BASE_URL` and `REGIME_ENGINE_AUTH_TOKEN` through `EnvReader.get`. Normalize one trailing slash, reject URL credentials and non-HTTP(S) protocols, and construct only `/v1/evidence/sol-usdc`. Never place the token in events, errors, or results.
- [ ] Select `findLatestByPair("SOL/USDC")`. Validate `schemaVersion`, call `contract.validateCanonicalizeAndHash(bundle.payload)`, and compare returned `payloadCanonical`, `payloadHash`, and `idempotencyKey` with every stored field. This is verification only: transmit `bundle.payload`, not the contract return payload and not `JSON.parse(bundle.payloadCanonical)`.
- [ ] For an identified malformed row, insert attempt 1 with `validation_failed`, null HTTP status, bounded/redacted diagnostic data, `requestHash === payloadHash`, and completed timestamps. For a missing row, emit/return `bundle_not_found` without fabricating an audit identity.
- [ ] Send one request with `Authorization: Bearer <token>`, `Idempotency-Key`, 5,000 ms timeout, and `maxAttempts: 1`; classify statuses per the invariants and insert the completed audit row before returning. Store at most the already-bounded response, recursively replacing values under keys matching `authorization|token|secret|api[-_]?key` with `[REDACTED]`.
- [ ] Treat `PublishAttemptRepo.insert().outcome === "conflict"` and thrown insert errors as `audit_store_failed`; emit the safe `audit_persistence_failed` event and never claim the HTTP outcome succeeded.
- [ ] The retry field is declared optional in `PublishEvidenceBundleDeps`; when absent or when the single-shot test path is taken, no retry delay is invoked and the single attempt is terminal.
- [ ] Run:

  ```bash
  pnpm vitest run tests/application/publish-evidence-bundle.test.ts -t 'local invalid|persisted payload|201|200|400|422|401|403|409|permanent|deterministic-only|redacted'
  pnpm exec eslint src/application/publish-evidence-bundle.ts tests/application/publish-evidence-bundle.test.ts --max-warnings 0
  ```

- [ ] Commit: `git add src/application/publish-evidence-bundle.ts tests/application/publish-evidence-bundle.test.ts && git commit -m "feat: publish and audit persisted evidence bundles"`

## Repository Targets

### Expected Files

- src/application/publish-evidence-bundle.ts
- tests/application/publish-evidence-bundle.test.ts

## Validation Commands

```bash
pnpm vitest run tests/application/publish-evidence-bundle.test.ts -t 'local invalid|persisted payload|201|200|400|422|401|403|409|permanent|deterministic-only|redacted'
pnpm exec eslint src/application/publish-evidence-bundle.ts tests/application/publish-evidence-bundle.test.ts --max-warnings 0
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **local-invalid-never-sends**: Missing or locally inconsistent bundles never cause HTTP; an identified invalid row receives one validation_failed audit row. (Test: `local invalid never sends and audits validation_failed`)
- **exact-persisted-payload-and-identity**: The request uses the selected row's payload object, verified hash, and idempotency key without reconstruction. (Test: `exact persisted payload and identity are sent unchanged`)
- **created-and-replay-terminate-successfully**: 201 maps to created and 200 maps to idempotent_replay, with one completed audit before return. (Test: `201 audits created and terminates`)
- **permanent-http-failures-do-not-retry**: Validation, auth, conflict, and other permanent 4xx responses are audited once and terminate. (Test: `400 and 422 audit validation_failed without retry`)
- **audit-before-terminal-transition**: No success or terminal HTTP result is returned until its immutable audit insert succeeds. (Test: `audit insert completes before terminal outcome is returned`)
- **secret-free-audit**: Secret-like response properties are redacted and the bearer token never enters persisted or emitted data. (Test: `response secrets are redacted before audit persistence`)
