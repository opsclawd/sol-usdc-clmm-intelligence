# feat: publish persisted EvidenceBundle v1 records to Regime Engine

## Summary

Publish already-assembled, schema-valid `EvidenceBundle v1` records from intelligence persistence to the authenticated Regime Engine evidence-ingest endpoint.

This issue is **publisher-only**. Bundle selection/assembly belongs to #26, publish-attempt persistence belongs to #21, and final PolicyInsight synthesis remains owned by Regime Engine.

## Correct boundary

```text
#26  -> assemble, validate, hash, and persist EvidenceBundle v1
#13  -> load that persisted canonical bundle and publish it
RE-59 -> authenticate, validate, and ingest evidence
RE-61 -> synthesize final PolicyInsight internally
```

The publisher must not rebuild, enrich, reinterpret, or mutate evidence during an HTTP request.

## Canonical contract pinning

Before this issue is enqueued, update this body with the merged Regime Engine #58 artifacts:

```text
Regime Engine contract commit: <merged SHA>
Evidence schema path: <repository-relative path>
Evidence schema version: evidence-bundle.v1
Evidence schema SHA-256: <hash>
Valid deterministic-only fixture path: <repository-relative path>
Regime Engine OpenAPI/endpoint artifact: <path or merged commit>
```

Do not infer the payload from prose or maintain a second handwritten contract.

## Required input

The publisher accepts or selects a persisted `evidence_bundles` record produced by #26 and uses its stored canonical payload, canonical hash, source/run identity, and idempotency identity.

Required rules:

- load the complete persisted canonical bundle;
- validate the stored schema version against the pinned supported version before sending;
- verify or reuse the persisted canonical payload hash without remapping fields;
- never call source collectors or feature calculators from the publisher;
- never regenerate `asOf`, expiry, confidence, coverage, warnings, lineage, contextual sections, or research brief;
- allow deterministic-only bundles with empty contextual evidence and `researchBrief: null`.

A research brief is optional. #12 is not a blocker for this issue.

## HTTP behavior

Publish to the separate authenticated evidence endpoint implemented by `opsclawd/regime-engine#59`, not the legacy external final-insight route.

At minimum implement:

- configured Regime Engine base URL and evidence endpoint;
- configured authentication header/token;
- deterministic idempotency header/key from the persisted bundle identity;
- explicit connect/request/body-read timeout covering the full response lifecycle;
- bounded response-body capture suitable for audit persistence;
- strict response mapping.

## Success and failure semantics

Treat as success:

- `201 Created` for a new accepted bundle;
- `200` exact/idempotent replay according to the #59 response contract.

Treat as terminal non-retryable failure:

- malformed local/pinned-schema mismatch before sending;
- `400` validation failure;
- `401`/`403` authentication or authorization failure;
- `409` conflicting replay;
- `422` semantic validation failure;
- other explicitly documented permanent 4xx responses.

Treat as bounded retryable failure:

- network/connection reset;
- timeout;
- `429` when the response supplies or permits bounded retry behavior;
- `500..599` transient server/store failure.

Do not retry indefinitely. Default maximum:

```text
1 initial attempt + at most 2 retries
```

Use bounded exponential backoff with jitter and a documented maximum delay. Never layer unbounded job-level retries on top of adapter retries.

## Publish-attempt audit

Use the `PublishAttemptRepo` delivered by #21.

Record each logical/HTTP attempt according to the retry-row model selected there, including:

- target and endpoint;
- evidence bundle ID;
- nullable research brief logical reference;
- idempotency key;
- request/payload hashes;
- attempt number;
- timestamps;
- HTTP status and bounded response body;
- canonical status;
- error code/message;
- final created/replay/failure outcome.

Audit persistence must not require database foreign keys or referenced-row insertion ordering.

## Idempotency and concurrency

- Concurrent attempts for the same target/idempotency identity must not create duplicate logical publications silently.
- Exact replay is success.
- Same idempotency identity with different content is a terminal conflict.
- A retry after an unknown network outcome must reuse the same idempotency identity.
- Do not mutate the persisted bundle to “fix” a conflict.

## Observability and notification

Expose structured logs/metrics/events for:

- publish started;
- created;
- idempotent replay;
- retry scheduled;
- validation/auth/conflict failure;
- exhausted transient failure;
- local audit-persistence failure.

Terminal failure must be visible to operators through the repository's notification/runbook mechanism. Do not silently drop a bundle.

## Scope

In scope:

- persisted-bundle loading boundary;
- outbound HTTP adapter;
- exact canonical payload transmission;
- auth/token configuration;
- idempotency key/header behavior;
- full-lifecycle timeout handling;
- bounded retry/backoff;
- publish-attempt persistence through #21;
- structured observability, tests, fixtures, configuration, and docs.

Out of scope:

- bundle assembly or feature selection (#26);
- research-brief generation (#12);
- contextual collectors;
- direct final `PolicyInsight` publishing;
- Regime Engine synthesis;
- app/UI or execution behavior.

## Guardrails

- Publish evidence, never final PolicyInsight output.
- Send the persisted canonical payload; do not rebuild it in the adapter.
- A null research brief and empty contextual evidence are valid.
- Do not retry permanent validation/auth/conflict failures.
- Retries are bounded and reuse the same idempotency identity.
- No execution authority is introduced.

## Acceptance criteria

- [ ] The issue is pinned to the merged Regime #58 schema commit, path, version, hash, fixture, and #59 endpoint contract before execution.
- [ ] Publisher loads a persisted #26 bundle and sends its exact canonical payload without rebuilding evidence.
- [ ] Deterministic-only bundles with empty contextual evidence and `researchBrief: null` publish successfully.
- [ ] Publisher targets the authenticated Regime evidence-ingest endpoint, not the legacy final-insight route.
- [ ] `201` creation and `200` exact replay are handled as success.
- [ ] `400`, auth failures, conflict, and semantic-validation failures are terminal and not retried.
- [ ] Network, timeout, `429`, and transient `5xx` behavior uses at most two bounded retries.
- [ ] Unknown-outcome retries reuse the exact idempotency key and payload hash.
- [ ] Every attempt/outcome is recorded through #21 with enough metadata for audit.
- [ ] Concurrent duplicate, exact replay, conflicting replay, body-read timeout, exhausted retry, audit-store failure, and malformed local bundle cases are tested.
- [ ] Terminal failures are observable and documented in the operator runbook.
- [ ] No LLM call, source collection, feature calculation, final-policy publishing, or execution behavior is introduced.

## Parent

Part of #2.

## Blocked by

- #21
- #26
- `opsclawd/regime-engine#58`
- `opsclawd/regime-engine#59`

## Dependency correction

#12 is optional enrichment and is **not** a blocker for deterministic EvidenceBundle publishing.
