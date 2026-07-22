<!-- plan-review-required -->

# Persisted EvidenceBundle v1 Publisher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load the latest persisted canonical SOL/USDC `EvidenceBundle v1`, validate its stored identity without rebuilding it, publish the exact stored payload to Regime Engine, and append an auditable row for every local or HTTP attempt with bounded retry behavior.

**Architecture:** Extend the outbound HTTP port with a single-attempt raw POST operation whose timeout covers fetch and bounded body reading. Add an application use case that owns validation, status mapping, audit persistence, idempotency, retry/backoff, and structured lifecycle events; keep the job and CLI as thin Node wiring. Reuse the pinned contract at `schemas/regime-engine/evidence-bundle.v1/` and the existing `EvidenceBundleRepo`, `PublishAttemptRepo`, `EnvReader`, and `Clock` ports.

**Tech Stack:** TypeScript 5.7, Node fetch/AbortController, Vitest, Drizzle/Postgres repository ports, AJV-backed EvidenceBundle contract, pnpm.

---

## Goal

Provide a fail-closed `pnpm publish:evidence` path that selects the latest persisted `SOL/USDC` bundle, proves its stored schema/hash/canonical/idempotency identity still matches the pinned `evidence-bundle.v1` contract, POSTs `bundle.payload` unchanged to `/v1/evidence/sol-usdc`, and reports created, replayed, permanent-failure, exhausted-retry, and audit-store-failure outcomes without exposing the auth token.

## Non-goals

- Do not assemble, enrich, normalize, recanonicalize for transmission, or otherwise mutate evidence.
- Do not call collectors, feature calculators, LLMs, research-brief generators, legacy final-insight endpoints, or execution systems.
- Do not add a new evidence schema, duplicate Regime Engine's contract, or change bundle/publish-attempt database schemas.
- Do not add indefinite scheduler retries or automatically publish every historical bundle.
- Do not interpret Regime Engine responses as policy decisions.

## Contract assumptions and preconditions

- The pinned schema source is Regime Engine commit `ff821935acf7d7ce2844b9d667bea0bcc6f98ce8`, schema path `contracts/evidence-bundle/v1/evidence-bundle.schema.json`, version `evidence-bundle.v1`, and SHA-256 `0146b073cc607b47e52c615f6299294b1fd8f133d8a4b128bd2a95dc20f77b17`, as recorded in `schemas/regime-engine/evidence-bundle.v1/provenance.json`.
- The endpoint is `${REGIME_ENGINE_BASE_URL}/v1/evidence/sol-usdc`; bearer authentication and `Idempotency-Key` are assumed to be the merged #59 wire requirements described by `issue.md` and `design.md`.
- Selection is deliberately `EvidenceBundleRepo.findLatestByPair("SOL/USDC")`; no new repository method is needed. A missing row is visible as a terminal invocation failure but cannot create an audit row because no bundle identity exists.
- `requestHash` equals the verified persisted `payloadHash`: the request entity is exactly the stored payload, with no envelope or enrichment.
- `researchBriefId` remains `null`; the canonical payload may contain `researchBrief: null`, but there is no persisted brief-row ID on `EvidenceBundleRow`.

## Affected files

- `src/ports/http.ts` — raw POST request/response contract.
- `src/ports/retry.ts` — injectable sleep and jitter port (introduced in Task 1 so Task 2 can reference it as optional).
- `src/ports/index.ts` — port exports.
- `src/adapters/node/fetch-http.ts` — one-shot POST, lifecycle timeout, bounded body capture.
- `src/adapters/node/system-retry.ts` — production sleep/random implementation.
- `src/adapters/node/composition-root.ts` — expose retry control through `NodeRuntime`.
- `src/application/publish-evidence-bundle.ts` — publisher state machine, validation, mapping, auditing, retry policy (optional retry in Task 2, required in Task 3), and event types.
- `src/jobs/publish-evidence-bundle-job.ts` — thin job wrapper.
- `src/jobs/index.ts` — job export.
- `scripts/collectors/publish-evidence-bundle.ts` — CLI/runtime composition and operator-safe output.
- `tests/fakes/fake-http.ts` — programmable raw POST fake.
- `tests/fakes/fake-retry.ts` — deterministic sleep/jitter fake.
- `tests/fakes/index.ts` — fake export.
- `tests/adapters/node/fetch-http.test.ts` — POST adapter contract cases.
- `tests/application/publish-evidence-bundle.test.ts` — publisher transition and audit cases.
- `tests/scripts/publish-evidence-bundle.test.ts` — CLI wiring, exit, and redaction cases.
- `package.json` — `publish:evidence` command.
- `.env.example` — Regime Engine URL/token configuration.
- `README.md` — current publisher capability and boundary.
- `docs/operator-runbook.md` — configuration, outcomes, audit queries, and recovery.

