# INT-PERSIST #5 — DB-Backed Observation and Artifact Persistence

**Date:** 2026-05-10
**Status:** Draft
**Issue:** https://github.com/opsclawd/sol-usdc-clmm-intelligence/issues/5
**Blocks:** INT-CORE #7 (wires collectors to DB), INT-TAXONOMY #6 (defines freshness/provenance model)
**Blocked by:** INT-ARCH #3 (complete — merged)

## Purpose

Add Drizzle ORM + Postgres persistence to the intelligence repo so that raw observations, normalized facts, derived features, evidence bundles, and research briefs can be stored, queried, audited, and replayed — replacing the current file-only `data/latest-*.json` state model.

This issue is **infrastructure only**. It does not modify existing collectors or introduce DB writes in application code. INT-CORE #7 will wire collectors to DB persistence; INT-TAXONOMY #6 will define the common freshness/provenance model that downstream tables reference.

## Architecture

### Schema strategy

Use Drizzle ORM with `pgSchema("intelligence")` — the same pattern used by regime-engine with `pgSchema("regime_engine")`. Each repo owns its own schema on the shared Railway Postgres cluster. No cross-schema foreign keys. Migrations target the `intelligence` schema.

Connection string: `DATABASE_URL?schema=intelligence` (Drizzle Kit connects to the default schema but generates migration SQL targeting `intelligence`).

Schema-scoped role: `intelligence_reader` / `intelligence_writer` roles provisioned via the first migration.

### Table lineage and pipeline stages

```text
raw_observations
  ↓ (normalize)
normalized_observations
  ↓ (derive)
derived_features
  ↓ (assemble)
evidence_bundles
  ↓ (summarize)
research_briefs
```

Each downstream table can point back to its input lineage. `raw_observations` is the append-only source of truth; `evidence_bundles` is the publishable output consumed by regime-engine.

### Idempotency

Every table stores a `payload_hash` column (SHA-256 of canonical JSON). Inserts that duplicate an existing hash are idempotent — the repository port's `upsert` methods detect content-hash collisions and return the existing row rather than inserting duplicates.

### Retention tiers

| Tier | Tables                                        | Default retention | Downsampled archive                                           |
| ---- | --------------------------------------------- | ----------------- | ------------------------------------------------------------- |
| Hot  | `raw_observations`                            | 90 days           | —                                                             |
| Warm | `normalized_observations`, `derived_features` | 365 days          | Downsampled to daily/weekly summaries                         |
| Cold | `evidence_bundles`, `research_briefs`         | Indefinite        | Not downsampled; policy-gated expiry via `expires_at_unix_ms` |

Retention enforcement is not implemented in this issue — the policy is documented and the columns support it. A future issue will add a cleanup job.

### Replay and rebuild

Each downstream artifact stores `input_lineage` as a JSONB array of `{ table, id }` references. This enables:

- Tracing any derived feature back to its raw observation
- Rebuilding downstream artifacts from persisted raw observations
- Audit trails for evidence bundles received by regime-engine

### Layer integration

The persistence layer follows the existing layered monolith boundaries:

```text
src/
  contracts/        — canonical types (ClmmBundle, etc.) — unchanged
  domain/           — pure logic (cron-command) — unchanged
  ports/            — + repository interfaces (ObservationRepo, etc.)
  application/      — use cases — unchanged in this issue
  db/               — NEW: Drizzle schema definitions, migration config
    schema/         — one file per table, barrel index
  adapters/
    node/           — + DrizzlePgAdapter implementing repository ports
  jobs/             — unchanged
```

The `db/` directory is a peer of `ports/` and `adapters/` — it holds schema definitions and migration tooling but does not belong to any single layer. Repository ports in `ports/` define the interface; the adapter in `adapters/node/` implements them against Drizzle/pg.

## New files

### Database schema (`src/db/`)

```text
src/db/
  schema/
    intelligence.ts       — pgSchema("intelligence") declaration + schema-scoped role constants
    raw-observations.ts   — raw_observations table
    normalized-observations.ts — normalized_observations table
    derived-features.ts   — derived_features table
    evidence-bundles.ts    — evidence_bundles table
    research-briefs.ts    — research_briefs table
    index.ts              — barrel: re-exports all tables, types, and schema
  db.ts                   — createDb(connectionString) factory + type exports
  verify.ts               — verifyPgConnection, verifyPgSchema, verifyTable helpers
drizzle.config.ts         — Drizzle Kit config (top-level, next to package.json)
```

### Repository ports (`src/ports/`)

