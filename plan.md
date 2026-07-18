<!-- plan-review-required -->

# Persist and Normalize clmm-v2 Bundle Observations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pnpm collect:clmm-bundle` durably accept one canonical clmm-v2 SOL/USDC observation before normalization, replay it idempotently into source-independent normalized facts with direct lineage, and retain the latest JSON file as a non-authoritative compatibility artifact.

**Architecture:** Keep HTTP and state-transition orchestration in the application layer, move complete bundle acceptance and fact mapping into focused pure `src/domain/clmm-bundle/` modules, and extend the existing generic persistence ports. Raw insertion commits independently; normalized rows are enriched from the taxonomy registry and inserted in one transaction, after which the raw parse status advances. The Node composition root owns Drizzle construction and the script closes the connection in `finally`.

**Tech Stack:** TypeScript 5.7, Vitest, Zod, Drizzle ORM/Drizzle Kit, PostgreSQL, pnpm.

---

**Goal details**

- Preserve the validated `bundle` field as canonical JSON and hash exactly that canonical string.
- Distinguish content equality from source-observation identity so equal payloads from different wallets do not collapse.
- Emit `pool_state`, `position_state`, `fee_metrics`, `trigger_event`, and `data_quality` observations with registry-derived freshness, confidence, and provenance.
- Make accepted raw evidence replayable after mapper, taxonomy, normalized-write, status-update, or latest-file failures.

**Non-goals**

- Do not collect Pyth, Jupiter, Orca public statistics, Solana health, volume, or wallet facts not already supplied by clmm-v2.
- Do not normalize `srLevels`, calculate derived features, assemble/publish evidence bundles, generate research briefs, synthesize PolicyInsight, change risk policy, or execute transactions.
- Do not add a conflict-attempt table, delete `data/latest-clmm-bundle.json`, or build a general workflow engine.
- Do not preserve original HTTP byte formatting or secret request headers; the HTTP port exposes parsed JSON only.

**Affected files from repository root**

- Contracts/domain: `src/contracts/clmm-bundle.ts`, `src/contracts/normalized-clmm-observation.ts`, `src/contracts/index.ts`, `src/contracts/taxonomy.ts`, `src/domain/content-hash.ts`, `src/domain/clmm-bundle/index.ts`, `src/domain/clmm-bundle/validate.ts`, `src/domain/clmm-bundle/identity.ts`, `src/domain/clmm-bundle/normalize.ts`, `src/domain/clmm-bundle/enrich.ts`, `src/domain/taxonomy/registry.ts`, `src/domain/taxonomy/validation.ts`, `src/domain/taxonomy/index.ts`.
- Persistence: `src/db/schema/raw-observations.ts`, `src/db/schema/normalized-observations.ts`, `src/ports/observation-repo.ts`, `src/ports/normalized-observation-repo.ts`, `src/ports/index.ts`, `src/adapters/node/drizzle-observation-repo.ts`, `src/adapters/node/drizzle-normalized-observation-repo.ts`.
- Migration: `drizzle/0001_clmm_observation_identity.sql`, `drizzle/meta/0001_snapshot.json`, `drizzle/meta/_journal.json`.
- Orchestration/wiring: `src/application/collect-clmm-bundle.ts`, `src/jobs/clmm-bundle-job.ts`, `src/adapters/node/composition-root.ts`, `scripts/collectors/clmm-bundle.ts`.
- Test support/tests: `tests/fixtures/clmm-bundle.ts`, `tests/domain/clmm-bundle/validate.test.ts`, `tests/domain/clmm-bundle/identity.test.ts`, `tests/domain/clmm-bundle/normalize.test.ts`, `tests/domain/clmm-bundle/enrich.test.ts`, `tests/domain/content-hash.test.ts`, `tests/domain/taxonomy/registry.test.ts`, `tests/domain/taxonomy/validation.test.ts`, `tests/db/schema/raw-observations.test.ts`, `tests/db/schema/normalized-observations.test.ts`, `tests/db/migrations/clmm-observation-identity.test.ts`, `tests/ports/observation-repo.test.ts`, `tests/ports/normalized-observation-repo.test.ts`, `tests/adapters/node/drizzle-observation-repos.integration.test.ts`, `tests/fakes/fake-observation-repo.ts`, `tests/fakes/fake-normalized-observation-repo.ts`, `tests/fakes/fake-json-store.ts`, `tests/application/collect-clmm-bundle.test.ts`, `tests/scripts/clmm-bundle.test.ts`.
- Documentation/config: `.env.example`, `README.md`, `docs/architecture.md`, `docs/operator-runbook.md`.

