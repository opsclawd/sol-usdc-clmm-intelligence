# Design: Persist and Normalize clmm-v2 SOL/USDC Bundle Observations

## Status and intent

This document designs the first PR-sized slice of INT-CORE: move the existing clmm-v2 SOL/USDC bundle collector from a latest-file-only workflow to a durable, auditable `raw_observations -> normalized_observations` workflow. It does not design derived features, research briefs, evidence publication, policy synthesis, or execution.

The design preserves the repository's layered modular monolith and its authority boundary: clmm-v2 remains authoritative for live wallet, position, pool, alert, and execution facts. This repository stores an observational history and source-independent normalized facts for later analysis.

## Problem and why it matters

`collectClmmBundle` currently fetches `/insights/sol-usdc/bundle/:walletId`, performs partial runtime validation, and writes `data/latest-clmm-bundle.json`. That gives operators a convenient latest snapshot, but it does not provide:

- immutable historical source evidence;
- lineage from normalized facts back to their accepted source payload;
- deterministic replay after normalizer changes or failures;
- explicit detection of a source observation being replayed with changed content;
- source-independent records for downstream deterministic feature derivation; or
- durable representation of partial and unavailable data.

Without this boundary, later feature calculations cannot prove which source payload produced a value, and a normalization defect can destroy the only useful copy of an observation. Raw-first persistence matters because parsing and normalization are fallible while accepted source evidence must remain auditable.

## Existing architecture and constraints

The relevant code already provides most of the infrastructure:

- `src/application/collect-clmm-bundle.ts` owns HTTP orchestration and validation.
- `src/contracts/clmm-bundle.ts` defines the inbound bundle DTO.
- `RawObservationRepo` and `NormalizedObservationRepo` abstract persistence.
- Drizzle adapters implement idempotent inserts into the `intelligence` schema.
- `canonicalHash` provides key-order-independent SHA-256 hashing.
- the taxonomy registry defines `pool_state`, `position_state`, and `fee_metrics` for `clmm-v2-bundle`, plus freshness, confidence, and provenance policies.
- `computeFreshness`, `computeConfidence`, and `validateProvenance` are pure domain functions.
- `createNodeRuntime()` lazily creates the shared database connection.

The current infrastructure also has gaps that this issue must address:

1. `raw_observations` is unique only on `(source, payload_hash)`. It can deduplicate equal content but cannot identify a conflicting replay, and it can incorrectly collapse equal payloads requested for different wallets.
2. `normalized_observations` is unique on `(source, observation_kind, payload_hash)`. This can collapse the same normalized fact from two distinct raw observations and retain lineage only to the earlier row.
3. raw rows have a `parse_status`, but the repository port cannot update it or load a row by ID for replay.
4. normalized inserts are row-at-a-time. A mid-loop failure can expose a partial normalized set.
5. only the hash function is exported; the exact canonical string used to compute that hash is not available to store.
6. the current validator checks critical pool and position fields but not all nested fee, reward, alert, and data-quality shapes.
7. the composition root exposes a database connection but does not construct repositories for the job.

These are focused persistence and ingestion gaps, not reasons to change the overall architecture.

## Design options considered

### Option A: Extend the existing collector use case and repository ports (recommended)

Keep one public collection command, split its internals into fetch/accept, raw persistence, pure normalization, and normalized persistence. Extend the generic repository ports with source-identity lookup/status updates and atomic batch insertion.

Advantages:

- follows the current application/port/adapter structure;
- keeps the source-specific mapping pure and independently testable;
- makes the accepted raw row durable before any normalization work;
- supports replay without another HTTP request; and
- adds only capabilities that other collectors will also need.

Trade-off: the current collector dependency object and DB adapter wiring become larger, and a schema migration is required.

### Option B: Add a clmm-specific persistence adapter

Create one `ClmmBundlePersistenceRepo` that inserts raw rows, normalized rows, and status updates.

Advantages: fewer orchestration calls and easy cross-table transactions.

Trade-offs: it couples generic evidence tables to one upstream DTO, puts normalization-adjacent behavior in an adapter, and creates a pattern that does not generalize cleanly to future sources. It also makes pure replay and mapper testing less clear.