```text
src/ports/
  observation-repo.ts     — RawObservationRepo: insert, findByHash, findBySource
  normalized-observation-repo.ts — NormalizedObservationRepo: insert, findBySource
  feature-repo.ts        — DerivedFeatureRepo: insert, findByKind
  bundle-repo.ts          — EvidenceBundleRepo: insert, findByPair, findLatestByPair
  brief-repo.ts          — ResearchBriefRepo: insert, findByBundleId
  db.ts                   — DbConnection port: provides a Drizzle instance
  index.ts                — barrel: add new port exports
```

### Repository adapters (`src/adapters/node/`)

```text
src/adapters/node/
  drizzle-pg.ts           — DrizzlePgAdapter implementing DbConnection port
  drizzle-observation-repo.ts — implements RawObservationRepo against Drizzle
  drizzle-normalized-observation-repo.ts — implements NormalizedObservationRepo
  drizzle-feature-repo.ts — implements DerivedFeatureRepo
  drizzle-bundle-repo.ts — implements EvidenceBundleRepo
  drizzle-brief-repo.ts  — implements ResearchBriefRepo
```

### Fakes (`tests/fakes/`)

```text
tests/fakes/
  fake-observation-repo.ts — in-memory RawObservationRepo for tests
  fake-normalized-observation-repo.ts — in-memory NormalizedObservationRepo
  fake-feature-repo.ts     — in-memory DerivedFeatureRepo
  fake-bundle-repo.ts      — in-memory EvidenceBundleRepo
  fake-brief-repo.ts       — in-memory ResearchBriefRepo
  fake-db.ts               — in-memory DbConnection for tests
  index.ts                 — barrel: add new fake exports
```

### Tests

```text
tests/db/
  schema/                  — schema definition tests (column presence, index presence)
    raw-observations.test.ts
    normalized-observations.test.ts
    derived-features.test.ts
    evidence-bundles.test.ts
    research-briefs.test.ts
  verify.test.ts           — verifyPgConnection, verifyPgSchema tests (mocked)
tests/adapters/node/
  drizzle-observation-repo.test.ts — integration test against test DB or mocked
  drizzle-normalized-observation-repo.test.ts
  drizzle-feature-repo.test.ts
  drizzle-bundle-repo.test.ts
  drizzle-brief-repo.test.ts
tests/ports/
  observation-repo.test.ts  — port contract tests against fake
  normalized-observation-repo.test.ts
  feature-repo.test.ts
  bundle-repo.test.ts
  brief-repo.test.ts
```

## Table definitions

### raw_observations

Immutable append-only. Stores source responses before any interpretation.

| Column              | Type        | Constraints | Purpose                                                            |
| ------------------- | ----------- | ----------- | ------------------------------------------------------------------ |
| id                  | serial      | PK          | Auto-increment                                                     |
| source              | varchar(64) | NOT NULL    | Source identifier (e.g. "clmm-v2-bundle", "jupiter-price")         |
| observed_at_unix_ms | bigint      | NOT NULL    | When the source observed the data                                  |
| fetched_at_unix_ms  | bigint      | NOT NULL    | When we fetched it                                                 |
| payload_hash        | varchar(64) | NOT NULL    | SHA-256 of `payload_canonical`                                     |
| payload_canonical   | text        | NOT NULL    | Canonical JSON string of the raw response                          |
| parse_status        | varchar(16) | NOT NULL    | "pending" \| "parsed" \| "failed" — default "pending"              |
| source_request_meta | jsonb       |             | Request metadata (URL, headers redacted, response headers, timing) |
| received_at_unix_ms | bigint      | NOT NULL    | Default to DB insertion timestamp                                  |

Indexes:

- `uniq_raw_obs_source_payload_hash` UNIQUE on (source, payload_hash) — idempotency
- `idx_raw_obs_source_observed` on (source, observed_at_unix_ms, id) — time-window queries

### normalized_observations

Parsed/validated observations linked to raw source data.