**Global behavioral invariants**

- `pending -> parsed` occurs only after the complete normalized batch is durably committed.
- `pending|failed -> failed` is attempted after an accepted raw row encounters normalization or normalized persistence failure; the original failure remains the reported error if the status update also fails.
- `parsed + identical replay` skips normalization and may refresh only the compatibility file.
- `pending|failed + identical replay` replays solely from the persisted `payloadCanonical` and cannot refetch or trust the in-memory bundle for normalization.
- Equal source identity plus unequal content is a conflict: preserve the original row and payload, insert no normalized rows, write no compatibility file, and fail deterministically.
- Raw persistence is never rolled back with normalization; normalized batch persistence is all-or-nothing and idempotent for one raw observation.
- Optional upstream absence maps to `null`; legitimate `0`, `false`, empty arrays, and decimal strings remain present values.

## Task 1: Add complete bundle acceptance validation

**Files:**

- Modify: `src/contracts/clmm-bundle.ts`
- Create: `src/domain/clmm-bundle/validate.ts`
- Create: `src/domain/clmm-bundle/index.ts`
- Create: `tests/fixtures/clmm-bundle.ts`
- Create: `tests/domain/clmm-bundle/validate.test.ts`

**Behavioral invariants to test first:**

- `accepts a complete bundle with zero or multiple positions and alerts` proves cardinality is not hard-coded.
- `rejects every non-finite numeric field consumed by identity or normalization` covers pool, position, valuation, decimal, distance, and timestamp fields.
- `rejects mismatched pair source pool and alert references before persistence` covers bundle/pool/position consistency and alert-to-position referential integrity.
- `accepts declared optional values and preserves them for null materialization` covers optional price distances, trigger qualification fields, reward valuations, and nullable decimals.

- [ ] **Step 1: Create one reusable complete fixture and write failing table-driven validator tests.** Export `makeClmmBundle(overrides?)` from `tests/fixtures/clmm-bundle.ts`; include a pool, two positions, fee token A/B data, rewards, one matching alert, and partial data-quality warnings. Tests must clone/mutate one nested field per case so the error names the exact rejected path.
- [ ] **Step 2: Run `pnpm vitest run tests/domain/clmm-bundle/validate.test.ts` and confirm failures because `acceptClmmBundleEnvelope` does not exist.**
- [ ] **Step 3: Implement the full runtime acceptance boundary.** Use Zod or equivalent explicit parsing to export two functions:

```ts
export function acceptClmmBundleEnvelope(response: unknown): ClmmBundle;
export function acceptClmmBundle(bundle: unknown): ClmmBundle;
```

`acceptClmmBundleEnvelope` validates the full HTTP response envelope and returns `response.bundle`. `acceptClmmBundle` validates the unwrapped bundle directly (used for replay validation where `row.payloadCanonical` stores the already-unwrapped `ClmmBundle`). Validate all declared nested containers, literal enums, decimal strings, finite numbers, nullable/optional fields, and cross-record consistency. Unknown extra source fields may remain in raw evidence, but no unvalidated cast may enter normalization.

- [ ] **Step 4: Export both validators (`acceptClmmBundleEnvelope` for HTTP response envelopes and `acceptClmmBundle` for unwrapped bundle replay from `row.payloadCanonical`) through `src/domain/clmm-bundle/index.ts`, then rerun the focused test and expect all cases to pass.**
- [ ] **Step 5: Run `pnpm exec eslint src/contracts/clmm-bundle.ts src/domain/clmm-bundle/validate.ts src/domain/clmm-bundle/index.ts tests/fixtures/clmm-bundle.ts tests/domain/clmm-bundle/validate.test.ts --max-warnings 0` and `pnpm exec prettier --check src/contracts/clmm-bundle.ts src/domain/clmm-bundle/validate.ts src/domain/clmm-bundle/index.ts tests/fixtures/clmm-bundle.ts tests/domain/clmm-bundle/validate.test.ts`.**
- [ ] **Step 6: Commit:** `git add src/contracts/clmm-bundle.ts src/domain/clmm-bundle/validate.ts src/domain/clmm-bundle/index.ts tests/fixtures/clmm-bundle.ts tests/domain/clmm-bundle/validate.test.ts && git commit -m "feat(clmm): validate complete bundle contract"`.

## Task 2: Canonicalize accepted JSON and derive source identity

**Files:**

- Modify: `src/domain/content-hash.ts`
- Modify: `tests/domain/content-hash.test.ts`
- Create: `src/domain/clmm-bundle/identity.ts`
- Modify: `src/domain/clmm-bundle/index.ts`
- Create: `tests/domain/clmm-bundle/identity.test.ts`

