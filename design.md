# Deterministic EvidenceBundle v1 Assembly and Persistence Design

## Status and contract gate

This document designs the intelligence-side assembly and persistence boundary for a deterministic-only `EvidenceBundle v1`. It does not define the downstream wire shape from prose.

Implementation remains blocked until the issue records all of the following from merged `opsclawd/regime-engine#58`:

- the Regime Engine commit SHA;
- the repository-relative JSON Schema path;
- schema version `evidence-bundle.v1`;
- the schema SHA-256;
- the canonical valid and invalid fixture paths; and
- the canonicalization, payload-hash, and idempotency rules exercised by those fixtures.

The pinned schema and fixtures are the authority. If they do not permit a deterministic-only bundle with absent contextual evidence and no research brief, or do not fully define canonicalization and identity, this issue must stop rather than fill the gap with an intelligence-local convention.

## Problem and why it matters

The repository can now collect normalized SOL/USDC observations and persist seven deterministic feature kinds, but it has no use case that turns a coherent set of those feature rows into the exact artifact consumed later by Regime Engine.

Building that artifact during an HTTP publish would couple evidence selection, contract mapping, persistence, and network retries. The resulting request would be hard to replay, inspect, or prove identical to an earlier attempt. A durable bundle boundary solves that problem:

- feature selection can be deterministic and tested independently of transport;
- the exact schema-valid payload and canonical bytes can be audited before publication;
- retries can later publish an existing bundle rather than rebuild evidence;
- missing, partial, unavailable, and expired evidence remain visible instead of becoming zero values;
- identical assembly attempts can replay safely, while logical-identity collisions with different content fail explicitly; and
- the authority boundary remains intact: this repository emits evidence, not a `PolicyInsight` or execution instruction.

This separation is especially important because contextual collectors and LLM briefs do not yet exist. The first bundle must honestly represent a deterministic-only vertical slice without overstating total evidence coverage.

## Current codebase findings

The proposed design follows the existing layered modular monolith:

- `src/contracts` holds runtime/data contracts;
- `src/domain` holds pure selection, hashing, and feature logic;
- `src/ports` defines persistence and other boundary interfaces;
- `src/application` orchestrates use cases through ports;
- `src/jobs` provides thin wrappers;
- `src/adapters/node` contains Drizzle and Node implementations; and
- `scripts` contains thin operator entrypoints.

Relevant existing capabilities are:

- `DerivedFeatureV1` already models the seven required feature kinds, `AVAILABLE | PARTIAL | UNAVAILABLE`, units, pair and scope, feature timestamps, confidence, freshness, input and rejected normalized-observation IDs, provenance, warnings/reasons, and calculator/selection versions.
- `derived_features` persists the same audit fields and deduplicates by `(feature_kind, derivation_key)`.
- `DerivedFeatureRepo.findByKind` can provide candidates, although its current API does not express an upper time bound, scope, or supported calculator versions. Those semantic filters must remain in pure code even if the persistence query is later bounded more tightly.
- Feature scope differs by kind: range features are position- and pool-scoped; volume/liquidity is pool-scoped; oracle divergence, oracle confidence width, and volatility are pair-scoped.
- Feature provenance already contains raw and normalized references. The bundle must add the selected derived-feature IDs and preserve the underlying references in the canonical representation required by Regime Engine.
- Normalized position payloads do not contain `walletId`. The raw clmm-v2 bundle does, while raw request metadata contains only a wallet hash. If the canonical contract requires wallet identity, bundle assembly must resolve it from the lineage-linked raw clmm-v2 payload and verify it against the requested context; it cannot infer wallet ownership from `positionId` alone.
- The current `evidence_bundles` table stores a JSONB payload and hash and deduplicates on `(pair, payload_hash)`. It has no canonical-payload text or logical idempotency key, so it cannot preserve the exact bytes hashed or detect “same logical identity, different content.”
- `DrizzleBundleRepo.insert` silently returns a row on a pair/hash collision. That is sufficient for exact-content replay only, not the conflict behavior required here.
- `src/domain/content-hash.ts` implements a repository-local sorted-key JSON serialization. It must not be assumed to match the Regime Engine contract.
- `createNodeRuntime().getPersistence()` currently composes raw, normalized, and feature repositories but not the existing bundle repository.
- Dependency rules allow application code to depend on ports, domain, and contracts while keeping database and Node details in adapters. The new flow should preserve those boundaries.

## Goals

The design must enable one application operation to:

1. select a deterministic evidence snapshot for one SOL/USDC wallet/position/Whirlpool context;
2. represent all seven required feature slots without fabricating values;
3. compute quality, coverage, freshness, confidence, warnings, and lineage only by pinned deterministic rules;
4. map the snapshot to the exact `EvidenceBundle v1` contract, with canonical empty/unavailable contextual evidence and an absent research brief;
5. validate and canonicalize the complete payload according to the pinned Regime Engine contract;
6. persist the canonical payload and audit metadata; and
7. classify an identical replay as idempotent and a same-identity/different-content replay as a conflict.

## Non-goals

This design does not include:

- HTTP publication to Regime Engine;
- endpoint configuration, authentication, retries, backoff, or publish-attempt rows;
- contextual collectors or contextual inference;
- LLM research-brief generation;
- Regime Engine evidence selection, scoring, market-regime classification, or `PolicyInsight` synthesis;
- clmm-v2 UI, wallet signing, transaction construction, or liquidity execution;
- new deterministic feature formulas beyond the seven already implemented;
- policy/risk-rule changes; or
- a generic multi-pair or multi-position bundle format beyond what the canonical v1 schema requires.

## Assumptions

No questions were asked; the design proceeds with these explicit assumptions:

1. Regime Engine issue #58 will merge a contract that permits empty or explicitly unavailable contextual sections and a nullable or explicitly unavailable research brief.
2. The contract package will define, or its fixtures will unambiguously demonstrate, field names, canonicalization, payload hashing, idempotency identity, timestamp semantics, and quality/coverage rules. If any of these remain unspecified, the contract must be clarified upstream before implementation.
3. A bundle represents exactly one `SOL/USDC` position context. The request therefore includes pair, wallet identity, position ID, Whirlpool/pool ID, run/correlation ID, evaluation time, creation time, and the accepted calculator versions.
4. Run/correlation and creation-time inputs come from an immutable assembly run context. Replaying that logical run reuses the same context; a new run gets a new logical identity even when it selects the same feature rows.
5. The pinned downstream schema and fixtures may be copied into this repository with a provenance manifest because runtime builds and tests must not depend on network access or a mutable branch in another repository.
6. The canonical fixture license and repository policy permit that pinned copy.
7. A feature is expired at `evaluationTime >= validUntilUnixMs`. The stored `isStale` flag is retained as audit metadata but is not sufficient for evaluating freshness later because it reflects derivation time.
8. “Latest” means the greatest semantic `asOfUnixMs`, followed by greatest `receivedAtUnixMs`, followed by greatest database ID. The contract may replace this tie-break only if it explicitly requires another ordering.
9. `PARTIAL` with a non-null numeric value remains usable evidence but lowers quality and emits warnings. `UNAVAILABLE`, expired, unsupported-version, and missing candidates never contribute a numeric value.
10. Contract-invalid bundles are not persisted. Invalidity is returned as an assembly failure, not encoded as a durable bundle quality state.
11. No intelligence-local aggregate score will be invented. If the contract requires a scalar score, its exact formula and rounding must come from the pinned rules and be covered by fixtures.

## Approaches considered

### A. Pinned contract gateway plus pure selection/assembly core — recommended

Pin the authoritative schema and fixtures in the repository, generate or derive TypeScript types from that schema, and expose validation/canonicalization behind a narrow contract boundary. Keep feature selection, snapshot classification, quality inputs, warning construction, and lineage aggregation in small pure domain functions. Let one application use case load candidates, assemble and validate the payload, then persist it through an idempotency-aware repository.

Benefits:

- aligns with the current layered architecture;
- makes semantic selection and quality rules unit-testable without Postgres;
- prevents a handwritten TypeScript or Zod contract from drifting from the downstream schema;
- keeps canonicalization replaceable if the contract algorithm changes by schema version;
- produces a transport-independent durable artifact; and
- supports exact replay and explicit conflict behavior.

Trade-off: the repository must maintain a deliberate contract-sync step and provenance manifest. That maintenance is preferable to a runtime dependency on another repository or an unversioned schema fetch.

### B. Recreate EvidenceBundle v1 as local Zod/types and use the existing hash helper

This would match current runtime-contract patterns and require fewer new dependencies. It is rejected because the issue explicitly forbids reconstructing the downstream schema from prose. A local Zod model would become a second contract, and the existing sorted-key serializer has not been proven equivalent to the Regime Engine canonicalization algorithm.

### C. Store ordinary JSONB now and assemble/validate while publishing later

