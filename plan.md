<!-- plan-review-required -->

# Publish Attempt Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an append-only, auditable persistence slice for Regime Engine evidence publish attempts, including the Postgres schema and migration, a repository port with equivalent Drizzle and in-memory implementations, focused tests, runtime wiring, and operator documentation.

**Architecture:** Store one immutable row per HTTP attempt in `intelligence.publish_attempts`. Retry rows share `(target, idempotency_key)` and increment `attempt_number`; only an exact duplicate attempt identity conflicts. `evidence_bundle_id` and nullable `research_brief_id` remain indexed application-level references with no foreign keys so replay and restore order stays decoupled. The port owns publish-specific status typing, the Node adapter owns SQL, and the test fake mirrors observable repository behavior.

**Tech Stack:** TypeScript 5.7, Drizzle ORM/Drizzle Kit, PostgreSQL, Vitest, pnpm.

---

**Goal details**

- Persist every outbound-attempt outcome independently so retries retain complete audit history.
- Support deterministic insert/conflict classification and the three required lookup shapes.
- Keep generated Drizzle migration metadata synchronized with the TypeScript schema.
- Document the deliberate no-foreign-key decision where maintainers and operators will see it.

**Non-goals**

- No outbound HTTP client, authentication, retry scheduler, backoff, or recovery loop.
- No Regime Engine evidence-contract mapping or policy synthesis.
- No changes to `evidence_bundles`, `research_briefs`, or the central signal taxonomy.
- No application-level existence checks for logical bundle/brief references in this persistence slice.
- No mutation/update/delete method for publish attempts.
- No migration execution against a shared or production database as part of implementation.

**Affected files (repository-relative full paths)**

- Create `src/db/schema/publish-attempts.ts` — Drizzle table, constraints, indexes, and inferred row types.
- Modify `src/db/schema/index.ts` — schema exports used by the typed Drizzle database.
- Create `tests/db/schema/publish-attempts.test.ts` — schema shape and metadata tests.
- Create `drizzle/0005_publish_attempts.sql` — generated migration, augmented with the no-FK rationale comment.
- Create `drizzle/meta/0005_snapshot.json` — generated Drizzle schema snapshot.
- Modify `drizzle/meta/_journal.json` — generated migration journal entry.
- Create `tests/db/migrations/publish-attempts.test.ts` — migration DDL and no-FK regression tests.
- Create `src/ports/publish-attempt-repo.ts` — publish status, row/input/outcome types, and repository interface.
- Modify `src/ports/index.ts` — public type exports for the new port.
- Create `src/adapters/node/drizzle-publish-attempt-repo.ts` — production repository implementation.
- Modify `src/adapters/node/composition-root.ts` — construct and expose the repository with persistence dependencies.
- Create `tests/fakes/fake-publish-attempt-repo.ts` — deterministic in-memory implementation.
- Modify `tests/fakes/index.ts` — test-fake export.
- Create `tests/ports/publish-attempt-repo.test.ts` — fake-backed repository contract tests.
- Create `tests/adapters/node/drizzle-publish-attempt-repo.integration.test.ts` — Postgres adapter parity and constraint tests.
- Modify `docs/architecture.md` — persistence model and no-FK design note.
- Modify `docs/operator-runbook.md` — inspection, migration, and troubleshooting queries.

**Behavioral invariants**

1. **Append-only retry:** Given the same target and idempotency key at attempt `N`, inserting attempt `N + 1` creates a second row and never mutates attempt `N`.
2. **Exact attempt collision:** Given an existing `(target, idempotency_key, attempt_number)`, another insert returns `conflict` with the stored row and leaves storage unchanged.
3. **Out-of-order logical references:** A row persists even when its bundle ID or nullable brief ID does not exist in the referenced tables, because no DB foreign keys are present.
4. **Nullable brief reference:** A publish attempt with `research_brief_id = null` persists and round-trips as null.
5. **Constraint enforcement:** Unsupported statuses, HTTP values outside `100..599`, non-positive attempt numbers, negative timestamps, or completion before first attempt are rejected.
6. **Idempotency lookup ordering:** Target/key lookup returns all attempts ordered by `attempt_number ASC, id ASC`.
7. **Bundle lookup ordering:** Bundle lookup returns matching attempts ordered by `received_at_unix_ms DESC, id DESC`.
8. **Bounded status lookup:** Status/recency lookup includes only matching rows at or after `sinceUnixMs`, applies a positive integer limit, and returns newest rows first with ID as a deterministic tie-breaker.
9. **Adapter parity:** The fake and Drizzle implementations expose the same result shapes, ordering, conflict behavior, nullable JSON/error fields, and validation semantics observable through the port.