**Behavioral invariants to test first:**

- `canonical payload hash is the SHA-256 of the returned canonical string` prevents storage/hash serializer drift.
- `canonical JSON sorts object keys recursively and preserves array order` defines deterministic content semantics.
- `canonical JSON rejects undefined sparse arrays NaN Infinity and unsupported JSON values` prevents lossy acceptance.
- `source observation key is stable for the same version wallet pair pool and observed time` defines replay identity.
- `source observation key changes when wallet pool pair observation time or identity version changes` prevents unrelated observations from collapsing.

- [ ] **Step 1: Extend the existing hash tests and add identity tests before implementation.** Keep the existing `canonicalHash` compatibility coverage and assert exact canonical strings as well as 64-character lowercase hashes.
- [ ] **Step 2: Run `pnpm vitest run tests/domain/content-hash.test.ts tests/domain/clmm-bundle/identity.test.ts`; expect missing exports and invalid-value cases to fail.**
- [ ] **Step 3: Replace the private serializer with one strict exported operation while retaining `canonicalHash`:**

```ts
export interface CanonicalPayload {
  payloadCanonical: string;
  payloadHash: string;
}

export async function canonicalizePayload(payload: unknown): Promise<CanonicalPayload>;
export async function canonicalHash(payload: unknown): Promise<string>;
```

`canonicalHash` must delegate to `canonicalizePayload`. Reject values that JSON cannot represent exactly rather than silently dropping/coercing them.

- [ ] **Step 4: Implement `deriveClmmSourceObservationKey` over the canonical identity tuple `{ identityVersion: 1, walletId, pair, poolId, observedAtUnixMs }`; return only its SHA-256 hash.** Keep the raw tuple out of indexed storage.
- [ ] **Step 5: Export the identity helper and rerun the two focused test files, then lint/format only the five scoped files.** Run `pnpm exec eslint src/domain/content-hash.ts src/domain/clmm-bundle/identity.ts src/domain/clmm-bundle/index.ts tests/domain/content-hash.test.ts tests/domain/clmm-bundle/identity.test.ts --max-warnings 0` and the matching `pnpm exec prettier --check ...` paths.
- [ ] **Step 6: Commit:** `git add src/domain/content-hash.ts src/domain/clmm-bundle/identity.ts src/domain/clmm-bundle/index.ts tests/domain/content-hash.test.ts tests/domain/clmm-bundle/identity.test.ts && git commit -m "feat(clmm): define canonical payload identity"`.

## Task 3: Map bundles into source-independent fact candidates

**Files:**

- Create: `src/contracts/normalized-clmm-observation.ts`
- Modify: `src/contracts/index.ts`
- Create: `src/domain/clmm-bundle/normalize.ts`
- Modify: `src/domain/clmm-bundle/index.ts`
- Create: `tests/domain/clmm-bundle/normalize.test.ts`

**Behavioral invariants to test first:**

- `maps one pool and data-quality candidate plus one position and fee candidate per position and one trigger per alert` fixes cardinality.
- `maps an empty positions and alerts bundle to only pool_state and data_quality` forbids fabricated absence events.
- `materializes unavailable optional values as null while retaining zero false empty arrays and decimal strings` enforces missing-data semantics.
- `includes stable poolId positionId or triggerId in every multi-entity payload` preserves normalized identity within one raw observation.
- `does not normalize srLevels or emit volume_metrics` holds the authority and scope boundary.

- [ ] **Step 1: Write mapper tests using `makeClmmBundle`; assert complete payload objects, ordering, and exact candidate kinds.**
- [ ] **Step 2: Run `pnpm vitest run tests/domain/clmm-bundle/normalize.test.ts` and confirm it fails on missing contracts/mapper.**
- [ ] **Step 3: Define versioned readonly payload interfaces for `PoolStatePayloadV1`, `PositionStatePayloadV1`, `FeeMetricsPayloadV1`, `TriggerEventPayloadV1`, and `DataQualityPayloadV1`, plus a discriminated `ClmmNormalizedCandidate` union.** Every payload includes `schemaVersion: 1`, `pair`, entity identity, and `observedAtUnixMs`; raw token/liquidity amounts remain strings.
- [ ] **Step 4: Implement `normalizeClmmBundle(bundle: ClmmBundle): readonly ClmmNormalizedCandidate[]` as a pure mapper with deterministic ordering: pool, positions and their fees in input order, alerts in input order, then data quality.** Qualification context on triggers comes from the matching position; invalid references are impossible after Task 1 but should still fail defensively.
- [ ] **Step 5: Export contracts and mapper, rerun the focused test, then run `pnpm exec eslint src/contracts/normalized-clmm-observation.ts src/contracts/index.ts src/domain/clmm-bundle/normalize.ts src/domain/clmm-bundle/index.ts tests/domain/clmm-bundle/normalize.test.ts --max-warnings 0` and `pnpm exec prettier --check src/contracts/normalized-clmm-observation.ts src/contracts/index.ts src/domain/clmm-bundle/normalize.ts src/domain/clmm-bundle/index.ts tests/domain/clmm-bundle/normalize.test.ts`.**
- [ ] **Step 6: Commit:** `git add src/contracts/normalized-clmm-observation.ts src/contracts/index.ts src/domain/clmm-bundle/normalize.ts src/domain/clmm-bundle/index.ts tests/domain/clmm-bundle/normalize.test.ts && git commit -m "feat(clmm): map bundle facts into normalized candidates"`.