## Behavioral invariants

1. `local-invalid-never-sends`: when the selected row is missing, has an unsupported schema version, fails pinned validation, or disagrees with its stored canonical text/hash/idempotency key, no HTTP request occurs; identified rows receive exactly one `validation_failed` audit attempt.
2. `exact-persisted-payload-and-identity`: every network attempt passes the same `bundle.payload` object, `payloadHash`, and `idempotencyKey`; retries never rebuild or mutate them.
3. `created-and-replay-terminate-successfully`: HTTP 201 becomes `created`; HTTP 200 becomes `idempotent_replay`; each writes one completed audit row and stops.
4. `permanent-http-failures-do-not-retry`: 400/422 become `validation_failed`, 401/403 become `auth_failed`, 409 becomes `conflict`, and other permanent 4xx become `unknown_failed`; each is audited once and terminates.
5. `transient-failures-retry-at-most-three-total-attempts`: transport timeout/network errors, 408, 429, and 5xx become `network_failed`; after audit insertion they transition to delay then the next attempt, never beyond attempt 3.
6. `retry-delay-is-bounded`: exponential delay plus injected jitter, or a valid `Retry-After`, is clamped to the documented maximum; tests never depend on wall-clock randomness.
7. `audit-before-transition`: the use case does not return success, schedule a retry, or return terminal HTTP failure until the corresponding audit insert succeeds.
8. `audit-failure-stops-publication`: a thrown insert or attempt-identity conflict becomes visible `audit_store_failed` and prevents any later retry, because continuing would create unaudited attempts.
9. `concurrent-duplicate-is-not-silent`: Regime Engine receives the stable idempotency key; if concurrent publishers collide on the audit identity, one stored attempt wins and the loser emits/returns an audit conflict rather than claiming success.
10. `secret-free-observability`: lifecycle events and CLI output include bundle ID, attempt, status, and endpoint target but never the bearer token; captured response data is bounded and recursively redacts secret-like keys.

## Task 1: Add single-attempt bounded raw POST HTTP operation and RetryControl port

**Files:**

- Modify: `src/ports/http.ts`
- Modify: `src/ports/index.ts`
- Modify: `src/adapters/node/fetch-http.ts`
- Modify: `tests/fakes/fake-http.ts`
- Modify: `tests/adapters/node/fetch-http.test.ts` (only add a new `postJsonRaw` describe block; do not rewrite existing GET cases)
- Create: `src/ports/retry.ts`
- Create: `src/adapters/node/system-retry.ts`
- Create: `tests/fakes/fake-retry.ts`
- Modify: `tests/fakes/index.ts`
- Modify: `src/adapters/node/composition-root.ts`

**Signature changes:** `HttpClient` gains required `postJsonRaw<T>()`; new exported `HttpResponse<T>` describes status, `ok`, bounded parsed-or-text body, and normalized headers. `RetryControl` port and both production/fake implementations are introduced so `PublishEvidenceBundleDeps` can reference it as optional from Task 2 onward.

- [ ] Write failing adapter tests named `postJsonRaw sends one JSON POST with caller headers and no implicit retry`, `postJsonRaw returns non-2xx status body and headers without throwing`, `postJsonRaw bounds UTF-8 response capture to 10240 bytes`, `postJsonRaw timeout covers response body reading`, and `postJsonRaw converts fetch and body-read transport failures to HttpRequestError`. Assert `method: "POST"`, `Content-Type: application/json`, caller authorization/idempotency headers, one fetch call even for 429/503, and a fresh abort signal.
- [ ] Define the port shape before implementation:

  ```ts
  export interface HttpResponse<T = unknown> {
    readonly status: number;
    readonly ok: boolean;
    readonly body: T;
    readonly headers: Readonly<Record<string, string>>;
  }

  export interface HttpClient {
    getJson<T>(url: string, options?: HttpRequestOptions): Promise<T>;
    postJsonRaw<T = unknown>(
      url: string,
      body: unknown,
      options?: HttpRequestOptions
    ): Promise<HttpResponse<T>>;
  }
  ```

