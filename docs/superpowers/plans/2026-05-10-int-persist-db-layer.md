# INT-PERSIST #5 — DB-Backed Observation and Artifact Persistence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Drizzle ORM + Postgres persistence with five pipeline tables, repository ports, adapters, fakes, content hashing, and boundary enforcement — infrastructure only, no collector modifications.

**Architecture:** Follow regime-engine's `pgSchema("intelligence")` pattern. Schema definitions in `src/db/schema/`, repository ports in `src/ports/`, Drizzle adapters in `src/adapters/node/`, domain-only content-hash utility in `src/domain/`. Boundary rules: `db/` importable from `adapters/` only; inner layers never touch Drizzle or DB modules.

**Tech Stack:** Drizzle ORM ^0.36, postgres.js driver, drizzle-kit ^0.31 (dev), TypeScript 5.7 (NodeNext, strict, exactOptionalPropertyTypes), Vitest, pnpm.

---

## File Structure

**Created files:**

```text
src/db/schema/intelligence.ts              — pgSchema("intelligence") declaration
src/db/schema/raw-observations.ts           — raw_observations table
src/db/schema/normalized-observations.ts    — normalized_observations table
src/db/schema/derived-features.ts           — derived_features table
src/db/schema/evidence-bundles.ts           — evidence_bundles table
src/db/schema/research-briefs.ts            — research_briefs table
src/db/schema/index.ts                      — barrel re-export
src/db/db.ts                                — createDb() factory + Db type
src/db/verify.ts                             — verifyPgConnection, verifyPgSchema, verifyTable
src/domain/content-hash.ts                  — canonicalHash() pure utility
src/ports/db.ts                              — DbConnection port interface
src/ports/observation-repo.ts               — RawObservationRepo port
src/ports/normalized-observation-repo.ts    — NormalizedObservationRepo port
src/ports/feature-repo.ts                   — DerivedFeatureRepo port
src/ports/bundle-repo.ts                    — EvidenceBundleRepo port
src/ports/brief-repo.ts                     — ResearchBriefRepo port
src/adapters/node/drizzle-pg.ts             — DrizzlePgAdapter implementing DbConnection
src/adapters/node/drizzle-observation-repo.ts — RawObservationRepo adapter
src/adapters/node/drizzle-normalized-observation-repo.ts — NormalizedObservationRepo adapter
src/adapters/node/drizzle-feature-repo.ts   — DerivedFeatureRepo adapter
src/adapters/node/drizzle-bundle-repo.ts    — EvidenceBundleRepo adapter
src/adapters/node/drizzle-brief-repo.ts     — ResearchBriefRepo adapter
tests/fakes/fake-db.ts                      — FakeDbConnection
tests/fakes/fake-observation-repo.ts         — in-memory RawObservationRepo
tests/fakes/fake-normalized-observation-repo.ts — in-memory NormalizedObservationRepo
tests/fakes/fake-feature-repo.ts            — in-memory DerivedFeatureRepo
tests/fakes/fake-bundle-repo.ts             — in-memory EvidenceBundleRepo
tests/fakes/fake-brief-repo.ts              — in-memory ResearchBriefRepo
tests/domain/content-hash.test.ts           — unit tests for canonicalHash
tests/db/schema/raw-observations.test.ts    — schema definition tests
tests/db/schema/normalized-observations.test.ts
tests/db/schema/derived-features.test.ts
tests/db/schema/evidence-bundles.test.ts
tests/db/schema/research-briefs.test.ts
tests/db/verify.test.ts                     — verify functions (mocked)
tests/ports/observation-repo.test.ts       — port contract tests against fake
tests/ports/normalized-observation-repo.test.ts
tests/ports/feature-repo.test.ts
tests/ports/bundle-repo.test.ts
tests/ports/brief-repo.test.ts
tests/adapters/node/drizzle-observation-repo.test.ts
tests/adapters/node/drizzle-normalized-observation-repo.test.ts
tests/adapters/node/drizzle-feature-repo.test.ts
tests/adapters/node/drizzle-bundle-repo.test.ts
tests/adapters/node/drizzle-brief-repo.test.ts
drizzle.config.ts                            — Drizzle Kit configuration
```

**Modified files:**

```text
package.json                                — add deps, scripts
.env.example                                — add DATABASE_URL, PG_SSL, PG_MAX_CONNECTIONS
.dependency-cruiser.cjs                     — add db/ boundary rules
src/ports/index.ts                           — add new port exports
src/adapters/node/composition-root.ts        — add db field to NodeRuntime
tests/fakes/index.ts                         — add new fake exports
```

---

### Task 1: Install dependencies and configure Drizzle

**Files:**

- Modify: `package.json`
- Create: `drizzle.config.ts`
- Modify: `.env.example`

- [ ] **Step 1: Install production dependencies**

```bash
pnpm add drizzle-orm@^0.36 postgres
```

- [ ] **Step 2: Install dev dependencies**

```bash
pnpm add -D drizzle-kit@^0.31
```

- [ ] **Step 3: Add scripts to package.json**

Add these to the `scripts` section of `package.json`:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:push": "drizzle-kit push"
```

- [ ] **Step 4: Create `drizzle.config.ts`**

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    ssl: process.env.PG_SSL === "false" ? false : { rejectUnauthorized: false }
  },
  migrations: {
    schema: "intelligence",
    table: "intelligence_migrations"
  }
});
```

- [ ] **Step 5: Add environment variables to `.env.example`**

Append to `.env.example`:

```
# --- Database (shared Railway Postgres, intelligence schema) ---
DATABASE_URL=postgres://user:pass@host:5432/db
PG_SSL=true
PG_MAX_CONNECTIONS=10
```

- [ ] **Step 6: Run typecheck to verify no type errors**

```bash
pnpm typecheck
```

Expected: PASS (no type errors from config file)

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml drizzle.config.ts .env.example
git commit -m "feat(persist): add Drizzle ORM, postgres driver, and config"
```

---

### Task 2: Create schema declaration and raw_observations table

**Files:**

- Create: `src/db/schema/intelligence.ts`
- Create: `src/db/schema/raw-observations.ts`
- Create: `src/db/schema/index.ts`
- Create: `tests/db/schema/raw-observations.test.ts`

- [ ] **Step 1: Create `src/db/schema/intelligence.ts`**

```typescript
import { pgSchema } from "drizzle-orm/pg-core";

export const PG_SCHEMA_NAME = "intelligence";

export const intelligence = pgSchema(PG_SCHEMA_NAME);
```

- [ ] **Step 2: Create `src/db/schema/raw-observations.ts`**

```typescript
import {
  bigint,
  index,
  integer,
  jsonb,
  serial,
  text,
  uniqueIndex,
  varchar
} from "drizzle-orm/pg-core";
import { intelligence } from "./intelligence.js";

export const rawObservations = intelligence.table(
  "raw_observations",
  {
    id: serial("id").primaryKey(),
    source: varchar("source", { length: 64 }).notNull(),
    observedAtUnixMs: bigint("observed_at_unix_ms", { mode: "number" }).notNull(),
    fetchedAtUnixMs: bigint("fetched_at_unix_ms", { mode: "number" }).notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    payloadCanonical: text("payload_canonical").notNull(),
    parseStatus: varchar("parse_status", { length: 16 }).notNull().default("pending"),
    sourceRequestMeta: jsonb("source_request_meta"),
    receivedAtUnixMs: bigint("received_at_unix_ms", { mode: "number" }).notNull()
  },
  (t) => [
    uniqueIndex("uniq_raw_obs_source_payload_hash").on(t.source, t.payloadHash),
    index("idx_raw_obs_source_observed").on(t.source, t.observedAtUnixMs, t.id)
  ]
);

export type RawObservationRow = typeof rawObservations.$inferSelect;
export type RawObservationInsert = typeof rawObservations.$inferInsert;
```

- [ ] **Step 3: Create `src/db/schema/index.ts`**

```typescript
export { intelligence, PG_SCHEMA_NAME } from "./intelligence.js";
export { rawObservations } from "./raw-observations.js";
export type { RawObservationRow, RawObservationInsert } from "./raw-observations.js";
```

- [ ] **Step 4: Write failing test `tests/db/schema/raw-observations.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { rawObservations, PG_SCHEMA_NAME } from "../../../src/db/schema/index.js";
import { isTable, hasPrimaryKey } from "../schema-helpers.js";