## Task 4: Register and enrich all normalized CLMM facts

**Files:**

- Modify: `src/contracts/taxonomy.ts`
- Modify: `src/contracts/normalized-clmm-observation.ts`
- Modify: `src/domain/taxonomy/registry.ts`
- Modify: `src/domain/taxonomy/validation.ts`
- Modify: `src/domain/taxonomy/index.ts`
- Create: `src/domain/clmm-bundle/enrich.ts`
- Modify: `src/domain/clmm-bundle/index.ts`
- Modify: `tests/domain/taxonomy/registry.test.ts`
- Modify: `tests/domain/taxonomy/validation.test.ts`
- Create: `tests/domain/clmm-bundle/enrich.test.ts`

**Behavioral invariants to test first:**

- `trigger_event and data_quality are deterministic execution_safety kinds with 60-second exclude-on-stale policies` keeps qualification records from outliving state.
- `enrichment derives family class and freshness exclusively from the registry entry` prevents adapter/application hard-coding.
- `completeness counts zero false and empty arrays as present and null as absent under weighting version clmm-bundle-completeness-v1` fixes score semantics.
- `direct facts use reliability 1 derivation 1 llm null and validated direct raw provenance` separates deterministic mapping from availability.
- `future or out-of-order timestamps fail before persistence` makes the raw row replayable instead of publishing invalid time metadata.

- [ ] **Step 1: Add failing taxonomy and enrichment tests.** Extend the explicit `ObservationKind[]` test list with `trigger_event` and `data_quality`; add exact policy assertions rather than only generic registry-shape assertions.
- [ ] **Step 2: Run `pnpm vitest run tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts tests/domain/clmm-bundle/enrich.test.ts` and confirm the new kinds/helpers fail.**
- [ ] **Step 3: Add the two source-independent observation kinds to the contract union, parser set, and registry.** Both use `execution_safety`, `deterministic`, `clmm-v2-bundle`, 60,000 ms max age, 5,000 ms skew, `exclude`, schema version 1, and the same direct-provenance/confidence policy shape as pool/position state.
- [ ] **Step 4: Add a contract-owned `EnrichedClmmObservation` shape, then implement exported versioned completeness field lists and `enrichClmmCandidates(input)` using `getObservationKindEntry`, `canonicalizePayload`, `computeFreshness`, `computeConfidence`, and `validateProvenance`.** Input supplies plain persisted-lineage fields (`id`, `source`, `payloadHash`, received/fetched times), current time, code version, and optional run ID; it must not import a repository port row. Output is `readonly EnrichedClmmObservation[]` with identical source/raw refs and an empty `derivedFromRefs`; the application can pass these structurally into `NormalizedObservationRepo.insertMany` without making domain depend on ports.
- [ ] **Step 5: Rerun the three focused test files, then run `pnpm exec eslint src/contracts/taxonomy.ts src/contracts/normalized-clmm-observation.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts src/domain/taxonomy/index.ts src/domain/clmm-bundle/enrich.ts src/domain/clmm-bundle/index.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts tests/domain/clmm-bundle/enrich.test.ts --max-warnings 0` and `pnpm exec prettier --check src/contracts/taxonomy.ts src/contracts/normalized-clmm-observation.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts src/domain/taxonomy/index.ts src/domain/clmm-bundle/enrich.ts src/domain/clmm-bundle/index.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts tests/domain/clmm-bundle/enrich.test.ts`.**
- [ ] **Step 6: Commit:** `git add src/contracts/taxonomy.ts src/contracts/normalized-clmm-observation.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts src/domain/taxonomy/index.ts src/domain/clmm-bundle/enrich.ts src/domain/clmm-bundle/index.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts tests/domain/clmm-bundle/enrich.test.ts && git commit -m "feat(taxonomy): enrich CLMM normalized facts"`.