### Option C: Store one normalized bundle record

Persist the raw bundle, then store a single normalized observation containing the entire bundle.

Advantages: minimal code and straightforward idempotency.

Trade-offs: it is not meaningfully source-independent, forces downstream features to understand the clmm-v2 DTO, prevents kind-specific freshness/confidence policies, and does not satisfy the requested fact-level normalization.

Option A is recommended because it uses existing abstractions while keeping source-specific parsing out of persistence adapters.

## Proposed architecture

The public entrypoint remains `pnpm collect:clmm-bundle`. Its dependencies expand to include `Clock`, `RawObservationRepo`, and `NormalizedObservationRepo`. The script obtains the database from `createNodeRuntime()`, constructs both Drizzle repositories, invokes the job, and closes the connection in a `finally` block.

Internally, the work is separated into four units:

1. **Bundle acceptance** validates the response envelope and complete nested bundle contract. It returns a `ClmmBundle`; it performs no I/O.
2. **Canonicalization and raw persistence** derive the canonical payload string, content hash, and source observation key, then durably insert or recover the raw row.
3. **Pure normalization** maps a validated `ClmmBundle` into typed, source-independent normalized fact candidates. It performs no I/O, hashing, clock access, or environment access.
4. **Taxonomy enrichment and persistence** adds hashes, confidence, freshness, provenance, and lineage, validates those values, then inserts the whole normalized set atomically.

The source-specific pure functions should live in a focused domain module such as `src/domain/clmm-bundle/`. Normalized payload contracts should live under `src/contracts/` so downstream feature code can consume them without importing application or adapter code. Application orchestration continues to depend only on contracts, domain functions, and ports.

### Collection data flow

```text
GET clmm-v2 bundle
  -> validate envelope and full accepted bundle contract
  -> canonicalize accepted bundle
  -> compute content hash and source observation key
  -> insert/recover raw row (committed)
       -> conflicting identity: fail explicitly
       -> identical + parsed: skip to compatibility-file refresh
       -> identical + pending/failed: replay normalization
       -> new row: normalize
  -> parse canonical raw payload and normalize to fact candidates
  -> enrich and validate taxonomy metadata
  -> atomically insert all normalized rows
  -> mark raw row parsed
  -> update latest JSON compatibility artifact
```

The raw insert is deliberately not in the normalized batch transaction. A normalization or file-write failure therefore cannot erase the accepted raw payload.

## Accepted raw payload and canonicalization

The accepted raw payload is the validated value of the response's `bundle` field, not the HTTP envelope and not a reformatted normalized object. The wrapper contains no evidence beyond that field in the current API. Because `HttpClient.getJson` exposes parsed JSON rather than response bytes, “exact” means exact accepted JSON semantics, preserved as deterministic canonical JSON; byte-for-byte HTTP formatting cannot be preserved by the current port.

Canonicalization must be a single operation that returns both:

- `payloadCanonical`: recursively key-sorted JSON with array order preserved; and
- `payloadHash`: lowercase SHA-256 of exactly that string.

The existing canonical serializer should be exported or wrapped so storage and hashing cannot drift. JSON values that are not valid source JSON, such as `undefined`, `NaN`, or infinities, must be rejected rather than converted. The full runtime bundle validator runs before canonicalization.

`sourceRequestMeta` stores only non-secret audit context: endpoint path or redacted URL, HTTP method, wallet identifier hash, and collector/schema version. It must never store `CLMM_INSIGHTS_API_KEY` or request headers containing it.

## Source identity and idempotency

Content identity and source observation identity solve different problems and must both be stored.

### Content identity

`payloadHash = SHA-256(payloadCanonical)` detects equal accepted content. It remains indexed for lookup but is no longer globally unique per source: two different source observations, such as two wallet requests with no returned positions, can legitimately have equal bundle content. Replay idempotency is anchored to source observation identity, not content alone.

### Source observation identity

Add a non-null `source_observation_key` column to `raw_observations`, with a unique constraint on `(source, source_observation_key)`. For this source, version 1 of the key is the SHA-256 hash of the canonical tuple:

```json
{
  "identityVersion": 1,
  "walletId": "<request wallet>",
  "pair": "SOL/USDC",
  "poolId": "<bundle pool id>",
  "observedAtUnixMs": 1700000000000
}
```

Hashing the tuple avoids placing the wallet address directly in an index while retaining deterministic equality. Including an identity version makes later identity changes explicit.

The raw repository exposes an atomic insert-or-classify operation returning one of:

- `inserted` with the new row;
- `identical_replay` with the existing row when identity and content hash match; or
- `conflict` with the existing row and incoming hash when identity matches but content differs.

The Drizzle adapter owns the race-safe unique-constraint handling. Application code must not implement a check-then-insert sequence as its only guard. A conflict produces a typed, deterministic error containing the source observation key and both hashes, exits the collector non-zero, and never overwrites either payload. A separate conflict ledger is not added in this issue.

### Normalized identity

Change normalized uniqueness to `(raw_observation_id, observation_kind, payload_hash)`. This gives:

- no duplicate rows when the same raw observation is normalized again;
- distinct historical rows when separate raw observations happen to normalize to equal facts; and
- correct direct lineage for every normalized row.

Every multi-entity payload includes its stable entity ID (`poolId`, `positionId`, or `triggerId`), so distinct facts within one raw observation do not collide.

## Replay boundary and parse status

Add `findById(id)` and `updateParseStatus(id, status)` to `RawObservationRepo`. Raw evidence fields remain immutable; `parse_status` is mutable processing metadata.

Normalization always starts from `payloadCanonical` loaded from the persisted raw row, even during the initial collection. This proves the replay path is the same path used in production and prevents an in-memory object from silently differing from stored evidence.

State behavior is:

- new raw row starts as `pending`;
- successful atomic normalized insertion is followed by `parsed`;
- a normalization or normalized-write error is followed by a best-effort `failed` update, then the original error is rethrown;
- an identical replay of `parsed` skips normalization;
- an identical replay of `pending` or `failed` retries normalization;
- a crash after normalized commit but before `parsed` is safe because normalized insertion is idempotent.

Add `insertMany(rows)` to `NormalizedObservationRepo`; the Drizzle adapter executes the batch in one database transaction. If any row fails, no normalized rows from that attempt become visible. This transaction intentionally excludes the previously committed raw row.

## Normalized facts

All payloads include `schemaVersion: 1`, `pair`, their entity IDs, and `observedAtUnixMs`. Optional upstream values are materialized as `null`; they are never omitted or changed to zero. Integer-liquidity and token raw amounts remain decimal strings to avoid precision loss.