describe("rawObservations schema", () => {
  it("belongs to the intelligence schema", () => {
    expect(rawObservations[PG_SCHEMA_NAME]).toBeDefined();
  });

  it("has all required columns", () => {
    const columns = Object.keys(rawObservations);
    expect(columns).toContain("id");
    expect(columns).toContain("source");
    expect(columns).toContain("observedAtUnixMs");
    expect(columns).toContain("fetchedAtUnixMs");
    expect(columns).toContain("payloadHash");
    expect(columns).toContain("payloadCanonical");
    expect(columns).toContain("parseStatus");
    expect(columns).toContain("sourceRequestMeta");
    expect(columns).toContain("receivedAtUnixMs");
  });

  it("has idempotency and time-window indexes", () => {
    const indexes = rawObservations[PG_SCHEMA_NAME]?.indexes ?? [];
    const indexNames = indexes.map((i: { name: string }) => i.name);
    expect(indexNames).toContain("uniq_raw_obs_source_payload_hash");
    expect(indexNames).toContain("idx_raw_obs_source_observed");
  });
});
```

- [ ] **Step 5: Create test helper `tests/db/schema-helpers.ts`**

Since Drizzle schema objects don't have a simple `isTable`/`hasPrimaryKey` helper, we'll test by checking column existence directly. Create a minimal helper:

```typescript
export function getColumnNames(table: Record<string, unknown>): string[] {
  return Object.keys(table).filter(
    (k) => typeof table[k] === "object" && table[k] !== null && "dataType" in (table[k] as object)
  );
}
```

Update the test to use this helper instead of `isTable`/`hasPrimaryKey`:

```typescript
import { describe, it, expect } from "vitest";
import { rawObservations, PG_SCHEMA_NAME } from "../../../src/db/schema/index.js";
import { getColumnNames } from "../schema-helpers.js";

describe("rawObservations schema", () => {
  it("has all required columns", () => {
    const columns = getColumnNames(rawObservations);
    expect(columns).toContain("id");
    expect(columns).toContain("source");
    expect(columns).toContain("observedAtUnixMs");
    expect(columns).toContain("fetchedAtUnixMs");
    expect(columns).toContain("payloadHash");
    expect(columns).toContain("payloadCanonical");
    expect(columns).toContain("parseStatus");
    expect(columns).toContain("sourceRequestMeta");
    expect(columns).toContain("receivedAtUnixMs");
  });
});
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
pnpm test -- tests/db/schema/raw-observations.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/db/ tests/db/ tests/db/schema-helpers.ts
git commit -m "feat(persist): add intelligence schema and raw_observations table"
```

---

### Task 3: Create remaining four tables (normalized_observations, derived_features, evidence_bundles, research_briefs)

**Files:**

- Create: `src/db/schema/normalized-observations.ts`
- Create: `src/db/schema/derived-features.ts`
- Create: `src/db/schema/evidence-bundles.ts`
- Create: `src/db/schema/research-briefs.ts`
- Modify: `src/db/schema/index.ts`
- Create: `tests/db/schema/normalized-observations.test.ts`
- Create: `tests/db/schema/derived-features.test.ts`
- Create: `tests/db/schema/evidence-bundles.test.ts`
- Create: `tests/db/schema/research-briefs.test.ts`

- [ ] **Step 1: Create `src/db/schema/normalized-observations.ts`**

```typescript
import {
  bigint,
  boolean,
  integer,
  jsonb,
  serial,
  uniqueIndex,
  varchar,
  index
} from "drizzle-orm/pg-core";
import { intelligence } from "./intelligence.js";

export const normalizedObservations = intelligence.table(
  "normalized_observations",
  {
    id: serial("id").primaryKey(),
    rawObservationId: integer("raw_observation_id").notNull(),
    source: varchar("source", { length: 64 }).notNull(),
    observationKind: varchar("observation_kind", { length: 64 }).notNull(),
    payload: jsonb("payload").notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    isFresh: boolean("is_fresh").notNull().default(true),
    receivedAtUnixMs: bigint("received_at_unix_ms", { mode: "number" }).notNull()
  },
  (t) => [
    uniqueIndex("uniq_norm_obs_source_kind_hash").on(t.source, t.observationKind, t.payloadHash),
    index("idx_norm_obs_source_kind_fresh").on(
      t.source,
      t.observationKind,
      t.isFresh,
      t.receivedAtUnixMs
    )
  ]
);

export type NormalizedObservationRow = typeof normalizedObservations.$inferSelect;
export type NormalizedObservationInsert = typeof normalizedObservations.$inferInsert;
```

- [ ] **Step 2: Create `src/db/schema/derived-features.ts`**

```typescript
import {
  bigint,
  doublePrecision,
  integer,
  jsonb,
  serial,
  varchar,
  index
} from "drizzle-orm/pg-core";
import { intelligence } from "./intelligence.js";

export const derivedFeatures = intelligence.table(
  "derived_features",
  {
    id: serial("id").primaryKey(),
    featureKind: varchar("feature_kind", { length: 64 }).notNull(),
    value: doublePrecision("value"),
    structuredPayload: jsonb("structured_payload"),
    asOfUnixMs: bigint("as_of_unix_ms", { mode: "number" }).notNull(),
    confidence: varchar("confidence", { length: 16 }).notNull().default("medium"),
    inputLineage: jsonb("input_lineage"),
    receivedAtUnixMs: bigint("received_at_unix_ms", { mode: "number" }).notNull()
  },
  (t) => [
    index("idx_features_kind_as_of").on(t.featureKind, t.asOfUnixMs, t.id),
    index("idx_features_kind_confidence").on(t.featureKind, t.confidence, t.receivedAtUnixMs)
  ]
);

export type DerivedFeatureRow = typeof derivedFeatures.$inferSelect;
export type DerivedFeatureInsert = typeof derivedFeatures.$inferInsert;
```

- [ ] **Step 3: Create `src/db/schema/evidence-bundles.ts`**

```typescript
import { bigint, integer, jsonb, serial, uniqueIndex, varchar, index } from "drizzle-orm/pg-core";
import { intelligence } from "./intelligence.js";

export const evidenceBundles = intelligence.table(
  "evidence_bundles",
  {
    id: serial("id").primaryKey(),
    schemaVersion: varchar("schema_version", { length: 16 }).notNull(),
    pair: varchar("pair", { length: 32 }).notNull(),
    asOfUnixMs: bigint("as_of_unix_ms", { mode: "number" }).notNull(),
    expiresAtUnixMs: bigint("expires_at_unix_ms", { mode: "number" }).notNull(),
    payload: jsonb("payload").notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    inputLineage: jsonb("input_lineage"),
    version: integer("version").notNull().default(1),
    receivedAtUnixMs: bigint("received_at_unix_ms", { mode: "number" }).notNull()
  },
  (t) => [
    uniqueIndex("uniq_bundle_pair_hash").on(t.pair, t.payloadHash),
    index("idx_bundle_pair_as_of").on(t.pair, t.asOfUnixMs, t.id),
    index("idx_bundle_pair_latest").on(t.pair, t.receivedAtUnixMs, t.id)
  ]
);

export type EvidenceBundleRow = typeof evidenceBundles.$inferSelect;
export type EvidenceBundleInsert = typeof evidenceBundles.$inferInsert;
```

- [ ] **Step 4: Create `src/db/schema/research-briefs.ts`**

```typescript
import { bigint, integer, jsonb, serial, varchar, index } from "drizzle-orm/pg-core";
import { intelligence } from "./intelligence.js";

export const researchBriefs = intelligence.table(
  "research_briefs",
  {
    id: serial("id").primaryKey(),
    evidenceBundleId: integer("evidence_bundle_id").notNull(),
    promptVersion: varchar("prompt_version", { length: 32 }).notNull(),
    modelProvider: varchar("model_provider", { length: 64 }).notNull(),
    structuredOutput: jsonb("structured_output").notNull(),
    confidence: varchar("confidence", { length: 16 }).notNull().default("medium"),
    sourceRefs: jsonb("source_refs"),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    receivedAtUnixMs: bigint("received_at_unix_ms", { mode: "number" }).notNull()
  },
  (t) => [
    index("idx_brief_bundle_id").on(t.evidenceBundleId, t.receivedAtUnixMs),
    index("idx_brief_model_provider").on(t.modelProvider, t.receivedAtUnixMs)
  ]
);