## Task 5: Migrate raw and normalized observation identities

**Files:**

- Modify: `src/db/schema/raw-observations.ts`
- Modify: `src/db/schema/normalized-observations.ts`
- Create: `drizzle/0001_clmm_observation_identity.sql`
- Create: `drizzle/meta/0001_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Modify: `tests/db/schema/raw-observations.test.ts`
- Modify: `tests/db/schema/normalized-observations.test.ts`
- Create: `tests/db/migrations/clmm-observation-identity.test.ts`

**Behavioral invariants to test first:**

- `raw identity is unique by source and source_observation_key while source and payload_hash remains a non-unique lookup index` separates replay identity from content equality.
- `normalized identity is unique by raw_observation_id observation_kind and payload_hash` preserves direct lineage across equal historical facts.
- `legacy raw rows receive deterministic non-null 64-character identity keys before the not-null constraint is applied` makes migration safe for populated tables.
- `normalized foreign key remains on-delete restrict` protects lineage.

- [ ] **Step 1: Extend schema tests and add a migration-text regression test that checks the ordered backfill/constraint/index operations by named statement fragments.** The migration test must read only `drizzle/0001_clmm_observation_identity.sql`.
- [ ] **Step 2: Change Drizzle schemas: add `sourceObservationKey` as a `.text().nullable()` column (NOT NULL enforced only by the migration after safe backfill, keeping `$inferInsert` compatible with the existing adapter until Task 6), replace `uniq_raw_obs_source_payload_hash` with `uniq_raw_obs_source_observation_key`, add non-unique `idx_raw_obs_source_payload_hash`, and replace normalized uniqueness with `uniq_norm_obs_raw_kind_hash`.**
- [ ] **Step 3: Generate the named migration with `pnpm db:generate -- --name clmm_observation_identity`, then edit only the generated SQL needed for populated-table safety.** Add the column nullable, backfill with a deterministic 64-character versioned legacy key derived from source, observed timestamp, and payload hash (for example two differently salted built-in `md5` results concatenated), then set `NOT NULL`, drop old unique indexes, and create replacements. Do not require a new PostgreSQL extension.
- [ ] **Step 4: Run `pnpm vitest run tests/db/schema/raw-observations.test.ts tests/db/schema/normalized-observations.test.ts tests/db/migrations/clmm-observation-identity.test.ts` and expect pass.**
- [ ] **Step 5: Run `pnpm exec prettier --check src/db/schema/raw-observations.ts src/db/schema/normalized-observations.ts drizzle/meta/0001_snapshot.json drizzle/meta/_journal.json tests/db/schema/raw-observations.test.ts tests/db/schema/normalized-observations.test.ts tests/db/migrations/clmm-observation-identity.test.ts` and ESLint on the TypeScript files in that same list.**
- [ ] **Step 6: Commit:** `git add src/db/schema/raw-observations.ts src/db/schema/normalized-observations.ts drizzle/0001_clmm_observation_identity.sql drizzle/meta/0001_snapshot.json drizzle/meta/_journal.json tests/db/schema/raw-observations.test.ts tests/db/schema/normalized-observations.test.ts tests/db/migrations/clmm-observation-identity.test.ts && git commit -m "feat(db): migrate observation replay identities"`.

## Task 6: Add atomic raw insert classification and parse-status operations

**Files:**

- Modify: `src/ports/observation-repo.ts`
- Modify: `src/ports/index.ts`
- Modify: `src/adapters/node/drizzle-observation-repo.ts`
- Modify: `tests/fakes/fake-observation-repo.ts`
- Modify: `tests/ports/observation-repo.test.ts`
- Create: `tests/adapters/node/drizzle-observation-repos.integration.test.ts`

**Behavioral invariants to test first:**

- `insertOrClassify returns inserted for a new source identity` creates one immutable pending row.
- `insertOrClassify returns identical_replay for equal identity and content` returns the existing row without mutation.
- `insertOrClassify returns conflict for equal identity and unequal content` exposes existing/incoming hashes and preserves stored evidence.
- `equal content under distinct source identities creates distinct raw rows` prevents cross-wallet collapse.
- `updateParseStatus changes only parseStatus and findById reloads the persisted row` keeps raw evidence immutable.
- `concurrent equivalent inserts classify as one inserted and one identical replay` requires unique-constraint recovery rather than check-then-insert alone.

- [ ] **Step 1: Rewrite the fake port contract tests around `sourceObservationKey`, `insertOrClassify`, `findById`, `findByIdentity`, and `updateParseStatus`; add raw-only disposable-Postgres integration cases for unique-race and immutability behavior.**
- [ ] **Step 2: Run `pnpm vitest run tests/ports/observation-repo.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts` and confirm interface/method failures.** The integration suite may use `TEST_DATABASE_URL` and must skip with an explicit message when absent; never point it at a production/shared database.
- [ ] **Step 3: Change the port and every implementation in this same task.** Define:

```ts
export type RawInsertOutcome =
  | { outcome: "inserted"; row: RawObservationRow }
  | { outcome: "identical_replay"; row: RawObservationRow }
  | { outcome: "conflict"; row: RawObservationRow; incomingPayloadHash: string };