| Column              | Type        | Constraints              | Purpose                                                          |
| ------------------- | ----------- | ------------------------ | ---------------------------------------------------------------- |
| id                  | serial      | PK                       | Auto-increment                                                   |
| raw_observation_id  | integer     | FK → raw_observations.id | Lineage to raw source                                            |
| source              | varchar(64) | NOT NULL                 | Source identifier                                                |
| observation_kind    | varchar(64) | NOT NULL                 | Kind of observation (e.g., "pool-snapshot", "position-snapshot") |
| payload             | jsonb       | NOT NULL                 | Normalized, typed payload                                        |
| payload_hash        | varchar(64) | NOT NULL                 | SHA-256 of canonical payload                                     |
| is_fresh            | boolean     | NOT NULL DEFAULT true    | Freshness flag (INT-TAXONOMY #6 will define staleness rules)     |
| received_at_unix_ms | bigint      | NOT NULL                 | Insertion timestamp                                              |

Indexes:

- `uniq_norm_obs_source_kind_hash` UNIQUE on (source, observation_kind, payload_hash) — idempotency
- `idx_norm_obs_source_kind_fresh` on (source, observation_kind, is_fresh, received_at_unix_ms)

### derived_features

Code-computed metrics (oracle divergence, fee APR, volatility, etc.).

| Column              | Type             | Constraints               | Purpose                                                 |
| ------------------- | ---------------- | ------------------------- | ------------------------------------------------------- |
| id                  | serial           | PK                        | Auto-increment                                          |
| feature_kind        | varchar(64)      | NOT NULL                  | Kind of feature (e.g., "oracle-divergence", "fee-apr")  |
| value               | double precision |                           | Numeric value for scalar features                       |
| structured_payload  | jsonb            |                           | Structured value for complex features                   |
| as_of_unix_ms       | bigint           | NOT NULL                  | Point-in-time this feature describes                    |
| confidence          | varchar(16)      | NOT NULL DEFAULT "medium" | "high" \| "medium" \| "low"                             |
| input_lineage       | jsonb            |                           | Array of { table, id } references to upstream artifacts |
| received_at_unix_ms | bigint           | NOT NULL                  | Insertion timestamp                                     |

Indexes:

- `idx_features_kind_as_of` on (feature_kind, as_of_unix_ms, id) — time-window queries
- `idx_features_kind_confidence` on (feature_kind, confidence, received_at_unix_ms)

### evidence_bundles

Assembled payloads published to regime-engine.

| Column              | Type        | Constraints        | Purpose                                                 |
| ------------------- | ----------- | ------------------ | ------------------------------------------------------- |
| id                  | serial      | PK                 | Auto-increment                                          |
| schema_version      | varchar(16) | NOT NULL           | Bundle contract version                                 |
| pair                | varchar(32) | NOT NULL           | "SOL/USDC"                                              |
| as_of_unix_ms       | bigint      | NOT NULL           | Point-in-time this bundle describes                     |
| expires_at_unix_ms  | bigint      | NOT NULL           | When this bundle becomes stale                          |
| payload             | jsonb       | NOT NULL           | The bundle payload (ClmmBundle shape)                   |
| payload_hash        | varchar(64) | NOT NULL           | SHA-256 of canonical payload                            |
| input_lineage       | jsonb       |                    | Array of { table, id } references to upstream artifacts |
| version             | integer     | NOT NULL DEFAULT 1 | Monotonic version for a given pair+asOf                 |
| received_at_unix_ms | bigint      | NOT NULL           | Insertion timestamp                                     |

Indexes:

- `uniq_bundle_pair_hash` UNIQUE on (pair, payload_hash) — idempotency
- `idx_bundle_pair_as_of` on (pair, as_of_unix_ms, id) — time-window queries
- `idx_bundle_pair_latest` on (pair, received_at_unix_ms, id) — latest-bundle queries

### research_briefs

LLM-generated summaries over bounded evidence.

| Column              | Type        | Constraints               | Purpose                                          |
| ------------------- | ----------- | ------------------------- | ------------------------------------------------ |
| id                  | serial      | PK                        | Auto-increment                                   |
| evidence_bundle_id  | integer     | FK → evidence_bundles.id  | Link to the bundle this brief summarizes         |
| prompt_version      | varchar(32) | NOT NULL                  | Prompt template version used                     |
| model_provider      | varchar(64) | NOT NULL                  | E.g., "claude-3.5-sonnet", "gpt-4o"              |
| structured_output   | jsonb       | NOT NULL                  | The LLM's structured response                    |
| confidence          | varchar(16) | NOT NULL DEFAULT "medium" | "high" \| "medium" \| "low"                      |
| source_refs         | jsonb       |                           | References to source artifacts used in the brief |
| payload_hash        | varchar(64) | NOT NULL                  | SHA-256 of canonical brief content               |
| received_at_unix_ms | bigint      | NOT NULL                  | Insertion timestamp                              |

Indexes:

- `idx_brief_bundle_id` on (evidence_bundle_id, received_at_unix_ms)
- `idx_brief_model_provider` on (model_provider, received_at_unix_ms)

## Dependencies

New production dependencies:

- `drizzle-orm@^0.36` (matches regime-engine)
- `postgres` (postgres.js driver, matches regime-engine)

New dev dependencies:

- `drizzle-kit@^0.31` (migration tooling, matches regime-engine)

New scripts in package.json:

- `"db:generate": "drizzle-kit generate"`
- `"db:migrate": "drizzle-kit migrate"`
- `"db:push": "drizzle-kit push"`

New env vars in `.env.example`:

- `DATABASE_URL` — Postgres connection string with `?schema=intelligence`
- `PG_SSL` — Set to `"false"` to disable SSL (default: enabled)
- `PG_MAX_CONNECTIONS` — Max connection pool size (default: 10)

## Boundary rules

The dependency-cruiser rules must be updated to:

1. `src/db/` may import `drizzle-orm/pg-core` and `postgres` (core Node dependencies). It must not import from `application`, `jobs`, `adapters`, `scripts`, or `ports`.
2. `src/ports/` may import `contracts` and `domain` (unchanged). The new `db.ts` port defines a `DbConnection` interface. The repository ports import type utilities from `contracts` only.
3. `src/adapters/node/` may import `ports`, `contracts`, `db`, and Node builtins (unchanged direction, expanded to include `db` as a valid import target).
4. `src/application/` and `src/jobs/` may import repository ports from `ports/` but must not import `db/` directly.

The inner-layer prohibition on Node builtins remains: `domain`, `contracts`, `ports`, `application`, `jobs` must not import `drizzle-orm`, `postgres`, or any `db/` module.

## Migration strategy

First migration (`0000_create_intelligence_schema.sql`):

1. Create `intelligence` schema if not exists
2. Create `intelligence_reader` and `intelligence_writer` roles
3. Grant SELECT on all tables in `intelligence` to `intelligence_reader`
4. Grant SELECT, INSERT, UPDATE on all tables in `intelligence` to `intelligence_writer`

Subsequent migrations create tables and indexes. Drizzle Kit generates them from the schema definitions in `src/db/schema/`.

The `drizzle.config.ts` sets:

```typescript
migrations: {
  schema: "intelligence",
  table: "intelligence_migrations"
}
```

## DbConnection port

The `DbConnection` port abstracts the Drizzle instance creation so application code never imports Drizzle directly:

```typescript
export interface DbConnection {
  db: DrizzleDb;
  close(): Promise<void>;
}
```

The `DrizzlePgAdapter` implements this port using the `createDb` factory from `src/db/db.ts`, reading `DATABASE_URL` and `PG_SSL` from the `EnvReader` port.

## Content hashing

A utility function `canonicalHash(payload: unknown): string` in `src/domain/content-hash.ts` computes SHA-256 of a canonical JSON serialization of the payload. This lives in `domain/` because it's pure logic with no I/O.

Canonical serialization rules:

1. `JSON.stringify` with sorted keys (no replacer, no spaces)
2. UTF-8 encoding
3. SHA-256 hex digest

## Out of scope

- Modifying existing collectors to write to DB (INT-CORE #7)
- Defining freshness/provenance models (INT-TAXONOMY #6)
- Publishing evidence bundles to regime-engine (INT-PUBLISH #13)
- LLM brief generation (INT-BRIEFS #12)
- Retention enforcement jobs (future issue)
- Dual-write file + DB paths (INT-CORE #7 will replace file-backed primary)
- Contextual evidence tables (future extension of INT-TAXONOMY #6)

## Acceptance criteria

- [ ] `intelligence` schema and schema-scoped Postgres role provisioned on shared Railway cluster via first migration
- [ ] Drizzle config and first migration run against `intelligence` schema
- [ ] Five tables created with correct columns, types, indexes, and constraints
- [ ] Repository ports exist for all five tables behind the `ports/` layer boundary
- [ ] Drizzle adapters implement all repository ports in `adapters/node/`
- [ ] In-memory fakes implement all repository ports in `tests/fakes/`
- [ ] Content hashing utility exists in `domain/` with unit tests
- [ ] Duplicate payload detection works (idempotent upsert by hash)
- [ ] Input lineage is modeled as JSONB on relevant tables
- [ ] Retention policy is documented per tier
- [ ] `pnpm verify` passes (typecheck, lint, format, tests, boundaries)
- [ ] Migrations and schema definition tests are included
- [ ] Boundary rules allow `db/` imports only from `adapters/` and top-level config