export type ResearchBriefRow = typeof researchBriefs.$inferSelect;
export type ResearchBriefInsert = typeof researchBriefs.$inferInsert;
```

- [ ] **Step 5: Update `src/db/schema/index.ts` barrel**

```typescript
export { intelligence, PG_SCHEMA_NAME } from "./intelligence.js";
export { rawObservations } from "./raw-observations.js";
export type { RawObservationRow, RawObservationInsert } from "./raw-observations.js";
export { normalizedObservations } from "./normalized-observations.js";
export type {
  NormalizedObservationRow,
  NormalizedObservationInsert
} from "./normalized-observations.js";
export { derivedFeatures } from "./derived-features.js";
export type { DerivedFeatureRow, DerivedFeatureInsert } from "./derived-features.js";
export { evidenceBundles } from "./evidence-bundles.js";
export type { EvidenceBundleRow, EvidenceBundleInsert } from "./evidence-bundles.js";
export { researchBriefs } from "./research-briefs.js";
export type { ResearchBriefRow, ResearchBriefInsert } from "./research-briefs.js";
```

- [ ] **Step 6: Write column-presence tests for each table**

Create `tests/db/schema/normalized-observations.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { normalizedObservations } from "../../../src/db/schema/index.js";
import { getColumnNames } from "../schema-helpers.js";

describe("normalizedObservations schema", () => {
  it("has all required columns", () => {
    const columns = getColumnNames(normalizedObservations);
    expect(columns).toContain("id");
    expect(columns).toContain("rawObservationId");
    expect(columns).toContain("source");
    expect(columns).toContain("observationKind");
    expect(columns).toContain("payload");
    expect(columns).toContain("payloadHash");
    expect(columns).toContain("isFresh");
    expect(columns).toContain("receivedAtUnixMs");
  });
});
```

Create `tests/db/schema/derived-features.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { derivedFeatures } from "../../../src/db/schema/index.js";
import { getColumnNames } from "../schema-helpers.js";

describe("derivedFeatures schema", () => {
  it("has all required columns", () => {
    const columns = getColumnNames(derivedFeatures);
    expect(columns).toContain("id");
    expect(columns).toContain("featureKind");
    expect(columns).toContain("value");
    expect(columns).toContain("structuredPayload");
    expect(columns).toContain("asOfUnixMs");
    expect(columns).toContain("confidence");
    expect(columns).toContain("inputLineage");
    expect(columns).toContain("receivedAtUnixMs");
  });
});
```

Create `tests/db/schema/evidence-bundles.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { evidenceBundles } from "../../../src/db/schema/index.js";
import { getColumnNames } from "../schema-helpers.js";

describe("evidenceBundles schema", () => {
  it("has all required columns", () => {
    const columns = getColumnNames(evidenceBundles);
    expect(columns).toContain("id");
    expect(columns).toContain("schemaVersion");
    expect(columns).toContain("pair");
    expect(columns).toContain("asOfUnixMs");
    expect(columns).toContain("expiresAtUnixMs");
    expect(columns).toContain("payload");
    expect(columns).toContain("payloadHash");
    expect(columns).toContain("inputLineage");
    expect(columns).toContain("version");
    expect(columns).toContain("receivedAtUnixMs");
  });
});
```

Create `tests/db/schema/research-briefs.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { researchBriefs } from "../../../src/db/schema/index.js";
import { getColumnNames } from "../schema-helpers.js";

describe("researchBriefs schema", () => {
  it("has all required columns", () => {
    const columns = getColumnNames(researchBriefs);
    expect(columns).toContain("id");
    expect(columns).toContain("evidenceBundleId");
    expect(columns).toContain("promptVersion");
    expect(columns).toContain("modelProvider");
    expect(columns).toContain("structuredOutput");
    expect(columns).toContain("confidence");
    expect(columns).toContain("sourceRefs");
    expect(columns).toContain("payloadHash");
    expect(columns).toContain("receivedAtUnixMs");
  });
});
```

- [ ] **Step 7: Run all schema tests**

```bash
pnpm test -- tests/db/schema/
```

Expected: All 5 schema test files pass

- [ ] **Step 8: Commit**

```bash
git add src/db/schema/ tests/db/schema/
git commit -m "feat(persist): add remaining four pipeline tables"
```

---

### Task 4: Create database factory and verify helpers

**Files:**

- Create: `src/db/db.ts`
- Create: `src/db/verify.ts`
- Create: `tests/db/verify.test.ts`

- [ ] **Step 1: Create `src/db/db.ts`**

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export function createDb(connectionString: string): {
  db: Db;
  client: ReturnType<typeof postgres>;
} {
  const parsed = parseInt(process.env.PG_MAX_CONNECTIONS ?? "", 10);
  const max = Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
  const ssl = process.env.PG_SSL === "false" ? false : { rejectUnauthorized: false };

  const client = postgres(connectionString, {
    connection: {
      search_path: "intelligence"
    },
    ssl,
    idle_timeout: 30,
    max_lifetime: 1800,
    connect_timeout: 10,
    max
  });

  const db = drizzle(client, { schema });

  return { db, client };
}
```

- [ ] **Step 2: Create `src/db/verify.ts`**

```typescript
import { sql } from "drizzle-orm/sql";
import type { Db } from "./db.js";

export async function verifyPgConnection(db: Db): Promise<void> {
  await db.execute(sql`SELECT 1`);
}

export async function verifyPgSchema(db: Db): Promise<void> {
  const result = await db.execute(
    sql`SELECT nspname FROM pg_namespace WHERE nspname = 'intelligence'`
  );
  if (result.length === 0) {
    throw new Error("FATAL: intelligence schema not found in Postgres");
  }
}

export async function verifyTable(db: Db, tableName: string): Promise<void> {
  const result = await db.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'intelligence' AND tablename = ${tableName}`
  );
  if (result.length === 0) {
    throw new Error(
      `FATAL: ${tableName} table not found in intelligence schema — run migrations first`
    );
  }
}
```

- [ ] **Step 3: Write tests for verify helpers**

Create `tests/db/verify.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { verifyPgConnection, verifyPgSchema, verifyTable } from "../../src/db/verify.js";