export interface RawObservationRepo {
  insertOrClassify(row: RawObservationInsert): Promise<RawInsertOutcome>;
  findById(id: number): Promise<RawObservationRow | undefined>;
  findByIdentity(
    source: Source,
    sourceObservationKey: string
  ): Promise<RawObservationRow | undefined>;
  findByHash(source: Source, payloadHash: string): Promise<RawObservationRow | undefined>;
  findBySource(source: Source, sinceUnixMs: number): Promise<RawObservationRow[]>;
  updateParseStatus(id: number, status: ParseStatus): Promise<RawObservationRow>;
}
```

Add `sourceObservationKey` to insert/row shapes. The Drizzle adapter must attempt insert with conflict-do-nothing on `(source, sourceObservationKey)`, reload by identity, and classify by payload hash; the fake must mirror these semantics.

- [ ] **Step 4: Rerun the focused port/integration tests, then run `pnpm exec eslint src/ports/observation-repo.ts src/ports/index.ts src/adapters/node/drizzle-observation-repo.ts tests/fakes/fake-observation-repo.ts tests/ports/observation-repo.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts --max-warnings 0` and `pnpm exec prettier --check src/ports/observation-repo.ts src/ports/index.ts src/adapters/node/drizzle-observation-repo.ts tests/fakes/fake-observation-repo.ts tests/ports/observation-repo.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts`.**
- [ ] **Step 5: Commit:** `git add src/ports/observation-repo.ts src/ports/index.ts src/adapters/node/drizzle-observation-repo.ts tests/fakes/fake-observation-repo.ts tests/ports/observation-repo.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts && git commit -m "feat(persist): classify raw observation replays"`.

## Task 7: Add atomic idempotent normalized batch insertion

**Files:**

- Modify: `src/ports/normalized-observation-repo.ts`
- Modify: `src/ports/index.ts`
- Modify: `src/adapters/node/drizzle-normalized-observation-repo.ts`
- Modify: `tests/fakes/fake-normalized-observation-repo.ts`
- Modify: `tests/ports/normalized-observation-repo.test.ts`
- Modify: `tests/adapters/node/drizzle-observation-repos.integration.test.ts`

**Behavioral invariants to test first:**

- `insertMany inserts every row or exposes none when one row fails` defines transaction-level atomicity.
- `insertMany replay for the same raw kind and payload hash returns existing rows without duplicates` makes crash recovery safe.
- `equal normalized content from distinct raw observations creates distinct rows` preserves direct lineage.
- `insertMany returns rows in input order across inserted and replayed members` gives deterministic orchestration results.

- [ ] **Step 1: Add fake contract tests and normalized integration cases before changing the interface.** Give the fake an explicit fail-at-index hook that rolls back its staged batch so application tests can prove all-or-nothing visibility.
- [ ] **Step 2: Run `pnpm vitest run tests/ports/normalized-observation-repo.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts` and confirm missing batch behavior fails.**
- [ ] **Step 3: Add `insertMany(rows: readonly NormalizedObservationInsert[]): Promise<NormalizedObservationRow[]>` to `NormalizedObservationRepo` and update both implementations in this same task.** The Drizzle implementation must use `db.transaction`, conflict on `(rawObservationId, observationKind, payloadHash)`, reload conflicts with that same identity, and preserve input order. Retain `insert` only if existing consumers still need it; if retained, implement it through a one-row batch so semantics cannot diverge.
- [ ] **Step 4: Rerun focused tests, then run `pnpm exec eslint src/ports/normalized-observation-repo.ts src/ports/index.ts src/adapters/node/drizzle-normalized-observation-repo.ts tests/fakes/fake-normalized-observation-repo.ts tests/ports/normalized-observation-repo.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts --max-warnings 0` and `pnpm exec prettier --check src/ports/normalized-observation-repo.ts src/ports/index.ts src/adapters/node/drizzle-normalized-observation-repo.ts tests/fakes/fake-normalized-observation-repo.ts tests/ports/normalized-observation-repo.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts`.**
- [ ] **Step 5: Commit:** `git add src/ports/normalized-observation-repo.ts src/ports/index.ts src/adapters/node/drizzle-normalized-observation-repo.ts tests/fakes/fake-normalized-observation-repo.ts tests/ports/normalized-observation-repo.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts && git commit -m "feat(persist): insert normalized observations atomically"`.

## Task 8: Orchestrate raw-first collection and replay state transitions

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

## Task 9: Wire repository lifecycle into the collector entrypoint

**Files:**

- Modify: `src/adapters/node/composition-root.ts`
- Modify: `src/jobs/clmm-bundle-job.ts`
- Modify: `scripts/collectors/clmm-bundle.ts`
- Create: `tests/scripts/clmm-bundle.test.ts`

**Behavioral invariants to test first:**

- `collector closes the database connection after success` prevents scheduled-run leaks.
- `collector closes the database connection after collection failure and preserves the collection error` guarantees cleanup without masking cause.
- `composition root creates raw and normalized repositories over the same lazily-created Drizzle database` keeps batch/lineage operations on one configured connection.

- [ ] **Step 1: Write `tests/scripts/clmm-bundle.test.ts` first.** Exercise an exported `runClmmBundleCollector(runtime)` with fake runtime/persistence dependencies for success and collection failure; assert `close()` exactly once and original-error preservation. Verify the composition-root persistence result exposes two repos built over one connection without opening a second connection.
- [ ] **Step 2: Run `pnpm vitest run tests/scripts/clmm-bundle.test.ts` and confirm it fails because the injectable runner/persistence factory does not exist.**
- [ ] **Step 3: Add a persistence factory to `NodeRuntime` that returns `{ connection, rawObservationRepo, normalizedObservationRepo }`, constructing both Drizzle adapters over the same `DrizzlePgAdapter.db`.** Keep the adapter imports lazy so unrelated commands do not require `DATABASE_URL`.
- [ ] **Step 4: Change `clmmBundleJob` to preserve the application result type rather than returning `Promise<void>`.**
- [ ] **Step 5: Export the injectable runner from the script, acquire persistence, pass runtime clock/repos into the job, and close `connection` in `finally`; retain the existing direct-execution behavior.** If collection and close both fail, preserve the collection error and attach/log cleanup context rather than replacing it.
- [ ] **Step 6: Rerun `pnpm vitest run tests/scripts/clmm-bundle.test.ts`, then run `pnpm exec eslint src/adapters/node/composition-root.ts src/jobs/clmm-bundle-job.ts scripts/collectors/clmm-bundle.ts tests/scripts/clmm-bundle.test.ts --max-warnings 0` and `pnpm exec prettier --check src/adapters/node/composition-root.ts src/jobs/clmm-bundle-job.ts scripts/collectors/clmm-bundle.ts tests/scripts/clmm-bundle.test.ts`.** The automatic workspace gate will run repository-wide typecheck after the task; do not add a separate unscoped command here.
- [ ] **Step 7: Commit:** `git add src/adapters/node/composition-root.ts src/jobs/clmm-bundle-job.ts scripts/collectors/clmm-bundle.ts tests/scripts/clmm-bundle.test.ts && git commit -m "feat(clmm): wire durable collector runtime"`.

## Task 10: Document the durable observation workflow and recovery runbook

**Files:**

- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/operator-runbook.md`