- [ ] Implement `postJsonRaw` as exactly one fetch call. Start one timeout before fetch and clear it only after bounded body reading; read at most 10,240 UTF-8 bytes from the response stream, cancel the reader after the bound, parse complete valid JSON and otherwise retain text, normalize response headers, return all HTTP statuses, and throw `HttpRequestError` only for timeout/network/body-read transport failures. Do not reuse the GET retry loop.
- [ ] Extend `FakeHttp` with queued POST responses/errors and call records that retain the exact body reference and options; keep existing GET behavior compatible.
- [ ] Add `RetryControl` injectable port and implementations:

  ```ts
  export interface RetryControl {
    sleep(ms: number): Promise<void>;
    jitterUnit(): number; // finite value in [0, 1]
  }
  ```

  `SystemRetryControl` uses `setTimeout` and `Math.random`; `FakeRetry` records delays and returns queued jitter values.

- [ ] Wire `RetryControl` into `NodeRuntime`; export both `RetryControl` and `SystemRetryControl` from their respective index files.
- [ ] Run the scoped tests and inspect only the new section:

  ```bash
  pnpm vitest run tests/adapters/node/fetch-http.test.ts -t postJsonRaw
  sed -n '/describe("postJsonRaw"/,/^  });/p' tests/adapters/node/fetch-http.test.ts
  ```

- [ ] Commit: `git add src/ports/http.ts src/ports/index.ts src/ports/retry.ts src/adapters/node/fetch-http.ts src/adapters/node/system-retry.ts src/adapters/node/composition-root.ts tests/fakes/fake-http.ts tests/fakes/fake-retry.ts tests/fakes/index.ts tests/adapters/node/fetch-http.test.ts && git commit -m "feat: add auditable raw JSON POST transport and RetryControl port"`

## Task 2: Implement local validation, terminal response mapping, and attempt auditing (single-shot, retry stub)

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

## Task 3: Add deterministic bounded retry transitions and make retry required

**Files:**

- Modify: `src/application/publish-evidence-bundle.ts`
- Modify: `tests/application/publish-evidence-bundle.test.ts` (only add retry/audit/concurrency describe blocks)
- Modify: `src/adapters/node/composition-root.ts` (only if needed for retry wiring changes)

**Signature changes:** Change `retry` in `PublishEvidenceBundleDeps` from optional to required; extend the existing exported publisher result/event unions with retry exhaustion and scheduling variants. The `RetryControl` port, `SystemRetryControl`, and `FakeRetry` are already introduced in Task 1.

- [ ] Write failing tests named `transient failures retry at most three total attempts`, `unknown outcome retries reuse exact key hash and payload`, `retry delay is bounded and deterministic`, `valid Retry-After is honored within maximum`, `invalid or excessive Retry-After falls back or clamps`, `audit occurs before every retry delay`, `audit failure stops publication before another request`, `exhausted transient failure is terminal and observable`, and `concurrent duplicate audit conflict is not reported as success`.
- [ ] Replace the single HTTP action with attempts 1..3. Retry only `HttpRequestError` timeout/network, 408, 429, and 500..599. After each failed request, persist `network_failed`; only after successful audit emit `retry_scheduled`, sleep, and transition to the next attempt. On attempt 3 return `transient_failure_exhausted`.
- [ ] Use base delay 250 ms, exponential factors 1 and 2, jitter up to 250 ms, and a hard 2,000 ms sleep cap. Parse `Retry-After` as non-negative delta-seconds or an HTTP date relative to `Clock`; clamp it to 2,000 ms. Invalid/missing values use exponential+jitter.
- [ ] Keep one immutable request context outside the loop (payload reference, verified hash, idempotency key, endpoint, safe target), and create timestamps/attempt rows inside the loop. Emit `publish_started`, `retry_scheduled`, `created`, `idempotent_replay`, classified terminal failure, `transient_failure_exhausted`, and `audit_persistence_failed` events.
- [ ] Run only the newly added behavior groups:

  ```bash
  pnpm vitest run tests/application/publish-evidence-bundle.test.ts -t 'retry|Retry-After|audit failure|exhausted|concurrent'
  pnpm exec eslint src/application/publish-evidence-bundle.ts tests/application/publish-evidence-bundle.test.ts --max-warnings 0
  ```

- [ ] Commit: `git add src/application/publish-evidence-bundle.ts tests/application/publish-evidence-bundle.test.ts && git commit -m "feat: bound evidence publish retries"`

## Task 4: Wire the publisher job and operator CLI

**Files:**

- Create: `src/jobs/publish-evidence-bundle-job.ts`
- Modify: `src/jobs/index.ts`
- Create: `scripts/collectors/publish-evidence-bundle.ts`
- Create: `tests/scripts/publish-evidence-bundle.test.ts`
- Modify: `package.json`
- Modify: `.env.example`

**Signature changes:** Add exported `PublishEvidenceBundleJobDeps`, `PublishEvidenceBundleJobResult`, and `publishEvidenceBundleJob`. No existing exported signature is changed.