**Automatic implementation gate**

After every implementation step, the execution environment runs `pnpm -r typecheck` workspace-wide. Task 2 therefore introduces the port, every implementation (Drizzle and fake), exports, and composition-root wiring together; it must not be split by architectural layer. The task-specific commands below remain limited to files each task changes.

## Task 1: Define publish-attempt schema and migration

**Files:**

- Create: `src/db/schema/publish-attempts.ts`
- Modify: `src/db/schema/index.ts`
- Create: `tests/db/schema/publish-attempts.test.ts`
- Create: `drizzle/0005_publish_attempts.sql`
- Create: `drizzle/meta/0005_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Create: `tests/db/migrations/publish-attempts.test.ts`

**Invariants to test first:**

- `schema defines one row per positive attempt number with retry-compatible uniqueness`
- `schema indexes logical bundle and nullable brief references without foreign keys`
- `migration enforces canonical publish statuses and valid HTTP statuses`
- `migration rejects invalid attempt and timestamp values`
- `migration documents and preserves out-of-order logical references without foreign keys`

- [ ] **Step 1: Write the failing Drizzle schema tests.**

Create `tests/db/schema/publish-attempts.test.ts`. Use `getColumnNames()` plus `getTableConfig()` from `drizzle-orm/pg-core`. Assert all 17 required TypeScript column keys exactly:

```ts
const REQUIRED_COLUMNS = [
  "id",
  "target",
  "targetEndpoint",
  "evidenceBundleId",
  "researchBriefId",
  "idempotencyKey",
  "requestHash",
  "payloadHash",
  "status",
  "httpStatus",
  "responseBody",
  "errorCode",
  "errorMessage",
  "attemptNumber",
  "firstAttemptedAtUnixMs",
  "completedAtUnixMs",
  "receivedAtUnixMs"
] as const;
```

The tests must verify:

- the table belongs to schema `intelligence` and is named `publish_attempts`;
- required fields are `NOT NULL`, while `researchBriefId`, `httpStatus`, `responseBody`, `errorCode`, `errorMessage`, and `completedAtUnixMs` are nullable;
- the named unique index is exactly `uniq_pub_attempt_idem` over target, idempotency key, and attempt number;
- indexes are named `idx_pub_attempt_bundle`, `idx_pub_attempt_brief`, `idx_pub_attempt_status_recency`, and `idx_pub_attempt_target_idem`;
- the table config has no foreign keys;
- checks are named `chk_pub_attempt_status`, `chk_pub_attempt_http_status`, `chk_pub_attempt_number`, `chk_pub_attempt_first_timestamp`, `chk_pub_attempt_completed_timestamp`, `chk_pub_attempt_received_timestamp`, and `chk_pub_attempt_completion_order`.

- [ ] **Step 2: Run the schema test and confirm it fails because the module does not exist.**

Run:

```bash
pnpm exec vitest run tests/db/schema/publish-attempts.test.ts
```

Expected: FAIL resolving `src/db/schema/publish-attempts.js` or finding the `publishAttempts` export.

- [ ] **Step 3: Add the Drizzle table and schema exports.**

Create `src/db/schema/publish-attempts.ts` with this shape and no imports of the evidence/brief tables:

```ts
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  serial,
  text,
  uniqueIndex,
  varchar
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { intelligence } from "./intelligence.js";

