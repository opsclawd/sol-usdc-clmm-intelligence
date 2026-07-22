# Design: Publish Persisted EvidenceBundle v1 to Regime Engine

## 1. Problem and Context

The `sol-usdc-clmm-intelligence` service generates evidence bundles and persists them via the `BundleRepo` (implemented in #26). The next step in the pipeline is to transmit these assembled canonical evidence bundles to the Regime Engine, which consumes them to synthesize final `PolicyInsight`s.

This issue (#13) requires a new use-case to load the already-persisted, schema-valid `EvidenceBundle v1`, and publish its exact canonical payload to Regime Engine's authenticated `/v1/evidence/sol-usdc` endpoint. Crucially, the publisher must strictly transmit the payload as-is, never rebuilding or enriching it, and record a detailed audit trail of every HTTP publish attempt in the `PublishAttemptRepo` while respecting determinism, idempotency, and bounded retries.

## 2. Key Design Decisions and Trade-offs

### 2.1 Extending `HttpClient` for Auditability

**Context:** The current `HttpClient` only exposes `getJson`, which throws an `HttpRequestError` on non-2xx responses and automatically retries internally.
**Decision:** We will introduce a new method on `HttpClient`: `postJsonRaw(url: string, body: unknown, options?: HttpRequestOptions): Promise<HttpResponse>`, returning a wrapper `{ status, ok, body, headers }` rather than throwing on 4xx/5xx HTTP errors.
**Rationale:** The publisher needs exact visibility into HTTP status codes and response bodies for every attempt to persist an accurate audit trail. If the HTTP client threw redacted errors or retried internally, we would lose the bounded response body and skip logging intermediate failed attempts.
**Trade-off:** Adds slight complexity to `FetchHttpClient` implementation, but correctly separates transport-level errors (network resets, timeouts) from application-level HTTP responses.

### 2.2 Retry Orchestration location

**Context:** Bounded retries (1 initial + 2 retries) are required for transient failures (timeouts, 5xx, 429).
**Decision:** The retry loop will be orchestrated locally within the `PublishEvidenceBundle` application use case, rather than inside the `HttpClient`.
**Rationale:** The requirements mandate recording an audit row in `PublishAttemptRepo` for _every_ logical/HTTP attempt (including attempt numbers and intermediate network failures). By lifting the retry loop into the use-case, we can seamlessly insert audit records at the end of each loop iteration.

### 2.3 Idempotency and Conflict Handling

**Context:** Concurrent triggers or network retries after unknown outcomes could create duplicate publishing.
**Decision:** We rely entirely on the exact `idempotencyKey` and `payloadHash` already baked into the persisted `EvidenceBundle`.
**Rationale:** A 409 Conflict implies the Regime Engine has received a payload for this idempotency key but the content differs. As per requirements, we treat this as a terminal failure. We do not attempt to mutate the payload to "fix" conflicts. 200 OK responses explicitly indicate successful idempotent replay.

## 3. Proposed Approach

### 3.1 Domain & Ports Updates

- **`HttpClient`:** Add `postJsonRaw<T = unknown>(url: string, body: unknown, options?: HttpRequestOptions): Promise<{ status: number; ok: boolean; body: T }>` (with timeout enforcement).
- **Configuration:** Use `EnvReader` to extract `REGIME_ENGINE_BASE_URL` and `REGIME_ENGINE_AUTH_TOKEN`. If missing, the cron/job fails to start.

### 3.2 Application Use Case: `PublishEvidenceBundle`

**Dependencies:** `BundleRepo`, `PublishAttemptRepo`, `HttpClient`, `EnvReader`, `Clock`
**Input:** `evidenceBundleId: number` (or pair symbol to fetch latest).

**Execution Flow:**

1. **Load:** Retrieve the bundle via `BundleRepo`. If the bundle is not found, throw.
2. **Local Schema Validation:** Check that `bundle.schemaVersion === "evidence-bundle.v1"`. If it does not match, log a terminal error and insert a `validation_failed` attempt into `PublishAttemptRepo` (without making a network request) and halt.
3. **HTTP Attempt Loop (Max 3 attempts):**
   - **Prepare Request:** Construct the target endpoint (e.g., `${REGIME_ENGINE_BASE_URL}/v1/evidence/sol-usdc`). Set `Authorization: Bearer <token>` and `Idempotency-Key: <bundle.idempotencyKey>`.
   - **Execute:** Call `HttpClient.postJsonRaw` with a 5000ms timeout and `maxAttempts: 1` (disabling internal HTTP retries).
   - **Evaluate Outcome:** Map the outcome to `PublishAttemptStatus`:
     - `201` -> `created` (Success, terminal)
     - `200` -> `idempotent_replay` (Success, terminal)
     - `400`, `422` -> `validation_failed` (Terminal)
     - `401`, `403` -> `auth_failed` (Terminal)
     - `409` -> `conflict` (Terminal)
     - `429`, `500-599` -> `network_failed` (Retryable)
     - `Timeout / Fetch Network Error` -> `network_failed` (Retryable)
   - **Audit Persistence:** Insert a row via `PublishAttemptRepo` detailing the exact `httpStatus`, `responseBody` (bounded), and attempt number.
   - **Backoff:** If the outcome is retryable and `attempt < 3`, apply exponential backoff + jitter and continue the loop. Otherwise, halt.

## 4. Assumptions

- **Payload Strictness:** It is assumed the payload stored in `BundleRepo.payload` is already fully canonical and matches the structure expected by Regime Engine #59. The publisher will literally send `JSON.stringify(bundle.payload)`.
- **Response Bounds:** It is assumed that bounding the captured response body to ~10KB is sufficient for debugging and fits within the `PublishAttemptRepo.responseBody` column without issues.
- **Null Research Briefs:** It is assumed the endpoint correctly accepts empty strings or omitted fields for contextual evidence if `researchBrief` is null.
- **Idempotency Key:** It is assumed `bundle.idempotencyKey` is a deterministic string suitable for standard HTTP Idempotency-Key headers.
- **Audit Persistence Append-Only:** `PublishAttemptRepo` appears append-only. We assume we insert a new row for every completed HTTP attempt.
- **Contract artifacts missing:** The issue stated to update the issue body with specific commit hashes and schema references before enqueuing, but this was omitted. We assume "evidence-bundle.v1" as the pinned schema based on the instructions.

## 5. Scope

**In Scope:**

- Expanding `HttpClient` to support POST with robust, bounded body capture.
- `PublishEvidenceBundle` application use case.
- `EnvReader` logic for `REGIME_ENGINE_BASE_URL` and `REGIME_ENGINE_AUTH_TOKEN`.
- Mapping HTTP outcomes to terminal/retryable semantics and recording via `PublishAttemptRepo`.
- Structured logging and observability for each lifecycle event.
- Test coverage for all HTTP error scenarios, retries, and bounded body capture.

**Out of Scope:**

- Generation, mutation, enrichment, or synthesis of any evidence or research brief.
- Publishing `PolicyInsight` directly.
- Defining the `evidence_bundles` or `publish_attempts` Drizzle schemas (already handled in #21 and #26).
- Indefinite job-level retries (capped at 3 network-level attempts during the publish cycle).

## 6. Risks and Concerns

- **JSON Serialization Limits**: The payload sizes might be significant, we need to ensure that the memory limits are well managed.
- **Leaking Secrets in Logs/DB**: HTTP response body capturing must avoid logging or persisting anything sensitive from the Regime Engine response.
- **HttpClient implementation complexity**: Bypassing or disabling the automatic retries in `fetch-http.ts` could be error-prone. The `postJsonRaw` must be completely free of implicit retries to guarantee 1-to-1 mapping with `publish_attempts`.