This would minimize this issue’s changes. It is rejected because JSONB does not preserve canonical serialized bytes, the existing pair/hash uniqueness cannot detect logical identity conflicts, and publish retries would rebuild evidence from a changing database. It also defeats the issue’s purpose of creating a stable replayable artifact before network behavior.

## Recommended architecture

### 1. Pinned canonical contract assets

Add a versioned contract asset directory under `schemas/regime-engine/evidence-bundle.v1/` containing:

- the exact JSON Schema from the recorded Regime Engine commit;
- only the canonical fixtures needed for valid, invalid, deterministic-only, hashing, and idempotency tests; and
- a provenance manifest recording upstream repository, commit, source paths, schema version, SHA-256 values, and copy date.

Contract tests first verify every copied asset against the manifest hashes. The schema is then compiled by a standards-compliant JSON Schema validator for its declared draft. TypeScript types should be generated from the pinned schema or kept as generated checked-in output; they must not be manually broadened or narrowed.

Expose a version-specific contract service with one operation conceptually equivalent to:

```text
validateCanonicalizeAndHash(candidate)
  -> { payload, payloadCanonical, payloadHash, schemaVersion }
  | contract validation error
```

The service owns only canonical contract mechanics. It does not select features or assign quality. The implementation must use the contract-mandated canonicalization and hash algorithm. The current `canonicalizePayload` helper may be reused only if golden contract tests establish byte-for-byte canonical string and hash equality.

### 2. Explicit assembly request and immutable run context

The application use case receives an explicit request rather than reading environment variables or generating identity internally. Conceptually it contains:

```text
pair = SOL/USDC
walletId
positionId
poolId / whirlpoolId
runId / correlationId
evaluationTimeUnixMs
createdAtUnixMs
accepted calculator version per required feature kind
contract schema version
assembly selection version
code version
```

The request is validated before database reads. Pair is fixed to `SOL/USDC` for v1. Empty identity fields, unsupported schema versions, duplicate/unknown feature version entries, or creation/evaluation times that violate canonical contract rules fail closed.

The exact treatment of wallet identity—plain public key, hash, or another identifier—comes from the pinned contract. The assembly request should not log wallet values, and persistence should store only the canonical representation required downstream.

### 3. Bounded candidate retrieval, pure deterministic selection

Extend the feature repository with a bounded candidate query rather than embedding “latest valid” semantics in SQL. The adapter may filter by the seven kinds, pair, a lower and upper `asOf` bound, and a reasonable received-time bound for efficiency. It must return all candidates needed to make the decision.

Pure selection then processes each required kind independently:

1. reject rows whose pair differs from the request;
2. reject rows whose calculator version is not the accepted version for that kind;
3. enforce scope:
   - range location and lower/upper distances must match pair + pool + position;
   - volume/liquidity ratio must match pair + pool and have no position scope;
   - oracle divergence, oracle confidence width, and realized volatility must match pair and have neither pool nor position scope;
4. reject rows from the future (`asOfUnixMs > evaluationTimeUnixMs`);
5. classify rows as expired when `evaluationTimeUnixMs >= validUntilUnixMs`, regardless of the stored `isStale` value;
6. order eligible rows by `asOfUnixMs DESC`, `receivedAtUnixMs DESC`, and `id DESC`;
7. choose the first row; and
8. retain stable rejection reasons and the most relevant rejected IDs for warnings and audit.

The selector returns exactly seven slots in canonical feature-kind order. Each slot is one of:

- selected `AVAILABLE`;
- selected `PARTIAL`;
- selected `UNAVAILABLE`;
- missing;
- expired-only; or
- unsupported-version-only.

`AVAILABLE` and `PARTIAL` retain their numeric values and units. Every other slot has no numeric value. Existing unavailable reason codes and warnings are preserved; bundle-level selection warnings are added using a stable, versioned vocabulary.

Selection should use the persisted feature envelope as its authority. It must not recalculate any feature from normalized observations.

### 4. Scope and lineage verification

Before assembly, verify that the position-scoped feature lineage actually belongs to the requested wallet, position, and pool when the canonical contract requires those identities.

The selected feature rows already contain normalized observation IDs and raw provenance references. Add bounded bulk lookup methods for the referenced normalized and raw observations so the use case can:

- confirm every referenced normalized ID exists and matches the feature’s provenance;
- confirm every normalized row’s raw parent exists;
- verify payload hashes and sources against stored provenance refs;
- parse the lineage-linked clmm-v2 raw canonical payload with the existing clmm bundle validator;
- confirm wallet, position, pool, and pair relationships; and
- assemble de-duplicated raw-observation, normalized-observation, and derived-feature references in stable order.

A broken, contradictory, or cross-position lineage chain is a hard assembly error. It is not ordinary “missing feature” degradation because persisting it would falsely attest provenance.

If the canonical contract requires only opaque wallet identity and the raw lineage cannot supply it safely, the operation fails rather than trusting an unrelated request value.

### 5. Deterministic quality, coverage, and warnings

Quality is computed from the seven selection slots and contract-defined contextual/brief absence. Keep the rule set pure and versioned.

The quality input always records:

- counts and names of `AVAILABLE`, `PARTIAL`, `UNAVAILABLE`, missing, expired, and unsupported-version features;
- contextual evidence as absent using the canonical representation;
- research brief as absent using the canonical representation;
- whether all selected evidence is deterministic;
- the minimum expiry across usable feature rows;
- source coverage derived from verified lineage; and
- sorted, de-duplicated warnings and reason codes.

The baseline classification is:

- complete deterministic coverage only when all seven slots are fresh `AVAILABLE` rows at the accepted versions;
- partial deterministic coverage when at least one slot is usable and any slot is partial, unavailable, missing, expired, or unsupported;
- unavailable deterministic coverage when no slot is usable; and
- contract invalid when mapping or schema validation fails.

The use case persists complete or partial bundles only if the canonical contract permits them. Given the repository’s fail-closed default posture, a zero-usable-feature result produces no bundle unless the pinned contract explicitly requires a durable unavailable bundle.

Contextual and brief absence must reduce or qualify total coverage as the canonical rules require, but must not incorrectly turn valid deterministic feature coverage into “complete overall evidence.” `researchBrief: null` or an explicit unavailable object is selected strictly from the schema.

Confidence aggregation must be monotonic: the bundle cannot be more confident than the evidence it summarizes. The exact aggregate formula, weighting, rounding, and absent-evidence treatment come from Regime Engine. If no scalar is mandated, publish categorical levels and component facts only; do not add an intelligence-specific score.

### 6. Pure canonical payload assembly

A pure assembler maps the request, seven selected slots, quality result, verified lineage, contextual absence, and brief absence into the generated `EvidenceBundle v1` type.

The assembler must populate, using the canonical field names:

- schema and source identity;
- run/correlation identity;
- pair, wallet, position, and Whirlpool context as required;
- `asOf`, creation, and expiry timestamps;
- seven deterministic feature summaries in contract-defined stable order;
- quality, freshness, confidence, coverage, and warnings;
- source coverage and source refs;
- raw-observation, normalized-observation, and derived-feature lineage;
- empty/unavailable contextual collections; and
- absent research brief.

Timestamp rules must be deterministic and contract-driven. As a default semantic model, bundle `asOf` is derived from the selected evidence snapshot, expiry is the earliest expiry among usable selected inputs, and creation time comes from the immutable run context. The implementation must replace these defaults if the pinned contract specifies otherwise.

The assembler does not include the payload hash inside the hashed material unless the canonical contract explicitly defines a non-recursive envelope convention. Likewise, the idempotency key is computed from exactly the canonical identity fields, not from ad hoc database columns.

After assembly, the contract service validates the complete candidate, produces canonical text, and hashes those exact bytes. No persistence occurs before this succeeds.

### 7. Persistence model and conflict semantics

Retain JSONB `payload` for database inspection, but add fields needed for exact audit and idempotency:

- `payload_canonical text NOT NULL` for the exact canonical bytes represented as text;
- `idempotency_key` with a length/format matching the contract;
- any canonical source/run/position identity columns required for operational lookup; and
- an appropriate unique index on canonical schema/source identity plus `idempotency_key`, according to the pinned semantics.

The migration must verify or safely handle historical bundle rows before adding `NOT NULL` fields. It must not manufacture canonical text or idempotency keys for existing rows. If production rows exist and cannot be proven canonical, the migration stops for an explicit data-migration decision.

The repository operation should return a discriminated outcome rather than silently returning any conflicting row:

```text
inserted(row)
identical_replay(row)
conflict(existing row identity/hash, incoming identity/hash)
```

The Drizzle adapter inserts under the unique logical identity. On conflict it loads the winner and compares schema version, idempotency key, payload hash, and canonical payload text:

- exact equality is `identical_replay`;
- any difference is an explicit immutable conflict; and
- the stored row is never overwritten.

