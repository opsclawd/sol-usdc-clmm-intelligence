# Task Context: Task 1

Title: Define publish-attempt schema and migration

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-21
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-21
Start Commit: a667d3e61049b48e884f34b5b23245481766b91b

## Task Requirements

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

## Repository Targets

### Expected Files

- src/db/schema/publish-attempts.ts
- src/db/schema/index.ts
- tests/db/schema/publish-attempts.test.ts
- drizzle/0005_publish_attempts.sql
- drizzle/meta/0005_snapshot.json
- drizzle/meta/\_journal.json
- tests/db/migrations/publish-attempts.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/db/schema/publish-attempts.test.ts tests/db/migrations/publish-attempts.test.ts
git diff --check -- src/db/schema/publish-attempts.ts src/db/schema/index.ts tests/db/schema/publish-attempts.test.ts drizzle/0005_publish_attempts.sql drizzle/meta/0005_snapshot.json drizzle/meta/_journal.json tests/db/migrations/publish-attempts.test.ts
pnpm exec prettier --check src/db/schema/publish-attempts.ts src/db/schema/index.ts tests/db/schema/publish-attempts.test.ts drizzle/meta/0005_snapshot.json drizzle/meta/_journal.json tests/db/migrations/publish-attempts.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **retry-compatible attempt identity**: The unique identity is target plus idempotency key plus positive attempt number, so a higher attempt number creates a separate immutable row. (Test: `schema defines one row per positive attempt number with retry-compatible uniqueness`)
- **logical references without foreign keys**: Bundle and nullable brief IDs are indexed but have no foreign keys, allowing attempts to arrive before referenced evidence. (Test: `schema indexes logical bundle and nullable brief references without foreign keys`)
- **canonical status and HTTP constraints**: Only the ten publish statuses are accepted, and HTTP status is null or within 100 through 599. (Test: `migration enforces canonical publish statuses and valid HTTP statuses`)
- **positive attempts and coherent timestamps**: Attempt numbers are positive; timestamps are non-negative; completion is null or no earlier than first attempt. (Test: `migration rejects invalid attempt and timestamp values`)
- **documented out-of-order persistence**: The migration explicitly documents that logical references omit foreign keys to support append-only replay and restore ordering. (Test: `migration documents and preserves out-of-order logical references without foreign keys`)