export const publishAttempts = intelligence.table(
  "publish_attempts",
  {
    id: serial("id").primaryKey(),
    target: varchar("target", { length: 64 }).notNull(),
    targetEndpoint: text("target_endpoint").notNull(),
    evidenceBundleId: integer("evidence_bundle_id").notNull(),
    researchBriefId: integer("research_brief_id"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    httpStatus: integer("http_status"),
    responseBody: jsonb("response_body"),
    errorCode: varchar("error_code", { length: 128 }),
    errorMessage: text("error_message"),
    attemptNumber: integer("attempt_number").notNull(),
    firstAttemptedAtUnixMs: bigint("first_attempted_at_unix_ms", { mode: "number" }).notNull(),
    completedAtUnixMs: bigint("completed_at_unix_ms", { mode: "number" }),
    receivedAtUnixMs: bigint("received_at_unix_ms", { mode: "number" }).notNull()
  },
  (t) => [
    uniqueIndex("uniq_pub_attempt_idem").on(t.target, t.idempotencyKey, t.attemptNumber),
    index("idx_pub_attempt_bundle").on(t.evidenceBundleId),
    index("idx_pub_attempt_brief").on(t.researchBriefId),
    index("idx_pub_attempt_status_recency").on(t.status, t.receivedAtUnixMs),
    index("idx_pub_attempt_target_idem").on(t.target, t.idempotencyKey),
    check(
      "chk_pub_attempt_status",
      sql`${t.status} IN ('pending', 'sent', 'created', 'idempotent_replay', 'validation_failed', 'auth_failed', 'conflict', 'store_unavailable', 'network_failed', 'unknown_failed')`
    ),
    check(
      "chk_pub_attempt_http_status",
      sql`${t.httpStatus} IS NULL OR (${t.httpStatus} >= 100 AND ${t.httpStatus} <= 599)`
    ),
    check("chk_pub_attempt_number", sql`${t.attemptNumber} > 0`),
    check("chk_pub_attempt_first_timestamp", sql`${t.firstAttemptedAtUnixMs} >= 0`),
    check(
      "chk_pub_attempt_completed_timestamp",
      sql`${t.completedAtUnixMs} IS NULL OR ${t.completedAtUnixMs} >= 0`
    ),
    check("chk_pub_attempt_received_timestamp", sql`${t.receivedAtUnixMs} >= 0`),
    check(
      "chk_pub_attempt_completion_order",
      sql`${t.completedAtUnixMs} IS NULL OR ${t.completedAtUnixMs} >= ${t.firstAttemptedAtUnixMs}`
    )
  ]
);

export type PublishAttemptRow = typeof publishAttempts.$inferSelect;
export type PublishAttemptInsert = typeof publishAttempts.$inferInsert;
```

Append these exports to `src/db/schema/index.ts`:

```ts
export { publishAttempts } from "./publish-attempts.js";
export type { PublishAttemptRow, PublishAttemptInsert } from "./publish-attempts.js";
```

- [ ] **Step 4: Run the schema test and confirm it passes.**

Run:

```bash
pnpm exec vitest run tests/db/schema/publish-attempts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Generate the migration and inspect its exact scope before accepting it.**

Run:

```bash
pnpm exec drizzle-kit generate --name publish_attempts
git diff -- drizzle/0005_publish_attempts.sql drizzle/meta/0005_snapshot.json drizzle/meta/_journal.json
```

Expected: Drizzle creates only `drizzle/0005_publish_attempts.sql`, `drizzle/meta/0005_snapshot.json`, and the `idx: 5` journal entry. The SQL must create `intelligence.publish_attempts`, its seven checks, its four non-unique indexes, and its retry-compatible unique index. If the generated ordinal/name differs because the migration history has changed, stop under the stop conditions instead of silently editing unlisted migration paths.

Add this comment immediately above the `CREATE TABLE` statement without changing generated DDL:

```sql
-- evidence_bundle_id and research_brief_id are intentionally logical references without
-- FOREIGN KEY constraints: append-only audit records may be replayed/restored before
-- their evidence rows, and no cascade behavior is valid for immutable history.
```

- [ ] **Step 6: Write the failing migration regression tests.**

Create `tests/db/migrations/publish-attempts.test.ts`. Read only `drizzle/0005_publish_attempts.sql` and name the tests exactly as the Task 1 invariant list. Assertions must cover:

```ts
expect(sql).toContain('CREATE TABLE "intelligence"."publish_attempts"');
expect(sql).toContain('CONSTRAINT "chk_pub_attempt_status" CHECK');
expect(sql).toContain('CONSTRAINT "chk_pub_attempt_http_status" CHECK');
expect(sql).toMatch(
  /CREATE UNIQUE INDEX "uniq_pub_attempt_idem"[\s\S]*"target"[\s\S]*"idempotency_key"[\s\S]*"attempt_number"/
);
expect(sql).not.toMatch(/\bFOREIGN KEY\s*\(/i);
expect(sql).not.toMatch(/\bREFERENCES\s+"/i);
expect(sql).toContain("intentionally logical references");
```

Also assert the precise status literals, HTTP `100..599` bounds, `attempt_number > 0`, non-negative timestamp checks, completion ordering, all four named non-unique indexes, and unique identity column order. Do not merely count indexes or constraints.

- [ ] **Step 7: Run the focused schema and migration tests.**

Run:

```bash
pnpm exec vitest run tests/db/schema/publish-attempts.test.ts tests/db/migrations/publish-attempts.test.ts
```

Expected: PASS.

- [ ] **Step 8: Check only Task 1 edits and commit the schema slice.**

Run:

```bash
git diff --check -- src/db/schema/publish-attempts.ts src/db/schema/index.ts tests/db/schema/publish-attempts.test.ts drizzle/0005_publish_attempts.sql drizzle/meta/0005_snapshot.json drizzle/meta/_journal.json tests/db/migrations/publish-attempts.test.ts
pnpm exec prettier --check src/db/schema/publish-attempts.ts src/db/schema/index.ts tests/db/schema/publish-attempts.test.ts drizzle/meta/0005_snapshot.json drizzle/meta/_journal.json tests/db/migrations/publish-attempts.test.ts
git add src/db/schema/publish-attempts.ts src/db/schema/index.ts tests/db/schema/publish-attempts.test.ts drizzle/0005_publish_attempts.sql drizzle/meta/0005_snapshot.json drizzle/meta/_journal.json tests/db/migrations/publish-attempts.test.ts
git commit -m "feat: add publish attempt database schema"
```

Expected: focused tests pass, formatting checks pass, and the commit contains only Task 1 files.

**Task 1 acceptance criteria:**

- The schema has every required field with JSONB response storage and nullable outcome details.
- Retry attempt 2 is allowed; only a repeated exact attempt identity collides.
- No foreign key is present in schema metadata, SQL, or snapshot.
- SQL contains the rationale comment and generated artifacts are synchronized.

## Task 2: Add repository port, Drizzle adapter, fake, and runtime wiring

**Files:**

- Create: `src/ports/publish-attempt-repo.ts`
- Modify: `src/ports/index.ts`
- Create: `src/adapters/node/drizzle-publish-attempt-repo.ts`
- Modify: `src/adapters/node/composition-root.ts`
- Create: `tests/fakes/fake-publish-attempt-repo.ts`
- Modify: `tests/fakes/index.ts`
- Create: `tests/ports/publish-attempt-repo.test.ts`
- Create: `tests/adapters/node/drizzle-publish-attempt-repo.integration.test.ts`

**Invariants to test first:**

- `records a new immutable attempt as inserted`
- `records a higher retry number without mutating the previous attempt`
- `returns conflict and the stored winner for an exact attempt identity collision`
- `persists a missing bundle and missing brief as logical references`
- `round trips a nullable research brief and nullable response fields`
- `finds target attempts in attempt-number order`
- `finds bundle attempts in deterministic recency order`
- `bounds status lookups by status since time and limit`
- `rejects a non-positive or non-integer status-query limit`
- `rejects invalid status HTTP attempt and timestamp values consistently`
- `database constraints reject invalid persisted values when the adapter is bypassed`

- [ ] **Step 1: Write the fake-backed repository contract tests before the port or fake exists.**

Create `tests/ports/publish-attempt-repo.test.ts` with a `makeAttempt(overrides)` fixture whose base record uses target `regime-engine`, endpoint `/v1/evidence/sol-usdc`, bundle `9001`, hashes of 64 lowercase `a`/`b` characters, status `pending`, attempt 1, first-attempt time `1000`, null completion, and receive time `1001`.

Use the first ten repository invariant names above as `it(...)` names; the eleventh DB-only invariant is written in Step 6. For the collision test, assert the second result is:

```ts
{
  outcome: "conflict",
  row: expect.objectContaining({ id: first.row.id, attemptNumber: 1 })
}
```

For retry, insert attempt 1 and attempt 2 with the same target/key, then assert two distinct IDs and unchanged first-row values. For query ordering, deliberately insert rows out of time/attempt order. For invalid values, use `as PublishAttemptInsert` only at the test boundary to exercise runtime validation of invalid status, HTTP 99/600, attempt 0, negative first/received/completed times, and completion before first attempt.

Also assert `findRecentByStatus(..., 0)`, `-1`, and `1.5` reject with `limit must be a positive integer`.

- [ ] **Step 2: Run the contract test and verify the missing port/fake failure.**

Run:

```bash
pnpm exec vitest run tests/ports/publish-attempt-repo.test.ts
```

Expected: FAIL resolving the new port or fake.

- [ ] **Step 3: Define the port types and export them.**

Create `src/ports/publish-attempt-repo.ts` with this repository contract (the validation exports described in Step 4 live in the same module):

```ts
export type PublishAttemptStatus =
  | "pending"
  | "sent"
  | "created"
  | "idempotent_replay"
  | "validation_failed"
  | "auth_failed"
  | "conflict"
  | "store_unavailable"
  | "network_failed"
  | "unknown_failed";

export interface PublishAttemptRow {
  id: number;
  target: string;
  targetEndpoint: string;
  evidenceBundleId: number;
  researchBriefId: number | null;
  idempotencyKey: string;
  requestHash: string;
  payloadHash: string;
  status: PublishAttemptStatus;
  httpStatus: number | null;
  responseBody: unknown | null;
  errorCode: string | null;
  errorMessage: string | null;
  attemptNumber: number;
  firstAttemptedAtUnixMs: number;
  completedAtUnixMs: number | null;
  receivedAtUnixMs: number;
}

export interface PublishAttemptInsert {
  target: string;
  targetEndpoint: string;
  evidenceBundleId: number;
  researchBriefId?: number | null;
  idempotencyKey: string;
  requestHash: string;
  payloadHash: string;
  status: PublishAttemptStatus;
  httpStatus?: number | null;
  responseBody?: unknown | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  attemptNumber: number;
  firstAttemptedAtUnixMs: number;
  completedAtUnixMs?: number | null;
  receivedAtUnixMs: number;
}

export type PublishAttemptInsertOutcome =
  | { readonly outcome: "inserted"; readonly row: PublishAttemptRow }
  | { readonly outcome: "conflict"; readonly row: PublishAttemptRow };

export interface PublishAttemptRepo {
  insert(row: PublishAttemptInsert): Promise<PublishAttemptInsertOutcome>;
  findByTargetAndKey(target: string, idempotencyKey: string): Promise<PublishAttemptRow[]>;
  findByBundle(evidenceBundleId: number): Promise<PublishAttemptRow[]>;
  findRecentByStatus(
    status: PublishAttemptStatus,
    sinceUnixMs: number,
    limit: number
  ): Promise<PublishAttemptRow[]>;
}
```

Export all five public types from `src/ports/index.ts`.

- [ ] **Step 4: Implement one shared validation rule set and the fake adapter.**

Keep validation in `src/ports/publish-attempt-repo.ts` as an exported `validatePublishAttemptInsert(row): void` function so both adapters fail consistently before persistence. It must use a `Set<PublishAttemptStatus>` containing all ten statuses and throw specific errors for unsupported status, HTTP outside `100..599`, non-positive/non-integer attempt number, negative/non-integer timestamps, and completion before first attempt. Add `validatePublishAttemptQueryLimit(limit): void` for the positive integer rule.

Create `tests/fakes/fake-publish-attempt-repo.ts` implementing every method. Its key behavior is:

```ts
const existing = this.store.find(
  (stored) =>
    stored.target === row.target &&
    stored.idempotencyKey === row.idempotencyKey &&
    stored.attemptNumber === row.attemptNumber
);
if (existing) return { outcome: "conflict", row: existing };
```

Normalize every optional nullable field with `?? null`, append a newly assigned row without later mutation, and sort copies rather than the backing store:

```ts
rows.sort((a, b) => a.attemptNumber - b.attemptNumber || a.id - b.id);
rows.sort((a, b) => b.receivedAtUnixMs - a.receivedAtUnixMs || b.id - a.id);
```

The status query filters `status` and `receivedAtUnixMs >= sinceUnixMs`, sorts by recency/ID descending, then slices to `limit`. Export `FakePublishAttemptRepo` from `tests/fakes/index.ts`.

- [ ] **Step 5: Run the fake-backed contract tests and confirm they pass.**

Run:

```bash
pnpm exec vitest run tests/ports/publish-attempt-repo.test.ts
```

Expected: PASS.

- [ ] **Step 6: Write the Drizzle integration tests before adding the adapter.**

Create `tests/adapters/node/drizzle-publish-attempt-repo.integration.test.ts` following the existing `TEST_DATABASE_URL` conditional pattern. When configured, create `DrizzlePublishAttemptRepo`, delete only `publishAttempts` before each test, and cover the same eleven named invariants. In particular:

- insert arbitrary bundle/brief IDs that are absent from their tables and expect success;
- insert `researchBriefId: null` and null response/error/completion values and assert exact null round-trip;
- insert attempts 1 and 2 for one target/key and assert both are returned;
- repeat attempt 1 and assert `conflict`, the original row ID, and a single stored row;
- verify all three query order/filter contracts;
- bypass TypeScript using casts for invalid status/HTTP/number/time records and expect rejects matching the shared validation messages.
- bypass the adapter using `db.insert(publishAttempts).values(...)` for one invalid value per named check constraint and assert PostgreSQL rejects the insert; this proves enforcement remains at the DB layer even if a future caller does not use the repository validator.

When `TEST_DATABASE_URL` is absent, retain the repository convention of one explicit passing skip test.

- [ ] **Step 7: Implement the Drizzle adapter with deterministic conflict reload and queries.**

Create `src/adapters/node/drizzle-publish-attempt-repo.ts`. `toPortRow()` must preserve JSON/null values and cast only the checked status. `insert()` must validate first, use `.onConflictDoNothing({ target: [publishAttempts.target, publishAttempts.idempotencyKey, publishAttempts.attemptNumber] })`, and return `inserted` when `.returning()` yields a row.

On conflict, reload exactly the unique identity and return `{ outcome: "conflict", row }`. If no row is found after the conflict, throw:

```ts
throw new Error("Publish attempt conflict row disappeared before reload");
```

Implement query ordering exactly:

```ts
// target/key
.orderBy(asc(publishAttempts.attemptNumber), asc(publishAttempts.id));

// bundle and recent status
.orderBy(desc(publishAttempts.receivedAtUnixMs), desc(publishAttempts.id));
```

The status query must validate `limit`, filter with `and(eq(status), gte(receivedAtUnixMs, sinceUnixMs))`, and apply `.limit(limit)`.

- [ ] **Step 8: Wire the adapter into the existing composition root in the same port-change task.**

In `src/adapters/node/composition-root.ts`:

- import the `PublishAttemptRepo` type;
- add required `publishAttemptRepo: PublishAttemptRepo` to `Persistence`;
- dynamically import `DrizzlePublishAttemptRepo` beside the other persistence adapters;
- instantiate it with `connection.db`;
- include it in the returned persistence object.

Do not expose publisher behavior or add a new job/application service.

- [ ] **Step 9: Run the focused contract and integration tests.**

Run:

```bash
pnpm exec vitest run tests/ports/publish-attempt-repo.test.ts tests/adapters/node/drizzle-publish-attempt-repo.integration.test.ts
```

Expected: PASS; the integration file reports the conventional explicit skip test when `TEST_DATABASE_URL` is unset, and exercises Postgres when it is set.

- [ ] **Step 10: Check only Task 2 edits and commit the complete port/adapter slice.**

Run:

```bash
git diff --check -- src/ports/publish-attempt-repo.ts src/ports/index.ts src/adapters/node/drizzle-publish-attempt-repo.ts src/adapters/node/composition-root.ts tests/fakes/fake-publish-attempt-repo.ts tests/fakes/index.ts tests/ports/publish-attempt-repo.test.ts tests/adapters/node/drizzle-publish-attempt-repo.integration.test.ts
pnpm exec eslint src/ports/publish-attempt-repo.ts src/ports/index.ts src/adapters/node/drizzle-publish-attempt-repo.ts src/adapters/node/composition-root.ts tests/fakes/fake-publish-attempt-repo.ts tests/fakes/index.ts tests/ports/publish-attempt-repo.test.ts tests/adapters/node/drizzle-publish-attempt-repo.integration.test.ts --max-warnings 0
pnpm exec prettier --check src/ports/publish-attempt-repo.ts src/ports/index.ts src/adapters/node/drizzle-publish-attempt-repo.ts src/adapters/node/composition-root.ts tests/fakes/fake-publish-attempt-repo.ts tests/fakes/index.ts tests/ports/publish-attempt-repo.test.ts tests/adapters/node/drizzle-publish-attempt-repo.integration.test.ts
git add src/ports/publish-attempt-repo.ts src/ports/index.ts src/adapters/node/drizzle-publish-attempt-repo.ts src/adapters/node/composition-root.ts tests/fakes/fake-publish-attempt-repo.ts tests/fakes/index.ts tests/ports/publish-attempt-repo.test.ts tests/adapters/node/drizzle-publish-attempt-repo.integration.test.ts
git commit -m "feat: add publish attempt repositories"
```

Expected: focused tests, lint, and formatting pass; the automatic workspace typecheck gate also passes because the port and every implementation were changed together.

**Task 2 acceptance criteria:**

- Both implementations satisfy their ten shared repository invariants, and the configured Postgres integration run additionally proves the DB constraints cannot be bypassed.
- Every query is deterministic and the status query is bounded.
- Duplicate exact attempts classify as conflicts without mutation; retries remain separate rows.
- Runtime persistence exposes the new repository without introducing publisher logic.

## Task 3: Document publish-attempt persistence operations and rationale

**Files:**

- Modify: `docs/architecture.md`
- Modify: `docs/operator-runbook.md`

- [ ] **Step 1: Add the durable architecture decision.**

Add a `Publish-attempt persistence` subsection to the persistence portion of `docs/architecture.md`. State all of the following explicitly:

- one immutable row represents one HTTP attempt;
- `(target, idempotency_key, attempt_number)` is the unique attempt identity;
- the same target/key with a greater attempt number is a retry, not a conflict;
- bundle and nullable brief IDs are indexed logical references with intentionally no FKs or cascades;
- out-of-order replay/restore is supported, while application consumers must tolerate temporarily unresolved references;
- the repository records audit outcomes only and does not decide policy or implement transport/retries.

Include this compact lineage annotation:

```text
evidence_bundles/research_briefs  ...logical reference...>  publish_attempts
                                      (no DB foreign key)
```

- [ ] **Step 2: Add operator inspection and safety notes.**

Add a `Publish-attempt persistence` subsection to `docs/operator-runbook.md` with these exact read-only checks:

```sql
SELECT target, idempotency_key, attempt_number, status, http_status, received_at_unix_ms
FROM intelligence.publish_attempts
WHERE target = '<target>' AND idempotency_key = '<idempotency-key>'
ORDER BY attempt_number ASC, id ASC;

SELECT status, COUNT(*) AS attempts
FROM intelligence.publish_attempts
WHERE received_at_unix_ms >= <since-unix-ms>
GROUP BY status
ORDER BY status;

SELECT pa.id, pa.evidence_bundle_id, pa.research_brief_id
FROM intelligence.publish_attempts AS pa
LEFT JOIN intelligence.evidence_bundles AS eb ON eb.id = pa.evidence_bundle_id
LEFT JOIN intelligence.research_briefs AS rb ON rb.id = pa.research_brief_id
WHERE eb.id IS NULL OR (pa.research_brief_id IS NOT NULL AND rb.id IS NULL);
```

Explain that the final query is diagnostic, not proof of corruption: logical references may temporarily be unresolved during replay. Warn operators not to add FKs, cascades, repair updates, or deletes; append a higher attempt number for a real retry. Mention `pnpm db:migrate` as the normal migration command but do not instruct the implementation worker to execute it against shared infrastructure.

- [ ] **Step 3: Review only the documentation diff and commit it.**

Run:

```bash
git diff --check -- docs/architecture.md docs/operator-runbook.md
git diff -- docs/architecture.md docs/operator-runbook.md
git add docs/architecture.md docs/operator-runbook.md
git commit -m "docs: explain publish attempt audit persistence"
```

Expected: no whitespace errors; the displayed diff contains the model, no-FK rationale, read-only queries, and operational warnings without describing an implemented HTTP publisher.

**Task 3 acceptance criteria:**

- A later schema reviewer can see why FKs and cascades are forbidden.
- An operator can inspect retries, status volume, and temporarily unresolved references without mutating audit history.
- Documentation preserves the authority boundary: persistence records outcomes but does not synthesize policy.

**Tests to add or update**

- `tests/db/schema/publish-attempts.test.ts`: new schema metadata coverage.
- `tests/db/migrations/publish-attempts.test.ts`: new generated-DDL and intentional-no-FK coverage.
- `tests/ports/publish-attempt-repo.test.ts`: new fake-backed repository contract and invariants.
- `tests/adapters/node/drizzle-publish-attempt-repo.integration.test.ts`: new Postgres parity, constraint, ordering, retry, nullable-reference, and out-of-order-reference coverage.
- No existing test file is enlarged. The oversized-existing-test split rule therefore does not apply.

**Validation commands**

Task-scoped acceptance commands are embedded in each task. After all implementation tasks complete, the orchestrator's dedicated validate phase may run the repository-wide gate:

```bash
pnpm verify
```

This is not a standalone implementation task and must not be turned into one. If `TEST_DATABASE_URL` is available in the validation environment, additionally run the already-scoped integration file:

```bash
pnpm exec vitest run tests/adapters/node/drizzle-publish-attempt-repo.integration.test.ts
```

**Risk areas**

- Drizzle may generate a different migration ordinal if the branch gains migrations; continuing with stale manifest paths would desynchronize review tooling.
- An accidental FK import or generated `REFERENCES` clause would break replay ordering and violate the central design decision.
- Using `(target, idempotency_key)` alone as unique identity would reject all retries after attempt 1.
- Returning database-natural order would make fake/Postgres behavior diverge and tests flaky.
- Treating a duplicate attempt as an identical replay would hide races; the selected contract deliberately reports `conflict`.
- JavaScript `number` timestamps must remain within the established safe-integer operating range; this slice follows existing bigint `{ mode: "number" }` conventions rather than introducing a new bigint API.
- Integration tests skip without `TEST_DATABASE_URL`; schema/migration tests still protect generated structure, but a configured DB run is the strongest constraint proof.
- Full JSONB responses may grow storage; retention policy is intentionally deferred rather than invented in this issue.

**Stop conditions**

- Stop if `src/db/schema/evidence-bundles.ts`, `src/db/schema/research-briefs.ts`, or the taxonomy foundations described by issues #5/#6 are absent or materially incompatible; do not redesign those tables in this issue.
- Stop if migration generation changes any existing table, rewrites a prior migration/snapshot, produces an ordinal other than the expected `0005`, or includes a foreign key; inspect branch drift before proceeding.
- Stop if satisfying a test appears to require outbound HTTP, credentials, a retry loop, policy logic, or application-level reference enforcement; those are explicit non-goals.
- Stop rather than run `pnpm db:migrate`, `pnpm db:push`, or destructive SQL against shared infrastructure without explicit operator authorization.
- Stop if existing publish-attempt data/table state is discovered with a conflicting shape; do not rewrite or delete audit history.
- Stop if the port cannot be introduced together with the Drizzle adapter, fake, and composition-root update in Task 2; never leave an interface-only commit that fails the automatic workspace typecheck gate.

**Self-review record**

- Spec coverage: every issue field, constraint, index, repository method, fake/adapter parity requirement, migration artifact, no-FK rationale, and documentation requirement maps to Tasks 1–3.
- Placeholder scan: no implementation placeholders or deferred error-handling instructions remain.
- Type consistency: `PublishAttemptStatus`, `PublishAttemptInsert`, `PublishAttemptRow`, `PublishAttemptInsertOutcome`, and `PublishAttemptRepo` names and method signatures are identical across tests, adapters, exports, runtime wiring, and the manifest.
- Review classification: required because the planned adapter performs irreversible append-only database writes and includes a deterministic conflict/reload path.