This lookup-after-conflict pattern also handles concurrent assemblers. The existing `(pair, payload_hash)` index may remain as a non-authoritative lookup or be replaced after migration analysis, but it cannot be the logical idempotency constraint.

The adapter also verifies that `JSON.parse(payloadCanonical)` is structurally equal to `payload` before insert. Contract validation remains the application gate; the repository enforces storage consistency and conflict behavior.

### 8. Application, job, and runtime composition

Add `assembleEvidenceBundle` under `src/application`. Its flow is:

```text
validate explicit request
        |
        v
load bounded feature candidates
        |
        v
pure seven-slot selection
        |
        v
bulk-load and verify lineage/scope
        |
        v
pure quality + coverage classification
        |
        v
pure canonical-contract mapping
        |
        v
schema validate + canonicalize + hash
        |
        v
derive canonical idempotency identity
        |
        v
insert / identical replay / explicit conflict
        |
        v
return bundle row and stable outcome summary
```

The use case performs no HTTP calls and no LLM calls. Expected evidence degradation is returned in bundle quality and warnings. Invalid requests, corrupt lineage, schema violations, canonicalization failures, and persistence conflicts are hard failures.

A thin job binds repositories, contract service, and clock/run inputs. The composition root adds `bundleRepo` and the canonical contract implementation to persistence/runtime dependencies. A thin script may expose deterministic assembly and print only IDs, status counts, warnings, hash, and replay outcome; it must avoid logging wallet-sensitive payload content.

## Identity and replay invariants

The following invariants are required regardless of the exact field names chosen by the pinned contract:

1. Candidate ordering is total and stable; database return order cannot affect selection.
2. Reordering source arrays, warning inputs, or lineage refs cannot change canonical output because those collections are normalized into contract-defined stable order before canonicalization.
3. The idempotency identity includes schema version, source identity, run/correlation identity, pair and required position scope, selection version, accepted calculator versions, and selected input identities exactly as required by Regime Engine.
4. The payload hash is calculated over the exact persisted `payloadCanonical` text.
5. An identical logical identity plus identical canonical content returns the original row.
6. An identical logical identity plus different canonical content returns a conflict and never overwrites.
7. A changed selected feature ID, calculator version, selection version, contract schema version, or logical run identity produces auditable new identity/content according to the canonical rules.
8. Missing, unavailable, or expired evidence never becomes numeric zero.
9. A legitimate numeric zero from an `AVAILABLE`/`PARTIAL` feature remains zero.
10. A schema-invalid or provenance-invalid candidate never reaches `evidence_bundles`.
11. Publication code later reads the stored canonical bundle and never reassembles it.

## Error handling

Errors fall into three groups:

- **Expected degraded evidence:** missing, partial, unavailable, expired, or unsupported-version feature slots; absent context; absent brief. These become deterministic quality facts and warnings when the contract permits persistence.
- **Contract/lineage failures:** schema mismatch, asset hash mismatch, invalid canonical fixture behavior, contradictory identity, missing referenced row, provenance hash mismatch, unsupported schema, or undefined canonical semantics. These fail closed before persistence.
- **Infrastructure/integrity failures:** database errors, concurrent deletion after conflict, or logical idempotency conflict. These return explicit typed failures and do not retry or overwrite in this issue.

Warnings and reasons use stable codes in canonical sorted order. Human-readable diagnostic messages may accompany them outside the hashed contract payload only if the contract permits; tests should assert codes rather than incidental prose.

## Testing strategy

### Contract conformance

- verify pinned schema and fixture SHA-256 values against the provenance manifest;
- compile the declared JSON Schema draft;
- validate all canonical valid and invalid fixtures with expected outcomes;
- prove canonical text and payload hashes byte-for-byte against Regime Engine fixtures;
- prove deterministic-only, empty-context, absent-brief payload validity; and
- fail tests if generated TypeScript types drift from the pinned schema.

### Pure selection and quality

- complete seven-feature coverage;
- one and multiple missing kinds;
- `PARTIAL` and `UNAVAILABLE` rows;
- stale/expired rows evaluated after derivation;
- future rows;
- unsupported calculator versions;
- pair, pool, and position mismatches;
- deterministic tie-breaks for equal semantic timestamps;
- legitimate numeric zero versus unavailable null;
- stable order and de-duplication of warnings and refs;
- no usable features; and
- contextual and research-brief absence represented without claiming complete overall coverage.

### Lineage