| Observation kind |      Cardinality | Evidence family    | Payload responsibility                                                                                                                                               |
| ---------------- | ---------------: | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pool_state`     |   one per bundle | `clmm_state`       | pool/pair identity, current price, sqrt price, current tick, tick spacing, fee rate, pool liquidity, and price source                                                |
| `position_state` | one per position | `clmm_state`       | wallet/position/pool identity, lower/upper/current ticks, current price, range state and distances, position/pool liquidity, and actionable-trigger presence/context |
| `fee_metrics`    | one per position | `clmm_economics`   | token A/B unclaimed fees, reward amounts, decimals/symbol/mint, and nullable USD valuations                                                                          |
| `trigger_event`  |    one per alert | `execution_safety` | trigger, position, direction, trigger time, and matching qualification context when present                                                                          |
| `data_quality`   |   one per bundle | `execution_safety` | `isPartial`, warnings, missing sources, source/observation timestamps, and freshness warning context                                                                 |

`trigger_event` and `data_quality` are new source-independent `ObservationKind` values. They are added to the taxonomy type, parser set, and registry with `clmm-v2-bundle` as the currently allowed source. Both are deterministic observations. `trigger_event` uses a short, exclude-on-stale policy because it describes operational state; `data_quality` uses the same validity horizon as the bundle state and is also excluded when stale. Exact durations should match the existing 60-second `pool_state`/`position_state` policy so a quality record cannot outlive the state it qualifies.

The position record includes `hasActionableTrigger` even when false, so absence is explicit. Alert records are emitted only for supplied alerts; an empty alert array remains represented by the position flags and the data-quality record rather than by a fabricated “no alert” event.

`volume_metrics` is not emitted because the current bundle contains no volume fields. `srLevels` remains captured in raw evidence but is not normalized in this slice: support/resistance is a separate evidence concern and normalizing the legacy embedded brief here would blur authority and confidence boundaries.

### Contract validation

Before raw acceptance, runtime validation covers every field consumed by identity or normalization:

- all bundle, pool, position, fee, reward, alert, and data-quality container types;
- finite numeric values for prices, ticks, rates, distances, timestamps, valuations, and decimals;
- enum literals for pair, source, range state, price source, and breach direction;
- decimal-string fields for raw token amounts and liquidity;
- nullable and optional fields exactly as declared; and
- consistency checks such as pool IDs/pair/source matching the bundle and alert position IDs referring to a supplied position.

Missing optional values are accepted and normalized to `null`. Missing required values or invalid cross-record references reject the bundle before raw persistence because it was never an accepted source observation. Normalization failures after acceptance cover mapper defects, taxonomy validation failures, and database failures.

## Freshness, confidence, and provenance

Each candidate is enriched using its registry entry rather than hard-coded family/class/freshness values in the adapter.

Freshness uses:

- bundle or fact `observedAtUnixMs` as observed time;
- the collector clock immediately after the HTTP response as fetched time;
- the raw row's `receivedAtUnixMs` as received time; and
- the current injected clock when computing freshness.

Invalid timestamp ordering or excessive future skew fails normalization and leaves the raw row replayable.

Confidence uses the existing registry policy. For direct clmm-v2 facts:

- `sourceReliability = 1` because clmm-v2 is operational authority for these live facts;
- `derivationConfidence = 1` because normalization is a direct, deterministic mapping;
- `llmConfidence = null`; and
- `dataCompleteness` is a deterministic per-kind ratio over a versioned list of expected fields, with required fields and explicit `false`, empty arrays, and zero values counted as present, while `null` unavailable fields count as absent.

The completeness field lists and weighting version are constants covered by tests. Warnings remain in payloads and do not receive ad hoc semantic scores. `isPartial` is included as an expected quality input so a partial bundle cannot receive full completeness merely because a particular record's required fields exist.

Each normalized row has both the database foreign key and taxonomy provenance. `sourceRefs` and `rawObservationRefs` contain the originating raw observation reference `{ refType: "raw_observation", id, source, payloadHash }`; `derivedFromRefs` is empty. `processRef` identifies `clmm-bundle-collector`, `collect-clmm-bundle`, optional pipeline run ID, and code version. Code version is read from an optional documented runtime value with a non-empty `development` fallback for local runs; production scheduling should supply the commit SHA. Provenance is validated against the registry before persistence.

## Latest JSON artifact

`data/latest-clmm-bundle.json` remains as a compatibility and operator-inspection artifact because existing documentation and OpenClaw flows refer to it. It is no longer authoritative.

It is written only after raw persistence and successful normalization. Therefore:

- a local file failure cannot remove database evidence;
- a normalization failure does not advertise a partially processed bundle as latest; and
- downstream migration away from the file can happen separately.

An identical replay already marked `parsed` may refresh the file without creating database rows.

## Failure handling

| Failure                                             | Durable result                                                                     | Command result              |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------- |
| HTTP/env failure                                    | no raw row                                                                         | fail                        |
| malformed or inconsistent bundle                    | no raw row because it was not accepted                                             | fail                        |
| raw insert failure                                  | no guaranteed row                                                                  | fail                        |
| identical replay                                    | existing raw and normalized rows reused                                            | succeed                     |
| conflicting replay                                  | original raw row preserved; incoming payload not written                           | fail with explicit conflict |
| pure normalization/taxonomy failure                 | raw row preserved and marked `failed` when possible                                | fail                        |
| normalized batch failure                            | raw row preserved; normalized batch rolled back; raw marked `failed` when possible | fail                        |
| parse-status update failure after normalized commit | raw and normalized rows preserved; status may remain pending                       | fail and safely retry later |
| latest-file write failure                           | raw and normalized rows preserved                                                  | fail, with retry safe       |

The use case returns a small result (`rawObservationId`, raw outcome, normalized count, parse status) for tests and operator logging instead of returning `void`.

## Schema and port changes

The implementation will require a generated migration that:

1. adds `source_observation_key VARCHAR(64) NOT NULL` to `raw_observations`;
2. adds unique `(source, source_observation_key)` indexing;
3. replaces unique `(source, payload_hash)` with a non-unique lookup index on those columns;
4. replaces `uniq_norm_obs_source_kind_hash` with uniqueness on `(raw_observation_id, observation_kind, payload_hash)`; and
5. preserves the existing raw-to-normalized restrictive foreign key.

Because existing rows may be present, the migration must backfill source observation keys deterministically before adding `NOT NULL`. For legacy rows without request wallet metadata, the backfill uses a versioned legacy identity derived from source, observed timestamp, and payload hash. Those rows remain auditable but cannot gain stronger wallet/pool identity retrospectively.

Port changes are intentionally generic:

- raw insert/classify by source observation key;
- raw lookup by ID and source identity;
- raw parse-status update; and
- atomic normalized batch insert.

Fakes must implement the same conflict and transaction-level semantics closely enough for port contract tests.

## Testing strategy

### Pure unit tests

- complete bundle validation and each malformed nested shape;
- canonical string/hash stability, invalid JSON values, key-order invariance, and array-order sensitivity;
- source observation key stability and changes across wallet, pool, or observation time;
- one pool/data-quality record plus per-position fee/position records and per-alert trigger records;
- multiple positions without single-position assumptions;
- optional fee/reward valuations and decimals remain `null`, including legitimate numeric zero remaining zero;
- data-quality warnings and missing sources are preserved;
- freshness, completeness, confidence, and provenance enrichment; and
- raw canonical replay produces the same normalized candidates.

### Application tests with fakes

- successful order: raw insert before normalized batch before latest-file write;
- identical parsed replay creates no additional raw or normalized rows;
- identical failed/pending replay retries normalization;
- conflicting identity/different content fails deterministically;
- normalization failure leaves the raw row and marks it failed;
- normalized batch failure exposes no partial batch;
- empty positions and alerts still produce pool and data-quality observations;
- malformed input creates neither raw nor normalized records; and
- local file failure leaves durable database records intact.

### Adapter/schema tests

- the raw identity unique constraint, non-unique content-hash index, and revised normalized unique constraint exist;
- FK lineage remains restrictive;
- concurrent-equivalent raw inserts classify as one insert plus one identical replay;
- identity conflict returns the conflict outcome without overwrite;
- normalized `insertMany` is atomic and replay-idempotent; and
- parse-status updates do not mutate raw payload/hash/identity fields.

The repository's standard `pnpm verify` remains the completion gate: typecheck, lint, formatting, tests, and dependency boundaries.

## Documentation updates

README, architecture documentation, and the operator runbook should show the new authoritative flow and troubleshooting steps:

```text
clmm-v2 bundle -> accepted raw observation -> normalized observations -> latest compatibility file
```

They must state that clmm-v2 owns live state, intelligence owns only observational history, the database is required for this collector, conflicts fail closed, and failed raw rows can be replayed without refetching. Environment documentation should add the optional code-version and run-ID values and must continue to warn against storing API keys in metadata.

## Assumptions

1. The response envelope continues to contain one `bundle` field and no other evidence-bearing fields that require raw retention.
2. `observedAtUnixMs` identifies the upstream observation time and is stable for retries of the same observation.
3. The request wallet, bundle pool ID, pair, and observation time uniquely identify one clmm-v2 SOL/USDC bundle observation.
4. One wallet request can return zero or multiple positions; no code may assume `positions[0]` exists.
5. The existing Postgres schema may already contain rows, so migrations require deterministic backfills.
6. Database persistence becomes required for `collect:clmm-bundle`; latest-file-only fallback would violate raw-first durability.
7. The current 60-second pool/position freshness horizon is the intended horizon for trigger and data-quality observations in this slice.
8. The collector may retain the latest JSON file for compatibility, but downstream features will read normalized persistence rather than treat the file as authoritative.
9. Runtime response bytes and headers are unavailable through the current `HttpClient`; canonical accepted JSON is sufficient audit fidelity for this issue.
10. Conflicts may fail explicitly rather than be stored in a separate conflict table; persistent conflict-attempt auditing can be added later if operational evidence warrants it.
11. `srLevels` is legacy contextual material, not a deterministic MVP fact owned by this ingestion slice.
12. No issue comments add requirements; `issue-comments.md` is present but empty.

## In scope

- full acceptance validation of the existing clmm-v2 bundle contract;
- canonical serialization and hashing;
- deterministic source identity and conflicting replay detection;
- raw-first persistence and parse-status lifecycle;
- replay from stored canonical raw payload;
- source-independent pool, position, fee/reward, trigger, and data-quality observations;
- taxonomy additions required for trigger and data-quality facts;
- freshness, confidence, provenance, and direct raw lineage;
- schema migrations and generic repository-port/adapter changes;
- atomic normalized batches and idempotent retries;
- retention of the latest JSON compatibility artifact;
- fixtures, unit/port/schema/adapter/application tests; and
- README, architecture, and runbook updates.

## Explicitly out of scope

- Pyth, Jupiter, Orca public-statistics, or Solana health ingestion;
- normalizing embedded support/resistance briefs;
- volume metrics not present in the source bundle;
- deterministic feature calculation, including APR, divergence, volatility, or range-risk derivation;
- evidence-bundle assembly, research briefs, LLM use, or Regime Engine publication;
- final recommendations, PolicyInsight synthesis, risk-rule changes, or execution;
- new wallet-specific chain reads or any transaction/signing authority;
- a general workflow engine or generic event-sourcing framework;
- a separate conflict-attempt table; and
- deletion of the latest JSON artifact or migration of all existing OpenClaw consumers.

## Risks and concerns

### Upstream contract drift

The current TypeScript interface and manual validator can diverge. The new complete runtime validator reduces this risk, but contract changes still require coordinated fixtures and schema-version review. Unknown extra JSON fields may remain in raw canonical evidence but should not flow into normalized payloads until deliberately mapped.

### Identity quality

If clmm-v2 reuses `observedAtUnixMs` for materially different observations, the proposed identity will correctly surface conflicts but collection will fail until upstream semantics are clarified. Silently adding content hash to the identity would hide the conflict and is therefore rejected.

### Existing migration data

Legacy rows lack source observation keys and may already include normalized rows deduplicated under the old global constraint. The migration can backfill safe identities but cannot reconstruct historical normalized observations that were previously collapsed. This limitation should be documented rather than fabricating lineage.

### Privacy and secrets

Raw payloads already include wallet and position identifiers. Access controls and the existing retention policy therefore matter. Request metadata must remain redacted, and source identity should hash the wallet-bearing tuple.

### Partial-state visibility

Atomic normalized batch insertion prevents mid-batch visibility. A crash after batch commit but before raw status update leaves a harmless pending row; consumers should rely on normalized row validity metadata, not raw `parse_status` alone.

### Confidence semantics

Mechanical completeness is not correctness. The design keeps source reliability, derivation confidence, and completeness separate and does not infer that a non-null upstream value is economically reliable. Any later quality scoring must be versioned and evidence-based.

### Latest-file dual write

The database and filesystem cannot share a transaction. The database is authoritative; a file-write failure may leave the compatibility file behind even though durable ingestion succeeded. Safe replay repairs the file without duplicating database evidence.

### Database lifecycle

The current runtime lazily creates a DB connection but collector scripts do not close one because they do not use it yet. New wiring must close it reliably on success and failure or scheduled runs may leak connections.

## Success criteria

The design is successful when every accepted clmm-v2 collection first produces one immutable, identity-checked raw row; normalization can be replayed solely from that row; all requested source-independent facts are inserted atomically with direct lineage and taxonomy metadata; equal replays are no-ops; conflicting replays fail without overwrite; null remains unavailable rather than zero; and any downstream normalization failure leaves the raw evidence intact and clearly retryable.
