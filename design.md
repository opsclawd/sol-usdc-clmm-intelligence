# Regime Engine Evidence Publish Attempts Design

## The Problem and Why It Matters

Issue #13 requires recording publish attempts of evidence bundles to the Regime Engine. This implies tracking HTTP response statuses, idempotency, retries, and errors. Because the pipeline is append-oriented and asynchronous, evidence generation and publishing happen independently. Tying the persistence of publish outcomes directly to `evidence_bundles` or `research_briefs` via database foreign keys would force strict write ordering, violating the principle of eventual consistency in this audit pipeline.

Therefore, we need a dedicated `publish_attempts` persistence layer that durably records HTTP outcomes while logically referencing (but not enforcing a DB-level constraint on) the underlying evidence.

## Assumptions

1. **Taxonomy Expansion:** `PublishAttemptStatus` is not currently defined in `src/contracts/taxonomy.ts` and does not need to be added to the central taxonomy for this persistence slice. The canonical list of statuses (`pending`, `sent`, etc.) will be defined purely as a DB-level `CHECK` constraint and in the repo port's typings, isolating it within the publish domain.
2. **Append-Only Rows:** Because this is an audit-oriented pipeline, we will adopt a **one-row-per-HTTP-attempt** model (append-only) rather than mutating a single row on retry.
3. **Uniqueness:** To satisfy the requirement of not preventing `attempt_number > 1` in an append-only model, the unique constraint will be `(target, idempotency_key, attempt_number)`. This perfectly fits the one-row-per-HTTP-attempt design.
4. **Idempotency Key Scope:** The `idempotency_key` identifies the logical publish workflow. If an HTTP request fails, the retry will insert a new row with the same `idempotency_key`, but a higher `attempt_number`.
5. **No FK Strictness:** It is explicitly intended that a `publish_attempt` might arrive via replay before its referenced `evidence_bundle` is inserted.

## Key Design Decisions & Trade-Offs

- **No Foreign Keys:** We are deliberately omitting standard SQL `FOREIGN KEY` constraints on `evidence_bundle_id` and `research_brief_id`.
  - _Trade-off:_ Orphaned publish attempts could technically exist in the DB.
  - _Mitigation:_ The application logic handles reference resolution at read/publish time. We prioritize robust ingestion/replay ordering over referential integrity.
- **Append-Only Audit (Attempt Numbering):** We could have tracked retries by mutating a single row per `idempotency_key`. However, mutating rows destroys historical audit trails of exactly when an HTTP 500 occurred vs. when it succeeded. Storing a row per attempt preserves full fidelity.
- **JSONB for Response:** `response_body` is kept as `JSONB`. The Regime Engine might return complex error payloads (e.g. detailed contract rejection reasons) that we should not forcefully typecast immediately.

## Proposed Approach

1. **Schema Definition (`src/db/schema/publish-attempts.ts`)**
   - Create the `publish_attempts` table under the `intelligence` Drizzle schema.
   - Core fields as requested (`id`, `target`, `evidence_bundle_id`, `idempotency_key`, `status`, etc.).
   - Constraints:
     - `CHECK (status IN ('pending', 'sent', 'created', 'idempotent_replay', 'validation_failed', 'auth_failed', 'conflict', 'store_unavailable', 'network_failed', 'unknown_failed'))`
     - `CHECK (http_status IS NULL OR (http_status >= 100 AND http_status <= 599))`
     - `CHECK (attempt_number > 0)`
   - Indexes:
     - `idx_pub_attempt_bundle` on `evidence_bundle_id`.
     - `idx_pub_attempt_brief` on `research_brief_id`.
     - `idx_pub_attempt_status_recency` on `(status, received_at_unix_ms)`.
     - `uniq_pub_attempt_idem` on `(target, idempotency_key, attempt_number)`.

2. **Repository Port (`src/ports/publish-attempt-repo.ts`)**
   - Exposes standard typings for the persistence slice.
   - Capabilities: `insert(row)`, `findByTargetAndKey(target, key)`, `findByBundle(bundleId)`, `findRecentByStatus(status, sinceMs)`.

3. **Drizzle Adapter (`src/adapters/node/drizzle-publish-attempt-repo.ts`)**
   - Implements the port over Drizzle.
   - Employs `ON CONFLICT DO NOTHING` for idempotency collisions (if duplicate `attempt_number` is submitted by a race condition), returning an outcome object (`"inserted" | "conflict"`).

4. **Testing & Fakes**
   - Add `FakePublishAttemptRepo` to in-memory fakes.
   - Comprehensive vitest suite proving: no-FK insertion, retry numbering, constraint validation, and lookup filtering.

## In Scope vs. Out of Scope

**In Scope:**

- Drizzle schema definition and generated migrations.
- TypeScript port definition and types.
- Node.js Drizzle adapter.
- Fake in-memory adapter.
- Unit and integration tests.
- Documentation explaining the missing FKs.

**Explicitly Out of Scope:**

- Building the HTTP publisher client.
- Mapping our domain evidence to the Regime Engine contract payload.
- Altering the shape of existing evidence/brief tables.
- Adding specific retry backoff algorithms.

## Identified Risks & Concerns

1. **Dangling References in App Layer:** Since we rely on logical application references without FKs, the application code querying these tables must defensively handle cases where `evidence_bundles.id` is not yet available, ensuring that workflows do not violently crash if queried too soon.
2. **Payload Hash Strictness:** If the Regime Engine response changes frequently, storing full response bodies might balloon the table size over time. We will want aggressive cold-tier expiry (as mentioned in architecture docs: cold retention gating) for older publish attempts.