- complete raw -> normalized -> derived lineage;
- missing normalized or raw reference;
- provenance payload-hash mismatch;
- wallet/position/pool mismatch in the clmm-v2 raw payload;
- duplicate refs collapsed in stable order; and
- global, pool-scoped, and position-scoped feature lineage combined correctly.

### Application orchestration

- schema-valid bundle persists once;
- exact replay returns the original row;
- same idempotency key with different canonical content returns conflict;
- schema mismatch and invalid canonical fixture persist nothing;
- complete, missing, partial, unavailable, stale, nullable-brief, and empty-context cases map as specified;
- contract service is called before repository insert; and
- no HTTP, publisher, or LLM dependency is introduced.

### Persistence and concurrency

- migration columns, constraints, and indexes match the contract lengths/semantics;
- insert and exact replay outcomes;
- same-key/different-hash and same-key/different-canonical-text conflicts;
- two concurrent identical inserts converge to one row and two replay-compatible outcomes;
- two concurrent conflicting inserts preserve one immutable winner and report one conflict;
- JSONB/canonical-text consistency; and
- migration abort behavior when unconvertible historical bundles exist.

## Documentation and replay example

Developer/operator documentation should record:

- the pinned Regime Engine contract provenance and update procedure;
- the seven selection rules and version;
- exact quality/coverage rules from the canonical contract;
- timestamp, expiry, canonicalization, hash, and idempotency semantics;
- the meaning of inserted, identical replay, and conflict outcomes;
- an example that assembles a deterministic-only bundle from fixed feature IDs and replays it to the same persisted row; and
- the boundary that later publication sends the stored artifact without rebuilding it.

## Risks and concerns

### Missing canonical dependency

The issue does not yet contain the required Regime Engine commit, schema path/hash, or fixtures. Exact payload fields, optional-section representation, hash algorithm, and identity cannot be finalized until that pin exists. This is a hard implementation stop, not permission to infer the contract.

### Existing bundle schema is insufficient

JSONB does not preserve canonical bytes, and pair/hash uniqueness cannot express logical identity conflicts. A migration and repository contract change are unavoidable. Historical rows may make a safe `NOT NULL` migration impossible without an explicit data decision.

### Wallet lineage gap

Normalized position observations omit `walletId`; only the raw clmm-v2 bundle retains it. If the canonical bundle requires wallet identity, assembly must hydrate and validate raw lineage. Trusting only the request value would permit a position/wallet mismatch.

### Freshness drift

Persisted `isStale` is a snapshot at derivation time. Assembly at a later time must recalculate expiration from `validUntilUnixMs` and its explicit evaluation time.

### Feature-query growth

`findByKind` can return more data than needed and does not take an upper bound or scope. A bounded candidate query is warranted, but SQL must remain only a coarse filter so deterministic semantic selection stays pure and adapter-independent.

### Duplicate contract logic

Generated types, schema validation, canonicalization, and quality rules can drift if maintained independently. The design mitigates this with pinned assets, manifest hashes, generated types, and golden cross-repository fixtures. Quality formulas absent from the contract must be clarified upstream rather than duplicated locally.

### Numeric canonicalization

Feature values are safe integers today, but confidence scores and other contract fields may be decimals. Canonical JSON algorithms differ in numeric rendering. Tests must cover exact fixture bytes; ordinary `JSON.stringify`, JSONB round-trips, and the current local serializer cannot be presumed safe.

### Ambiguous creation time and replay

If assembly uses an ambient clock inside the hashed payload, rebuilding the same logical identity can create a conflict. Creation time therefore belongs to the explicit immutable run context and must be reused for replay.

### Partial versus no-bundle posture

The issue asks for explicit degraded coverage, while repository policy says to produce no bundle when data is stale or low confidence. This design resolves the tension by allowing schema-valid partial bundles when at least one deterministic feature is usable and refusing a zero-usable bundle unless the canonical contract explicitly requires it. The exact threshold remains subordinate to pinned canonical rules.

### Sensitive identifiers

Wallet and position identifiers may be sensitive operational data. Only contract-required representations should be persisted or logged, and scripts should emit bundle IDs/hashes rather than full payloads by default.

## Scope summary

In scope is a pinned-contract, deterministic, schema-valid, replayable `EvidenceBundle v1` persisted with complete lineage and explicit degraded coverage. Out of scope is every network, LLM, policy-synthesis, UI, and execution concern. The publisher in the parent issue must consume this persisted canonical artifact as-is.