- [ ] Write failing script tests named `publisher CLI wires latest bundle persistence contract HTTP clock retry and env`, `created and replay exit zero with redacted JSON`, `terminal publish failure exits nonzero`, `audit store failure exits nonzero and is visible`, `missing Regime configuration fails before HTTP`, `database connection closes on every outcome`, and `auth token never appears in stdout stderr or serialized result`.
- [ ] Implement a thin job that invokes `publishEvidenceBundle` and preserves its discriminated result; it may add safe context to thrown initialization errors but must not retry the whole use case.
- [ ] Implement `runPublishEvidenceBundleScript(runtime)` to obtain persistence and contract, wire `runtime.http/env/clock/retry`, print each structured event as JSON, close the DB connection in `finally`, print one safe final result, and set exit code 0 only for `created`/`idempotent_replay`. Do not accept arbitrary endpoint, payload, or token CLI arguments.
- [ ] Add `"publish:evidence": "tsx scripts/collectors/publish-evidence-bundle.ts"` to `package.json`, plus blank `REGIME_ENGINE_BASE_URL` and `REGIME_ENGINE_AUTH_TOKEN` examples with comments in `.env.example`.
- [ ] Run:

  ```bash
  pnpm vitest run tests/scripts/publish-evidence-bundle.test.ts
  pnpm exec eslint src/jobs/publish-evidence-bundle-job.ts src/jobs/index.ts scripts/collectors/publish-evidence-bundle.ts tests/scripts/publish-evidence-bundle.test.ts --max-warnings 0
  pnpm exec prettier --check package.json .env.example
  ```

- [ ] Commit: `git add src/jobs/publish-evidence-bundle-job.ts src/jobs/index.ts scripts/collectors/publish-evidence-bundle.ts tests/scripts/publish-evidence-bundle.test.ts package.json .env.example && git commit -m "feat: expose evidence publisher CLI"`

## Task 5: Document deployment, observability, and operator recovery

**Files:**

- Modify: `README.md`
- Modify: `docs/operator-runbook.md`

- [ ] Update the current-state data-flow description to say intelligence publishes canonical evidence to Regime Engine and still never publishes final `PolicyInsight` or executes transactions.
- [ ] Add runbook sections containing the exact configuration names, `pnpm publish:evidence`, exit/outcome meanings, the three-attempt/2,000 ms retry bounds, and the fact that scheduler-level retries must remain bounded and operator-controlled.
- [ ] Add read-only audit queries for bundle ID/idempotency key, recent `validation_failed|auth_failed|conflict|network_failed|unknown_failed`, and exhausted attempt 3. Document recovery: correct auth/config for auth failures, correct upstream bundle assembly for local validation, investigate idempotency payload mismatch for conflict, and rerun unchanged identity only after transient/store recovery.
- [ ] Document notification behavior: nonzero exit plus structured terminal event is the repository's operator-visible mechanism; scheduled OpenClaw delivery should alert on that failure. State that logs and audit rows must never contain `REGIME_ENGINE_AUTH_TOKEN`.
- [ ] Run:

  ```bash
  pnpm exec prettier --check README.md docs/operator-runbook.md
  sed -n '/Evidence Bundle Publishing/,/^[#][#] /p' docs/operator-runbook.md
  ```

- [ ] Commit: `git add README.md docs/operator-runbook.md && git commit -m "docs: add evidence publishing runbook"`

## Tests to add or update

- Extend `tests/adapters/node/fetch-http.test.ts` only with a focused raw-POST block covering one-shot behavior, HTTP response visibility, byte bound, and response-body timeout.
- Add `tests/application/publish-evidence-bundle.test.ts` for all ten named invariants, exact deterministic fixture transmission, every response class, Retry-After, exhaustion, audit ordering/failure, and concurrency conflict visibility.
- Add `tests/scripts/publish-evidence-bundle.test.ts` for dependency wiring, configuration, exit codes, connection cleanup, event output, and secret redaction.
- Update fakes only where required by the new required port methods. No database repository contract or migration test should change because the existing row model is reused unchanged.

## Validation commands

The implement loop automatically runs `pnpm -r typecheck` after every task. After all implementation tasks, run these path-scoped checks in the dedicated validate phase (not as a standalone plan task):