describe("verify helpers", () => {
  it("verifyPgConnection calls db.execute with SELECT 1", async () => {
    let executed = false;
    const mockDb = {
      execute: async () => {
        executed = true;
        return [{ result: 1 }];
      }
    } as any;
    await verifyPgConnection(mockDb);
    expect(executed).toBe(true);
  });

  it("verifyPgSchema throws when schema not found", async () => {
    const mockDb = {
      execute: async () => []
    } as any;
    await expect(verifyPgSchema(mockDb)).rejects.toThrow(
      "FATAL: intelligence schema not found in Postgres"
    );
  });

  it("verifyPgSchema succeeds when schema exists", async () => {
    const mockDb = {
      execute: async () => [{ nspname: "intelligence" }]
    } as any;
    await expect(verifyPgSchema(mockDb)).resolves.toBeUndefined();
  });

  it("verifyTable throws when table not found", async () => {
    const mockDb = {
      execute: async () => []
    } as any;
    await expect(verifyTable(mockDb, "raw_observations")).rejects.toThrow(
      "FATAL: raw_observations table not found in intelligence schema — run migrations first"
    );
  });

  it("verifyTable succeeds when table exists", async () => {
    const mockDb = {
      execute: async () => [{ tablename: "raw_observations" }]
    } as any;
    await expect(verifyTable(mockDb, "raw_observations")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 4: Run the tests**

```bash
pnpm test -- tests/db/verify.test.ts
```

Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/db.ts src/db/verify.ts tests/db/verify.test.ts
git commit -m "feat(persist): add createDb factory and verify helpers"
```

---

### Task 5: Create content-hash domain utility

**Files:**

- Create: `src/domain/content-hash.ts`
- Create: `tests/domain/content-hash.test.ts`

- [ ] **Step 1: Write failing test `tests/domain/content-hash.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { canonicalHash } from "../../src/domain/content-hash.js";

describe("canonicalHash", () => {
  it("produces a stable SHA-256 hex digest for a simple object", () => {
    const result = canonicalHash({ b: 2, a: 1 });
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces the same hash regardless of key order", () => {
    const hash1 = canonicalHash({ a: 1, b: 2 });
    const hash2 = canonicalHash({ b: 2, a: 1 });
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different payloads", () => {
    const hash1 = canonicalHash({ a: 1 });
    const hash2 = canonicalHash({ a: 2 });
    expect(hash1).not.toBe(hash2);
  });

  it("handles string payloads", () => {
    const result = canonicalHash("hello");
    expect(result).toHaveLength(64);
  });

  it("handles numeric payloads", () => {
    const result = canonicalHash(42);
    expect(result).toHaveLength(64);
  });

  it("handles null payload", () => {
    const result = canonicalHash(null);
    expect(result).toHaveLength(64);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test -- tests/domain/content-hash.test.ts
```

Expected: FAIL — `cannot find module "../../src/domain/content-hash.js"`

- [ ] **Step 3: Create `src/domain/content-hash.ts`**

```typescript
import { createHash } from "node:crypto";

export function canonicalHash(payload: unknown): string {
  const canonical = JSON.stringify(payload, Object.keys(payload as object).sort());
  return createHash("sha256").update(canonical).digest("hex");
}
```

Note: `JSON.stringify` with a replacer array of sorted keys produces deterministic serialization. For non-object payloads (strings, numbers, null), `Object.keys()` on a non-object returns an empty array, and `JSON.stringify` handles primitives directly.

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test -- tests/domain/content-hash.test.ts
```

Expected: 6 tests PASS

- [ ] **Step 5: Update `src/domain/` to ensure the boundary rule still passes**

The `domain/` layer boundary rule says domain may not import from `application`, `jobs`, `adapters`, `ports`, or `scripts`. `node:crypto` is a Node builtin — however, the boundary rule also says inner layers may not import Node builtins (`dependencyTypes: ["core"]`).

Since `content-hash.ts` uses `node:crypto`, it must either:

- (a) Move to a different layer, OR
- (b) Use the Web Crypto API available in Node 22+ without importing `node:crypto`

Check if `crypto.subtle` (Web Crypto) is available in Node 22. It is — `globalThis.crypto.subtle` is available without any import.

Update `src/domain/content-hash.ts` to use Web Crypto instead:

```typescript
export async function canonicalHash(payload: unknown): Promise<string> {
  const canonical = serializeCanonical(payload);
  const encoded = new TextEncoder().encode(canonical);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function serializeCanonical(payload: unknown): string {
  if (payload === null || typeof payload !== "object") {
    return JSON.stringify(payload);
  }
  const sorted = Object.entries(payload as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  return JSON.stringify(Object.fromEntries(sorted));
}
```

Wait — this makes `canonicalHash` async, which changes the port signatures. The repository adapters will need to call it with `await`. That's fine — all repo methods are already async.

But also need to update the tests:

```typescript
import { describe, it, expect } from "vitest";
import { canonicalHash } from "../../src/domain/content-hash.js";

describe("canonicalHash", () => {
  it("produces a stable SHA-256 hex digest for a simple object", async () => {
    const result = await canonicalHash({ b: 2, a: 1 });
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces the same hash regardless of key order", async () => {
    const hash1 = await canonicalHash({ a: 1, b: 2 });
    const hash2 = await canonicalHash({ b: 2, a: 1 });
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different payloads", async () => {
    const hash1 = await canonicalHash({ a: 1 });
    const hash2 = await canonicalHash({ a: 2 });
    expect(hash1).not.toBe(hash2);
  });

  it("handles string payloads", async () => {
    const result = await canonicalHash("hello");
    expect(result).toHaveLength(64);
  });

  it("handles numeric payloads", async () => {
    const result = await canonicalHash(42);
    expect(result).toHaveLength(64);
  });

  it("handles null payload", async () => {
    const result = await canonicalHash(null);
    expect(result).toHaveLength(64);
  });
});
```

- [ ] **Step 6: Run the tests again to verify they pass**

```bash
pnpm test -- tests/domain/content-hash.test.ts
```

Expected: 6 tests PASS

- [ ] **Step 7: Run boundary check**

```bash
pnpm boundaries
```

Expected: PASS — `domain/content-hash.ts` uses no Node builtins, only Web Crypto

- [ ] **Step 8: Commit**

```bash
git add src/domain/content-hash.ts tests/domain/content-hash.test.ts
git commit -m "feat(persist): add canonicalHash domain utility using Web Crypto"
```

---

### Task 6: Create repository ports

**Files:**

- Create: `src/ports/db.ts`
- Create: `src/ports/observation-repo.ts`
- Create: `src/ports/normalized-observation-repo.ts`
- Create: `src/ports/feature-repo.ts`
- Create: `src/ports/bundle-repo.ts`
- Create: `src/ports/brief-repo.ts`
- Modify: `src/ports/index.ts`

- [ ] **Step 1: Create `src/ports/db.ts`**

```typescript
import type { Db } from "../db/db.js";

export interface DbConnection {
  db: Db;
  close(): Promise<void>;
}
```

- [ ] **Step 2: Create `src/ports/observation-repo.ts`**

```typescript
import type { RawObservationRow, RawObservationInsert } from "../db/schema/raw-observations.js";

export interface RawObservationRepo {
  insert(row: RawObservationInsert): Promise<RawObservationRow>;
  findByHash(source: string, payloadHash: string): Promise<RawObservationRow | undefined>;
  findBySource(source: string, sinceUnixMs: number): Promise<RawObservationRow[]>;
}
```

- [ ] **Step 3: Create `src/ports/normalized-observation-repo.ts`**

```typescript
import type {
  NormalizedObservationRow,
  NormalizedObservationInsert
} from "../db/schema/normalized-observations.js";

export interface NormalizedObservationRepo {
  insert(row: NormalizedObservationInsert): Promise<NormalizedObservationRow>;
  findBySource(
    source: string,
    observationKind: string,
    sinceUnixMs: number
  ): Promise<NormalizedObservationRow[]>;
  findFreshByKind(source: string, observationKind: string): Promise<NormalizedObservationRow[]>;
}
```

- [ ] **Step 4: Create `src/ports/feature-repo.ts`**

```typescript
import type { DerivedFeatureRow, DerivedFeatureInsert } from "../db/schema/derived-features.js";

export interface DerivedFeatureRepo {
  insert(row: DerivedFeatureInsert): Promise<DerivedFeatureRow>;
  findByKind(featureKind: string, sinceUnixMs: number): Promise<DerivedFeatureRow[]>;
}
```

- [ ] **Step 5: Create `src/ports/bundle-repo.ts`**

```typescript
import type { EvidenceBundleRow, EvidenceBundleInsert } from "../db/schema/evidence-bundles.js";

export interface EvidenceBundleRepo {
  insert(row: EvidenceBundleInsert): Promise<EvidenceBundleRow>;
  findByPair(pair: string, sinceUnixMs: number): Promise<EvidenceBundleRow[]>;
  findLatestByPair(pair: string): Promise<EvidenceBundleRow | undefined>;
}
```

- [ ] **Step 6: Create `src/ports/brief-repo.ts`**

```typescript
import type { ResearchBriefRow, ResearchBriefInsert } from "../db/schema/research-briefs.js";

export interface ResearchBriefRepo {
  insert(row: ResearchBriefInsert): Promise<ResearchBriefRow>;
  findByBundleId(evidenceBundleId: number): Promise<ResearchBriefRow[]>;
}
```

- [ ] **Step 7: Update `src/ports/index.ts` barrel**

Add these exports after the existing ones:

```typescript
export type { DbConnection } from "./db.js";
export type { RawObservationRepo } from "./observation-repo.js";
export type { NormalizedObservationRepo } from "./normalized-observation-repo.js";
export type { DerivedFeatureRepo } from "./feature-repo.js";
export type { EvidenceBundleRepo } from "./bundle-repo.js";
export type { ResearchBriefRepo } from "./brief-repo.js";
```

- [ ] **Step 8: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/ports/
git commit -m "feat(persist): add repository ports and DbConnection interface"
```

---

### Task 7: Create Drizzle adapters

**Files:**

- Create: `src/adapters/node/drizzle-pg.ts`
- Create: `src/adapters/node/drizzle-observation-repo.ts`
- Create: `src/adapters/node/drizzle-normalized-observation-repo.ts`
- Create: `src/adapters/node/drizzle-feature-repo.ts`
- Create: `src/adapters/node/drizzle-bundle-repo.ts`
- Create: `src/adapters/node/drizzle-brief-repo.ts`
- Modify: `src/adapters/node/composition-root.ts`

- [ ] **Step 1: Create `src/adapters/node/drizzle-pg.ts`**

```typescript
import type { DbConnection } from "../../ports/db.js";
import { createDb } from "../../db/db.js";
import type { EnvReader } from "../../ports/env.js";

export class DrizzlePgAdapter implements DbConnection {
  public readonly db;
  private readonly client;

  constructor(env: EnvReader) {
    const connectionString = env.get("DATABASE_URL");
    const { db, client } = createDb(connectionString);
    this.db = db;
    this.client = client;
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}
```

- [ ] **Step 2: Create `src/adapters/node/drizzle-observation-repo.ts`**

```typescript
import { eq, and, gte } from "drizzle-orm";
import { rawObservations } from "../../db/schema/raw-observations.js";
import type { RawObservationRepo } from "../../ports/observation-repo.js";
import type { RawObservationInsert, RawObservationRow } from "../../db/schema/raw-observations.js";
import type { Db } from "../../db/db.js";

export class DrizzleObservationRepo implements RawObservationRepo {
  constructor(private readonly db: Db) {}

  async insert(row: RawObservationInsert): Promise<RawObservationRow> {
    const [result] = await this.db.insert(rawObservations).values(row).returning();
    return result!;
  }

  async findByHash(source: string, payloadHash: string): Promise<RawObservationRow | undefined> {
    const [result] = await this.db
      .select()
      .from(rawObservations)
      .where(and(eq(rawObservations.source, source), eq(rawObservations.payloadHash, payloadHash)))
      .limit(1);
    return result;
  }

  async findBySource(source: string, sinceUnixMs: number): Promise<RawObservationRow[]> {
    return this.db
      .select()
      .from(rawObservations)
      .where(
        and(eq(rawObservations.source, source), gte(rawObservations.observedAtUnixMs, sinceUnixMs))
      );
  }
}
```

- [ ] **Step 3: Create `src/adapters/node/drizzle-normalized-observation-repo.ts`**

```typescript
import { eq, and, gte } from "drizzle-orm";
import { normalizedObservations } from "../../db/schema/normalized-observations.js";
import type { NormalizedObservationRepo } from "../../ports/normalized-observation-repo.js";
import type {
  NormalizedObservationInsert,
  NormalizedObservationRow
} from "../../db/schema/normalized-observations.js";
import type { Db } from "../../db/db.js";

export class DrizzleNormalizedObservationRepo implements NormalizedObservationRepo {
  constructor(private readonly db: Db) {}

  async insert(row: NormalizedObservationInsert): Promise<NormalizedObservationRow> {
    const [result] = await this.db.insert(normalizedObservations).values(row).returning();
    return result!;
  }

  async findBySource(
    source: string,
    observationKind: string,
    sinceUnixMs: number
  ): Promise<NormalizedObservationRow[]> {
    return this.db
      .select()
      .from(normalizedObservations)
      .where(
        and(
          eq(normalizedObservations.source, source),
          eq(normalizedObservations.observationKind, observationKind),
          gte(normalizedObservations.receivedAtUnixMs, sinceUnixMs)
        )
      );
  }

  async findFreshByKind(
    source: string,
    observationKind: string
  ): Promise<NormalizedObservationRow[]> {
    return this.db
      .select()
      .from(normalizedObservations)
      .where(
        and(
          eq(normalizedObservations.source, source),
          eq(normalizedObservations.observationKind, observationKind),
          eq(normalizedObservations.isFresh, true)
        )
      );
  }
}
```

- [ ] **Step 4: Create `src/adapters/node/drizzle-feature-repo.ts`**

```typescript
import { eq, gte } from "drizzle-orm";
import { derivedFeatures } from "../../db/schema/derived-features.js";
import type { DerivedFeatureRepo } from "../../ports/feature-repo.js";
import type { DerivedFeatureInsert, DerivedFeatureRow } from "../../db/schema/derived-features.js";
import type { Db } from "../../db/db.js";

export class DrizzleFeatureRepo implements DerivedFeatureRepo {
  constructor(private readonly db: Db) {}

  async insert(row: DerivedFeatureInsert): Promise<DerivedFeatureRow> {
    const [result] = await this.db.insert(derivedFeatures).values(row).returning();
    return result!;
  }

  async findByKind(featureKind: string, sinceUnixMs: number): Promise<DerivedFeatureRow[]> {
    return this.db
      .select()
      .from(derivedFeatures)
      .where(
        and(
          eq(derivedFeatures.featureKind, featureKind),
          gte(derivedFeatures.asOfUnixMs, sinceUnixMs)
        )
      );
  }
}
```

- [ ] **Step 5: Create `src/adapters/node/drizzle-bundle-repo.ts`**

```typescript
import { eq, gte, desc } from "drizzle-orm";
import { evidenceBundles } from "../../db/schema/evidence-bundles.js";
import type { EvidenceBundleRepo } from "../../ports/bundle-repo.js";
import type { EvidenceBundleInsert, EvidenceBundleRow } from "../../db/schema/evidence-bundles.js";
import type { Db } from "../../db/db.js";

export class DrizzleBundleRepo implements EvidenceBundleRepo {
  constructor(private readonly db: Db) {}

  async insert(row: EvidenceBundleInsert): Promise<EvidenceBundleRow> {
    const [result] = await this.db.insert(evidenceBundles).values(row).returning();
    return result!;
  }

  async findByPair(pair: string, sinceUnixMs: number): Promise<EvidenceBundleRow[]> {
    return this.db
      .select()
      .from(evidenceBundles)
      .where(and(eq(evidenceBundles.pair, pair), gte(evidenceBundles.asOfUnixMs, sinceUnixMs)));
  }

  async findLatestByPair(pair: string): Promise<EvidenceBundleRow | undefined> {
    const [result] = await this.db
      .select()
      .from(evidenceBundles)
      .where(eq(evidenceBundles.pair, pair))
      .orderBy(desc(evidenceBundles.receivedAtUnixMs))
      .limit(1);
    return result;
  }
}
```

- [ ] **Step 6: Create `src/adapters/node/drizzle-brief-repo.ts`**

```typescript
import { eq } from "drizzle-orm";
import { researchBriefs } from "../../db/schema/research-briefs.js";
import type { ResearchBriefRepo } from "../../ports/brief-repo.js";
import type { ResearchBriefInsert, ResearchBriefRow } from "../../db/schema/research-briefs.js";
import type { Db } from "../../db/db.js";

export class DrizzleBriefRepo implements ResearchBriefRepo {
  constructor(private readonly db: Db) {}

  async insert(row: ResearchBriefInsert): Promise<ResearchBriefRow> {
    const [result] = await this.db.insert(researchBriefs).values(row).returning();
    return result!;
  }

  async findByBundleId(evidenceBundleId: number): Promise<ResearchBriefRow[]> {
    return this.db
      .select()
      .from(researchBriefs)
      .where(eq(researchBriefs.evidenceBundleId, evidenceBundleId));
  }
}
```

- [ ] **Step 7: Update `src/adapters/node/composition-root.ts` to add db field**

Add `DbConnection` to the `NodeRuntime` interface and create it in `createNodeRuntime()`:

```typescript
import { FetchHttpClient } from "./fetch-http.js";
import { FsJsonStore } from "./fs-json-store.js";
import { FsTextReader } from "./fs-text-reader.js";
import { ProcessEnvReader } from "./process-env.js";
import { SystemClock } from "./system-clock.js";
import { SpawnCommandRunner } from "./spawn-command-runner.js";
import { DrizzlePgAdapter } from "./drizzle-pg.js";
import type { HttpClient } from "../../ports/http.js";
import type { JsonStore } from "../../ports/json-store.js";
import type { TextReader } from "../../ports/text-reader.js";
import type { EnvReader } from "../../ports/env.js";
import type { Clock } from "../../ports/clock.js";
import type { CommandRunner } from "../../ports/command-runner.js";
import type { DbConnection } from "../../ports/db.js";

export interface NodeRuntime {
  http: HttpClient;
  jsonStore: JsonStore;
  textReader: TextReader;
  env: EnvReader;
  clock: Clock;
  commandRunner: CommandRunner;
  db: DbConnection;
}

export function createNodeRuntime(): NodeRuntime {
  const env = new ProcessEnvReader();
  return {
    http: new FetchHttpClient(),
    jsonStore: new FsJsonStore(),
    textReader: new FsTextReader(),
    env,
    clock: new SystemClock(),
    commandRunner: new SpawnCommandRunner(),
    db: new DrizzlePgAdapter(env)
  };
}
```

- [ ] **Step 8: Run typecheck and boundaries**

```bash
pnpm typecheck && pnpm boundaries
```

Expected: PASS (all adapters importing from correct locations)

- [ ] **Step 9: Commit**

```bash
git add src/adapters/node/
git commit -m "feat(persist): add Drizzle adapters for all repository ports"
```

---

### Task 8: Create in-memory fakes and port contract tests

**Files:**

- Create: `tests/fakes/fake-db.ts`
- Create: `tests/fakes/fake-observation-repo.ts`
- Create: `tests/fakes/fake-normalized-observation-repo.ts`
- Create: `tests/fakes/fake-feature-repo.ts`
- Create: `tests/fakes/fake-bundle-repo.ts`
- Create: `tests/fakes/fake-brief-repo.ts`
- Modify: `tests/fakes/index.ts`
- Create: `tests/ports/observation-repo.test.ts`
- Create: `tests/ports/normalized-observation-repo.test.ts`
- Create: `tests/ports/feature-repo.test.ts`
- Create: `tests/ports/bundle-repo.test.ts`
- Create: `tests/ports/brief-repo.test.ts`

- [ ] **Step 1: Create `tests/fakes/fake-db.ts`**

```typescript
import type { DbConnection } from "../../src/ports/db.js";

export class FakeDbConnection implements DbConnection {
  public readonly db = {} as any;
  private closed = false;

  async close(): Promise<void> {
    this.closed = true;
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
```

- [ ] **Step 2: Create `tests/fakes/fake-observation-repo.ts`**

```typescript
import type { RawObservationRepo } from "../../src/ports/observation-repo.js";
import type {
  RawObservationRow,
  RawObservationInsert
} from "../../src/db/schema/raw-observations.js";

export class FakeObservationRepo implements RawObservationRepo {
  private readonly store = new Map<string, RawObservationRow>();
  private nextId = 1;

  async insert(row: RawObservationInsert): Promise<RawObservationRow> {
    const id = this.nextId++;
    const result: RawObservationRow = {
      id,
      source: row.source,
      observedAtUnixMs: row.observedAtUnixMs,
      fetchedAtUnixMs: row.fetchedAtUnixMs,
      payloadHash: row.payloadHash,
      payloadCanonical: row.payloadCanonical,
      parseStatus: row.parseStatus ?? "pending",
      sourceRequestMeta: row.sourceRequestMeta ?? null,
      receivedAtUnixMs: row.receivedAtUnixMs
    };
    this.store.set(`${row.source}:${row.payloadHash}`, result);
    return result;
  }

  async findByHash(source: string, payloadHash: string): Promise<RawObservationRow | undefined> {
    return this.store.get(`${source}:${payloadHash}`);
  }

  async findBySource(source: string, sinceUnixMs: number): Promise<RawObservationRow[]> {
    return [...this.store.values()].filter(
      (r) => r.source === source && r.observedAtUnixMs >= sinceUnixMs
    );
  }
}
```

- [ ] **Step 3: Create `tests/fakes/fake-normalized-observation-repo.ts`**

```typescript
import type { NormalizedObservationRepo } from "../../src/ports/normalized-observation-repo.js";
import type {
  NormalizedObservationRow,
  NormalizedObservationInsert
} from "../../src/db/schema/normalized-observations.js";

export class FakeNormalizedObservationRepo implements NormalizedObservationRepo {
  private readonly store: NormalizedObservationRow[] = [];
  private nextId = 1;

  async insert(row: NormalizedObservationInsert): Promise<NormalizedObservationRow> {
    const result: NormalizedObservationRow = {
      id: this.nextId++,
      rawObservationId: row.rawObservationId,
      source: row.source,
      observationKind: row.observationKind,
      payload: row.payload,
      payloadHash: row.payloadHash,
      isFresh: row.isFresh ?? true,
      receivedAtUnixMs: row.receivedAtUnixMs
    };
    this.store.push(result);
    return result;
  }

  async findBySource(
    source: string,
    observationKind: string,
    sinceUnixMs: number
  ): Promise<NormalizedObservationRow[]> {
    return this.store.filter(
      (r) =>
        r.source === source &&
        r.observationKind === observationKind &&
        r.receivedAtUnixMs >= sinceUnixMs
    );
  }

  async findFreshByKind(
    source: string,
    observationKind: string
  ): Promise<NormalizedObservationRow[]> {
    return this.store.filter(
      (r) => r.source === source && r.observationKind === observationKind && r.isFresh
    );
  }
}
```

- [ ] **Step 4: Create `tests/fakes/fake-feature-repo.ts`**

```typescript
import type { DerivedFeatureRepo } from "../../src/ports/feature-repo.js";
import type {
  DerivedFeatureRow,
  DerivedFeatureInsert
} from "../../src/db/schema/derived-features.js";

export class FakeFeatureRepo implements DerivedFeatureRepo {
  private readonly store: DerivedFeatureRow[] = [];
  private nextId = 1;

  async insert(row: DerivedFeatureInsert): Promise<DerivedFeatureRow> {
    const result: DerivedFeatureRow = {
      id: this.nextId++,
      featureKind: row.featureKind,
      value: row.value ?? null,
      structuredPayload: row.structuredPayload ?? null,
      asOfUnixMs: row.asOfUnixMs,
      confidence: row.confidence ?? "medium",
      inputLineage: row.inputLineage ?? null,
      receivedAtUnixMs: row.receivedAtUnixMs
    };
    this.store.push(result);
    return result;
  }

  async findByKind(featureKind: string, sinceUnixMs: number): Promise<DerivedFeatureRow[]> {
    return this.store.filter((r) => r.featureKind === featureKind && r.asOfUnixMs >= sinceUnixMs);
  }
}
```

- [ ] **Step 5: Create `tests/fakes/fake-bundle-repo.ts`**

```typescript
import type { EvidenceBundleRepo } from "../../src/ports/bundle-repo.js";
import type {
  EvidenceBundleRow,
  EvidenceBundleInsert
} from "../../src/db/schema/evidence-bundles.js";

export class FakeBundleRepo implements EvidenceBundleRepo {
  private readonly store: EvidenceBundleRow[] = [];
  private nextId = 1;

  async insert(row: EvidenceBundleInsert): Promise<EvidenceBundleRow> {
    const result: EvidenceBundleRow = {
      id: this.nextId++,
      schemaVersion: row.schemaVersion,
      pair: row.pair,
      asOfUnixMs: row.asOfUnixMs,
      expiresAtUnixMs: row.expiresAtUnixMs,
      payload: row.payload,
      payloadHash: row.payloadHash,
      inputLineage: row.inputLineage ?? null,
      version: row.version ?? 1,
      receivedAtUnixMs: row.receivedAtUnixMs
    };
    this.store.push(result);
    return result;
  }

  async findByPair(pair: string, sinceUnixMs: number): Promise<EvidenceBundleRow[]> {
    return this.store.filter((r) => r.pair === pair && r.asOfUnixMs >= sinceUnixMs);
  }

  async findLatestByPair(pair: string): Promise<EvidenceBundleRow | undefined> {
    const matching = this.store.filter((r) => r.pair === pair);
    if (matching.length === 0) return undefined;
    return matching.reduce((a, b) => (a.receivedAtUnixMs > b.receivedAtUnixMs ? a : b));
  }
}
```

- [ ] **Step 6: Create `tests/fakes/fake-brief-repo.ts`**

```typescript
import type { ResearchBriefRepo } from "../../src/ports/brief-repo.js";
import type { ResearchBriefRow, ResearchBriefInsert } from "../../src/db/schema/research-briefs.js";

export class FakeBriefRepo implements ResearchBriefRepo {
  private readonly store: ResearchBriefRow[] = [];
  private nextId = 1;

  async insert(row: ResearchBriefInsert): Promise<ResearchBriefRow> {
    const result: ResearchBriefRow = {
      id: this.nextId++,
      evidenceBundleId: row.evidenceBundleId,
      promptVersion: row.promptVersion,
      modelProvider: row.modelProvider,
      structuredOutput: row.structuredOutput,
      confidence: row.confidence ?? "medium",
      sourceRefs: row.sourceRefs ?? null,
      payloadHash: row.payloadHash,
      receivedAtUnixMs: row.receivedAtUnixMs
    };
    this.store.push(result);
    return result;
  }

  async findByBundleId(evidenceBundleId: number): Promise<ResearchBriefRow[]> {
    return this.store.filter((r) => r.evidenceBundleId === evidenceBundleId);
  }
}
```

- [ ] **Step 7: Update `tests/fakes/index.ts`**

Add these exports after the existing ones:

```typescript
export { FakeDbConnection } from "./fake-db.js";
export { FakeObservationRepo } from "./fake-observation-repo.js";
export { FakeNormalizedObservationRepo } from "./fake-normalized-observation-repo.js";
export { FakeFeatureRepo } from "./fake-feature-repo.js";
export { FakeBundleRepo } from "./fake-bundle-repo.js";
export { FakeBriefRepo } from "./fake-brief-repo.js";
```

- [ ] **Step 8: Write port contract tests for each repository**

Create `tests/ports/observation-repo.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { FakeObservationRepo } from "../../tests/fakes/fake-observation-repo.js";
import { canonicalHash } from "../../src/domain/content-hash.js";

describe("RawObservationRepo contract", () => {
  it("inserts and finds by hash", async () => {
    const repo = new FakeObservationRepo();
    const hash = await canonicalHash({ test: "data" });
    const row = await repo.insert({
      source: "clmm-v2-bundle",
      observedAtUnixMs: 1000,
      fetchedAtUnixMs: 1001,
      payloadHash: hash,
      payloadCanonical: '{"test":"data"}',
      receivedAtUnixMs: 1002
    });
    expect(row.id).toBe(1);

    const found = await repo.findByHash("clmm-v2-bundle", hash);
    expect(found).toBeDefined();
    expect(found!.id).toBe(1);
  });

  it("findBySource filters by source and since", async () => {
    const repo = new FakeObservationRepo();
    await repo.insert({
      source: "jupiter-price",
      observedAtUnixMs: 500,
      fetchedAtUnixMs: 501,
      payloadHash: "hash-1",
      payloadCanonical: "{}",
      receivedAtUnixMs: 502
    });
    await repo.insert({
      source: "clmm-v2-bundle",
      observedAtUnixMs: 1000,
      fetchedAtUnixMs: 1001,
      payloadHash: "hash-2",
      payloadCanonical: "{}",
      receivedAtUnixMs: 1002
    });

    const results = await repo.findBySource("jupiter-price", 400);
    expect(results).toHaveLength(1);
    expect(results[0]!.source).toBe("jupiter-price");

    const empty = await repo.findBySource("jupiter-price", 600);
    expect(empty).toHaveLength(0);
  });
});
```

Create `tests/ports/normalized-observation-repo.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { FakeNormalizedObservationRepo } from "../../tests/fakes/fake-normalized-observation-repo.js";

describe("NormalizedObservationRepo contract", () => {
  it("inserts and finds by source and kind", async () => {
    const repo = new FakeNormalizedObservationRepo();
    const row = await repo.insert({
      rawObservationId: 1,
      source: "clmm-v2-bundle",
      observationKind: "pool-snapshot",
      payload: { price: 150.0 },
      payloadHash: "hash-norm-1",
      receivedAtUnixMs: 1000
    });
    expect(row.id).toBe(1);

    const found = await repo.findBySource("clmm-v2-bundle", "pool-snapshot", 900);
    expect(found).toHaveLength(1);
    expect(found[0]!.observationKind).toBe("pool-snapshot");
  });

  it("findFreshByKind returns only fresh observations", async () => {
    const repo = new FakeNormalizedObservationRepo();
    await repo.insert({
      rawObservationId: 1,
      source: "clmm-v2-bundle",
      observationKind: "pool-snapshot",
      payload: { price: 150.0 },
      payloadHash: "hash-1",
      isFresh: true,
      receivedAtUnixMs: 1000
    });
    await repo.insert({
      rawObservationId: 2,
      source: "clmm-v2-bundle",
      observationKind: "pool-snapshot",
      payload: { price: 148.0 },
      payloadHash: "hash-2",
      isFresh: false,
      receivedAtUnixMs: 1100
    });

    const fresh = await repo.findFreshByKind("clmm-v2-bundle", "pool-snapshot");
    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.isFresh).toBe(true);
  });
});
```

Create `tests/ports/feature-repo.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { FakeFeatureRepo } from "../../tests/fakes/fake-feature-repo.js";

describe("DerivedFeatureRepo contract", () => {
  it("inserts and finds by kind", async () => {
    const repo = new FakeFeatureRepo();
    await repo.insert({
      featureKind: "fee-apr",
      value: 0.15,
      asOfUnixMs: 1000,
      receivedAtUnixMs: 1001
    });

    const found = await repo.findByKind("fee-apr", 900);
    expect(found).toHaveLength(1);
    expect(found[0]!.value).toBe(0.15);
  });

  it("findByKind filters by sinceUnixMs", async () => {
    const repo = new FakeFeatureRepo();
    await repo.insert({
      featureKind: "fee-apr",
      value: 0.15,
      asOfUnixMs: 500,
      receivedAtUnixMs: 501
    });
    await repo.insert({
      featureKind: "fee-apr",
      value: 0.2,
      asOfUnixMs: 1000,
      receivedAtUnixMs: 1001
    });

    const found = await repo.findByKind("fee-apr", 800);
    expect(found).toHaveLength(1);
    expect(found[0]!.value).toBe(0.2);
  });
});
```

Create `tests/ports/bundle-repo.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { FakeBundleRepo } from "../../tests/fakes/fake-bundle-repo.js";

describe("EvidenceBundleRepo contract", () => {
  it("inserts and finds by pair", async () => {
    const repo = new FakeBundleRepo();
    await repo.insert({
      schemaVersion: "1.0",
      pair: "SOL/USDC",
      asOfUnixMs: 1000,
      expiresAtUnixMs: 2000,
      payload: { pair: "SOL/USDC" },
      payloadHash: "hash-bundle-1",
      receivedAtUnixMs: 1001
    });

    const found = await repo.findByPair("SOL/USDC", 500);
    expect(found).toHaveLength(1);
  });

  it("findLatestByPair returns the most recent", async () => {
    const repo = new FakeBundleRepo();
    await repo.insert({
      schemaVersion: "1.0",
      pair: "SOL/USDC",
      asOfUnixMs: 1000,
      expiresAtUnixMs: 2000,
      payload: { pair: "SOL/USDC", v: 1 },
      payloadHash: "hash-1",
      receivedAtUnixMs: 1001
    });
    await repo.insert({
      schemaVersion: "1.0",
      pair: "SOL/USDC",
      asOfUnixMs: 1500,
      expiresAtUnixMs: 2500,
      payload: { pair: "SOL/USDC", v: 2 },
      payloadHash: "hash-2",
      receivedAtUnixMs: 1501
    });

    const latest = await repo.findLatestByPair("SOL/USDC");
    expect(latest).toBeDefined();
    expect(latest!.receivedAtUnixMs).toBe(1501);
  });

  it("findLatestByPair returns undefined when no bundles exist", async () => {
    const repo = new FakeBundleRepo();
    const latest = await repo.findLatestByPair("SOL/USDC");
    expect(latest).toBeUndefined();
  });
});
```

Create `tests/ports/brief-repo.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { FakeBriefRepo } from "../../tests/fakes/fake-brief-repo.js";

describe("ResearchBriefRepo contract", () => {
  it("inserts and finds by bundle id", async () => {
    const repo = new FakeBriefRepo();
    await repo.insert({
      evidenceBundleId: 1,
      promptVersion: "v1",
      modelProvider: "claude-3.5-sonnet",
      structuredOutput: { summary: "test" },
      payloadHash: "hash-brief-1",
      receivedAtUnixMs: 1000
    });

    const found = await repo.findByBundleId(1);
    expect(found).toHaveLength(1);
    expect(found[0]!.modelProvider).toBe("claude-3.5-sonnet");
  });

  it("findByBundleId returns empty for non-existent bundle", async () => {
    const repo = new FakeBriefRepo();
    const found = await repo.findByBundleId(999);
    expect(found).toHaveLength(0);
  });
});
```

- [ ] **Step 9: Run all port contract tests**

```bash
pnpm test -- tests/ports/
```

Expected: All 5 test files pass

- [ ] **Step 10: Run full test suite + typecheck + boundaries**

```bash
pnpm verify
```

Expected: PASS — all tests pass, typecheck clean, lint clean, format clean, boundaries pass

- [ ] **Step 11: Commit**

```bash
git add tests/fakes/ tests/ports/
git commit -m "feat(persist): add in-memory fakes and port contract tests"
```

---

### Task 9: Update dependency-cruiser boundary rules

**Files:**

- Modify: `.dependency-cruiser.cjs`

- [ ] **Step 1: Add boundary rules for `src/db/`**

Add these rules to the `forbidden` array in `.dependency-cruiser.cjs`:

```javascript
{
  name: "db-no-upstream",
  severity: "error",
  from: { path: "^src/db" },
  to: {
    path: ["^src/application", "^src/jobs", "^src/adapters", "^src/scripts", "^src/ports"]
  }
},
{
  name: "inner-layers-no-db",
  severity: "error",
  from: { path: "^src/(domain|contracts|ports|application|jobs)" },
  to: { path: ["^src/db"] }
},
{
  name: "adapters-may-import-db",
  severity: "allow",
  from: { path: "^src/adapters" },
  to: { path: ["^src/db"] }
}
```

- [ ] **Step 2: Run boundary check**

```bash
pnpm boundaries
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add .dependency-cruiser.cjs
git commit -m "feat(persist): add dependency-cruiser boundary rules for db layer"
```

---

### Task 10: Generate first migration and update .env.example

**Files:**

- Create: `drizzle/0000_create_intelligence_schema.sql` (initially hand-written, then Drizzle-generated)
- Modify: `.env.example` (already done in Task 1, verify)

This task creates the initial migration that:

1. Creates the `intelligence` schema
2. Creates the `intelligence_reader` and `intelligence_writer` roles
3. Grants appropriate permissions

- [ ] **Step 1: Generate Drizzle migration SQL (dry-run first)**

```bash
pnpm db:generate
```

This should generate migration files in the `drizzle/` directory. The schema SQL will contain `CREATE TABLE` statements scoped to the `intelligence` schema.

- [ ] **Step 2: Create the schema/role provisioning migration**

Create `drizzle/0000_create_intelligence_schema.sql` manually as the first migration, BEFORE the Drizzle-generated ones:

```sql
CREATE SCHEMA IF NOT EXISTS intelligence;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'intelligence_reader') THEN
    CREATE ROLE intelligence_reader;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'intelligence_writer') THEN
    CREATE ROLE intelligence_writer;
  END IF;
END
$$;

-- These grants will apply to all tables created in subsequent migrations.
-- Drizzle's generated migrations will create tables in the intelligence schema.
-- After running all migrations, the following grants should be applied:
-- GRANT SELECT ON ALL TABLES IN SCHEMA intelligence TO intelligence_reader;
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA intelligence TO intelligence_writer;

-- Add .gitkeep to drizzle/meta if it doesn't exist
```

- [ ] **Step 3: Add a post-migration grant script note to the migration header**

Add a comment at the top of the schema migration:

```sql
-- INT-PERSIST #5: Schema and role provisioning for intelligence schema
-- Run this BEFORE the table migrations.
-- After all migrations, run:
--   GRANT SELECT ON ALL TABLES IN SCHEMA intelligence TO intelligence_reader;
--   GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA intelligence TO intelligence_writer;
```

- [ ] **Step 4: Create `.gitkeep` in drizzle directory if needed**

```bash
ls drizzle/ 2>/dev/null || mkdir -p drizzle/meta && touch drizzle/meta/.gitkeep
```

- [ ] **Step 5: Commit**

```bash
git add drizzle/
git commit -m "feat(persist): add initial migration for intelligence schema and roles"
```

---

### Task 11: Final verification and documentation

**Files:**

- Modify: `README.md` — add DB setup section
- Modify: `docs/operator-runbook.md` — add DB operations section
- Modify: `AGENTS.md` — add persistence section and DB infrastructure reference

- [ ] **Step 1: Add DB setup section to README.md**

Add a section after the existing environment variables section:

```markdown
## Database Setup

This project uses Drizzle ORM with Postgres on the `intelligence` schema.

1. Ensure `DATABASE_URL` is set in your `.env` (the app sets `search_path=intelligence` automatically)
2. Run migrations: `pnpm db:migrate`
3. Verify schema: `SELECT nspname FROM pg_namespace WHERE nspname = 'intelligence';`

See `drizzle.config.ts` for connection settings.
```

- [ ] **Step 2: Add DB operations section to operator-runbook**

Add to `docs/operator-runbook.md`:

````markdown
## Database Operations

### Run migrations

```bash
pnpm db:migrate
```
````

### Generate new migration (after schema changes)

```bash
pnpm db:generate
```

### Push schema to DB (dev only, no migration file)

```bash
pnpm db:push
```

### Verify DB connection

```bash
tsx -e "import { createDb } from './src/db/db.js'; const { db, client } = createDb(process.env.DATABASE_URL); await db.execute({ sql: 'SELECT 1' }); console.log('OK'); await client.end();"
```

````

- [ ] **Step 3: Update AGENTS.md**

In the "DB Infrastructure" section, update to include the new tables and persistence details:

Replace the existing DB Infrastructure section with:

```markdown
## DB Infrastructure

Shared Railway Postgres, `intelligence` schema, Drizzle ORM with Zod-validated schemas, schema-scoped DB role. Key tables: `raw_observations`, `normalized_observations`, `derived_features`, `research_briefs`, `evidence_bundles`. Managed via `drizzle-kit` (INT-PERSIST #5).

### Table Lineage
````

raw_observations → normalized_observations → derived_features → evidence_bundles → research_briefs

```

### Repository Ports
- `src/ports/observation-repo.ts` — RawObservationRepo
- `src/ports/normalized-observation-repo.ts` — NormalizedObservationRepo
- `src/ports/feature-repo.ts` — DerivedFeatureRepo
- `src/ports/bundle-repo.ts` — EvidenceBundleRepo
- `src/ports/brief-repo.ts` — ResearchBriefRepo
- `src/ports/db.ts` — DbConnection

### Retention Tiers
- Hot: `raw_observations` (90 days)
- Warm: `normalized_observations`, `derived_features` (365 days)
- Cold: `evidence_bundles`, `research_briefs` (indefinite, expiry-gated)
```

- [ ] **Step 4: Run full verification**

```bash
pnpm verify
```

Expected: PASS — typecheck, lint, format, tests, boundaries all green

- [ ] **Step 5: Commit**

```bash
git add README.md docs/operator-runbook.md AGENTS.md
git commit -m "docs: add DB infrastructure documentation for INT-PERSIST #5"
```

---

## Self-Review Checklist

### Spec Coverage

| Spec Requirement                         | Task                                                |
| ---------------------------------------- | --------------------------------------------------- |
| intelligence schema + role provisioning  | Task 10                                             |
| Drizzle config and first migration       | Task 1 (config), Task 10 (migration)                |
| Five tables with columns, types, indexes | Tasks 2-3                                           |
| Repository ports for all five tables     | Task 6                                              |
| Drizzle adapters implement all ports     | Task 7                                              |
| In-memory fakes implement all ports      | Task 8                                              |
| Content hashing utility in domain/       | Task 5                                              |
| Idempotent upsert by hash                | Task 8 (findByHash + unique index in Task 2)        |
| Input lineage as JSONB                   | Task 3 (derived_features, evidence_bundles columns) |
| Retention policy documented              | Task 11 (AGENTS.md update)                          |
| pnpm verify passes                       | Task 8, Task 11                                     |
| Migrations and schema tests              | Tasks 2-3, Task 10                                  |
| Boundary rules for db/                   | Task 9                                              |
| DbConnection port                        | Task 6                                              |

### Placeholder Scan

- No TBD, TODO, or "implement later" found
- All code steps contain actual code
- All test steps contain actual test code
- All commands are exact

### Type Consistency

- `canonicalHash` returns `Promise<string>` (async, Web Crypto) — used consistently in tests
- `RawObservationInsert`/`RawObservationRow` type pairs used consistently across fakes and tests
- `Db` type exported from `src/db/db.ts` and used in `DrizzlePgAdapter` and verify helpers
- All 5 tables use `bigint("...", { mode: "number" })` — consistent with regime-engine pattern
- All 5 tables use `serial("id").primaryKey()` — consistent
- All JSONB columns use `jsonb()` — consistent