- [ ] **Step 1: Add optional `INTELLIGENCE_CODE_VERSION` and `INTELLIGENCE_PIPELINE_RUN_ID` examples.** State that production scheduling should set code version to the commit SHA, local runs fall back to `development`, and neither API keys nor headers are stored in request metadata.
- [ ] **Step 2: Replace latest-file-only diagrams/text with `clmm-v2 bundle -> raw_observations -> normalized_observations -> data/latest-clmm-bundle.json compatibility artifact`.** Explicitly state clmm-v2 owns live wallet/position/execution truth; intelligence owns observational history only; the DB is required; no policy or execution authority is added.
- [ ] **Step 3: Add runbook diagnosis for malformed rejection (no raw row), conflict (fail closed), failed/pending raw replay, batch rollback, post-commit pending status, latest-file repair, and guaranteed connection close.** Provide read-only SQL queries by source observation key/hash/status; do not prescribe manual mutation of immutable raw evidence.
- [ ] **Step 4: Run `pnpm exec prettier --check .env.example README.md docs/architecture.md docs/operator-runbook.md`.** Review only the updated integration-contract, data-flow, environment, and failure-mode sections with `sed -n '235,370p' README.md`, `sed -n '55,115p' docs/architecture.md`, and `sed -n '1,180p' docs/operator-runbook.md` rather than whole-file grep.
- [ ] **Step 5: Commit:** `git add .env.example README.md docs/architecture.md docs/operator-runbook.md && git commit -m "docs(clmm): explain durable observation ingestion"`.

