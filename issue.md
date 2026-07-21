# feat: add publish attempt persistence for Regime Engine evidence publishing

## Summary

Add the persistence slice needed for future Regime Engine evidence publishing: a durable `publish_attempts` table plus repository port, Drizzle adapter, fake, tests, and docs.

This is intentionally **DB/audit only**. It does not implement the outbound HTTP publisher or Regime Engine contract mapping.

## Why

Issue #13 requires publish attempts to be recorded with response status and idempotency metadata. That is a separate persistence concern from evidence storage and should not be folded into `evidence_bundles` or `research_briefs`.

The intelligence database is an append-oriented evidence/audit pipeline. Records may be written or replayed out of order, and ingestion/publishing workflows must not depend on database-enforced insertion ordering across evidence, briefs, and publish outcomes.

## Persistence design decision: no foreign keys

Do **not** add database foreign-key constraints from `publish_attempts` to `evidence_bundles` or `research_briefs`.

Store `evidence_bundle_id` and nullable `research_brief_id` as logical application-level references with indexes.

Rationale:

- append-only evidence and audit records may arrive or be restored out of order;
- FK insertion ordering would couple independent batch/replay workflows;
- the pipeline favors durable raw/audit capture and eventual consistency over cross-table write ordering;
- application services can validate referenced records when available without rejecting an otherwise valid audit observation;
- no cascade behavior is appropriate for immutable historical evidence references.

This no-FK decision must be documented in the migration and persistence design notes so a later reviewer does not reintroduce the coupling accidentally.

## Scope

In scope:

- add `publish_attempts` in the `intelligence` schema;
- add Drizzle schema definition and migration/snapshot updates;
- add `PublishAttemptRepo` port;
- add Drizzle adapter and in-memory fake;
- add schema, port, adapter, fake, and migration tests;
- add docs/runbook notes for publish-attempt persistence and the no-FK decision.

Out of scope:

- outbound Regime Engine HTTP publishing;
- Regime Engine evidence-contract mapping;
- auth/retry workflow implementation beyond fields needed to record future outcomes;
- modifying existing evidence table shapes;
- source-specific tables.

## Required fields

`publish_attempts` must include at least:

- `id`;
- `target`;
- `target_endpoint`;
- `evidence_bundle_id` — logical reference, no FK;
- `research_brief_id` nullable — logical reference, no FK;
- `idempotency_key`;
- `request_hash`;
- `payload_hash`;
- `status`;
- `http_status` nullable;
- `response_body` nullable JSONB;
- `error_code` nullable;
- `error_message` nullable;
- `attempt_number`;
- `first_attempted_at_unix_ms`;
- `completed_at_unix_ms` nullable;
- `received_at_unix_ms`.

## Constraints and indexes

Required constraints:

- `status` CHECK over the canonical publish-status enum;
- `http_status` CHECK allowing null or `100..599`;
- positive/non-negative validation for attempt number and timestamps as appropriate;
- deterministic uniqueness for the chosen logical publish/idempotency model.

Required indexes:

- `evidence_bundle_id`;
- nullable `research_brief_id` where useful;
- `status, received_at_unix_ms`;
- `target, idempotency_key`.

The implementation plan must inspect how retries are represented before choosing uniqueness. It must not combine a one-row-per-HTTP-attempt model with a uniqueness rule that prevents `attempt_number > 1`.

## Suggested statuses

- `pending`;
- `sent`;
- `created`;
- `idempotent_replay`;
- `validation_failed`;
- `auth_failed`;
- `conflict`;
- `store_unavailable`;
- `network_failed`;
- `unknown_failed`.

## Repository behavior

At minimum support:

- insert/record attempt;
- lookup by target and idempotency key;
- lookup by evidence bundle;
- bounded query by status and recency;
- deterministic duplicate/conflict behavior;
- nullable research-brief references.

Application-level existence checks may produce warnings or validation errors when appropriate, but database persistence must not require referenced rows to have been inserted first.

## Acceptance criteria

- [ ] `publish_attempts` exists in the `intelligence` schema.
- [ ] `evidence_bundle_id` and nullable `research_brief_id` are indexed logical references with **no database foreign keys**.
- [ ] The migration documents why FKs are intentionally omitted for the append-oriented eventual-consistency model.
- [ ] Idempotency uniqueness is compatible with the chosen retry-row model.
- [ ] Publish-status and HTTP-status constraints are enforced at the DB layer.
- [ ] Persistence is behind a `PublishAttemptRepo`, not direct workflow SQL.
- [ ] Drizzle and fake adapters implement equivalent behavior.
- [ ] Tests cover insertion, idempotency lookup, evidence-bundle lookup, retry attempt numbering, constraints, nullable brief references, missing/out-of-order logical references, and duplicate/conflict behavior.
- [ ] Drizzle schema and generated migration/snapshot remain synchronized.
- [ ] No outbound HTTP publisher is introduced.
- [ ] No existing evidence table shape is modified except imports/exports needed for logical reference types.

## Parent

Supports #13.

## Dependencies

The taxonomy/persistence foundations from #5 and #6 must be present on the target branch.