```bash
pnpm vitest run tests/adapters/node/fetch-http.test.ts tests/application/publish-evidence-bundle.test.ts tests/scripts/publish-evidence-bundle.test.ts
pnpm exec eslint src/ports/http.ts src/ports/retry.ts src/ports/index.ts src/adapters/node/fetch-http.ts src/adapters/node/system-retry.ts src/adapters/node/composition-root.ts src/application/publish-evidence-bundle.ts src/jobs/publish-evidence-bundle-job.ts src/jobs/index.ts scripts/collectors/publish-evidence-bundle.ts tests/fakes/fake-http.ts tests/fakes/fake-retry.ts tests/fakes/index.ts tests/adapters/node/fetch-http.test.ts tests/application/publish-evidence-bundle.test.ts tests/scripts/publish-evidence-bundle.test.ts --max-warnings 0
pnpm exec prettier --check src/ports/http.ts src/ports/retry.ts src/ports/index.ts src/adapters/node/fetch-http.ts src/adapters/node/system-retry.ts src/adapters/node/composition-root.ts src/application/publish-evidence-bundle.ts src/jobs/publish-evidence-bundle-job.ts src/jobs/index.ts scripts/collectors/publish-evidence-bundle.ts tests/fakes/fake-http.ts tests/fakes/fake-retry.ts tests/fakes/index.ts tests/adapters/node/fetch-http.test.ts tests/application/publish-evidence-bundle.test.ts tests/scripts/publish-evidence-bundle.test.ts package.json .env.example README.md docs/operator-runbook.md
pnpm exec depcruise --config .dependency-cruiser.cjs src/ports/http.ts src/ports/retry.ts src/ports/index.ts src/adapters/node/fetch-http.ts src/adapters/node/system-retry.ts src/adapters/node/composition-root.ts src/application/publish-evidence-bundle.ts src/jobs/publish-evidence-bundle-job.ts src/jobs/index.ts
pnpm contract:evidence-bundle:check
```

Expected: all selected tests pass; lint/format/boundary checks exit 0; pinned contract assets report matching hashes. Do not perform a live publish as automated validation because it is an irreversible external side effect.

## P1 fix: RetryControl port moved before Task 2

The original plan introduced `RetryControl` in Task 3 as a required dependency of `PublishEvidenceBundleDeps`. Task 2's tests would not compile because they exercised `PublishEvidenceBundleDeps` before `retry` was defined. The fix moves `src/ports/retry.ts`, `src/adapters/node/system-retry.ts`, `tests/fakes/fake-retry.ts`, and the `RetryControl` wiring in `src/adapters/node/composition-root.ts` to Task 1. Task 2's `PublishEvidenceBundleDeps` declares `retry` as optional (`retry?: RetryControl`). Task 3 changes it to required and implements the retry loop. This preserves compile-ability at every task boundary.

## Risk areas

- A full-lifecycle timeout is easy to implement incorrectly if the timer is cleared immediately after headers; tests must stall body reading.
- Character slicing is not a byte bound for UTF-8. The adapter must bound bytes and avoid persisting partial invalid JSON as though it were parsed JSON.
- HTTP retries in both adapter and application would multiply attempts. `postJsonRaw` must always be one-shot even if `maxAttempts` is passed as 1 defensively.
- Audit uniqueness means concurrent invocations can both reach Regime Engine but cannot both claim the same `(target, idempotencyKey, attemptNumber)` row; idempotency protects the remote side and the losing local invocation must fail visibly.
- A remote success followed by audit-store failure is an unknown local outcome. Reruns must reuse the unchanged idempotency key so the remote returns replay rather than creating a duplicate.
- Response payloads and thrown errors can contain credentials. Bound, sanitize, and keep raw authorization headers out of result/event objects.
- `Retry-After` dates require the injected clock; invalid clock strings must fail closed instead of creating unbounded/negative delays.
- Sending canonical text instead of the persisted payload object, or using the validated return object, would violate the publisher-only boundary even if JSON is semantically equal.

## Stop conditions

Abort implementation and escalate instead of guessing if any of these occurs:

- The merged Regime Engine #59 contract requires a different path, auth scheme, idempotency header, request envelope, or success/conflict semantics than the pinned assumptions above.
- The local pinned schema provenance/hash check fails, or `evidence-bundle.v1` is no longer the supported ingest version.
- Publishing requires mutating/reassembling the persisted payload or generating a missing research brief.
- The existing `publish_attempts` uniqueness/column constraints cannot represent the required audit record without a migration; schema work belongs in a separately reviewed dependency change.
- Regime Engine cannot guarantee idempotency for unknown-outcome retries.
- Operator notification requires a real external paging connector rather than the repository's structured nonzero job failure; obtain explicit authority/configuration before adding an external side effect.
- A requested validation would send a real bundle to Regime Engine; use fakes or a separately authorized staging smoke test instead.