**Tests to add or update**

- Pure acceptance: full nested validation, finite values, enums, optional/null values, consistency, and multiple entities.
- Pure identity: strict canonical JSON, exact hash/string coupling, invalid JSON rejection, and versioned source identity changes.
- Pure mapping/enrichment: fact cardinality, null-vs-zero semantics, no fabricated alerts/volume/SR facts, stable entity identity, registry policies, completeness, freshness, confidence, and provenance.
- Schema/migration: source key column/indexes, legacy backfill ordering, normalized lineage uniqueness, and restrictive FK retention.
- Port/adapter: inserted/identical/conflict raw classification, concurrent race recovery, parse-status-only mutation, normalized all-or-nothing batches, replay idempotency, and equal facts from distinct raw rows.
- Application: raw-first operation order, every parse-state transition/replay path, malformed rejection, conflict, normalized failure, status failure, file failure/repair, redacted metadata, and environment behavior.

**Validation commands after all implementation tasks (dedicated validate phase, not a task)**

Run the repository completion gate exactly as configured:

```bash
pnpm verify
```

When a disposable Postgres database is available, also run the adapter integration suite against it before migration deployment:

```bash
TEST_DATABASE_URL=postgres://user:pass@host:5432/disposable_intelligence_test pnpm vitest run tests/adapters/node/drizzle-observation-repos.integration.test.ts
```

Apply and inspect the migration only against a disposable database first:

```bash
DATABASE_URL=postgres://user:pass@host:5432/disposable_intelligence_test pnpm db:migrate
DATABASE_URL=postgres://user:pass@host:5432/disposable_intelligence_test pnpm exec tsx src/db/verify.ts
```

**Risk areas**

- Upstream DTO drift can reject previously tolerated malformed nested values; errors must include field paths and happen before raw persistence.
- Source identity depends on wallet, pool, pair, and stable `observedAtUnixMs`; upstream timestamp reuse will deliberately surface conflicts.
- The migration changes uniqueness on populated tables; duplicate legacy lineage cannot be reconstructed, and index creation/backfill needs a disposable-database rehearsal.
- Raw and normalized commits are intentionally separate. A crash after normalized commit but before status update leaves `pending`, relying on normalized idempotency for recovery.
- DB/file writes cannot share a transaction. The database is authoritative; replay repairs a stale compatibility file.
- Raw payloads contain wallet/position identifiers. Request metadata hashing prevents an additional wallet index leak but does not replace DB access controls/retention.
- Mechanical completeness is not source correctness; do not reinterpret the confidence score as economic truth.

**Stop conditions**

- Abort if issues #4, #5, or #6 infrastructure is absent or materially incompatible with the inspected ports/schema; do not recreate parallel persistence/taxonomy systems.
- Abort migration rollout if a disposable database reveals non-deterministic/duplicate legacy backfill keys, an unremovable conflicting index, loss of the restrictive FK, or unsupported SQL on the deployed PostgreSQL version.
- Abort if clmm-v2 does not guarantee stable `observedAtUnixMs` semantics for retries; do not hide the ambiguity by adding content hash to source identity.
- Abort if the accepted envelope contains evidence-bearing fields outside `bundle`; revisit the raw acceptance boundary instead of silently discarding evidence.
- Abort if atomic batch semantics cannot be implemented through the current Drizzle connection without leaking DB types into ports/domain; adjust the composition boundary before continuing.
- Abort if any implementation would store `CLMM_INSIGHTS_API_KEY`, request headers, or unredacted wallet identity in `sourceRequestMeta`.
- Abort rather than deploy a migration or integration test against the shared/production database without an explicit disposable target and backup/rollback procedure.

**Assumptions**

- `issue-comments.md` is intentionally empty and adds no requirements.
- Canonical accepted JSON semantics, not byte-for-byte HTTP formatting, satisfy raw audit fidelity because `HttpClient` returns parsed JSON.
- Existing raw rows can receive weaker versioned legacy identity keys, but their historical normalized rows cannot be reconstructed if the old uniqueness rule collapsed them.
- The 60-second pool/position horizon is the required horizon for `trigger_event` and `data_quality` in this slice.
- Database persistence is mandatory for this collector; there is no latest-file-only fallback.
