---
title: Drizzle Persistence Infrastructure for Pipeline Tables
date: "2026-05-10"
module: persistence
problem_type: workflow_issue
component: database
severity: high
category: workflow-issues/
applies_when:
  - Adding new pipeline tables to a schema-scoped Drizzle setup
  - Creating repository ports and adapters for DB persistence in a layered monolith
  - Setting up Drizzle ORM with Railway Postgres and pgSchema
  - Configuring boundary rules for a DB layer in dependency-cruiser
  - Using Web Crypto for content hashing in a domain layer that forbids Node builtins
tags:
  - drizzle
  - postgres
  - persistence
  - pipeline-tables
  - repository-pattern
  - boundary-rules
  - web-crypto
related_docs:
  - script-first-to-layered-monolith-refactor-2026-05-10
  - replace-legacy-multi-call-collector-with-bundle-consumer-2026-05-10
github_issues:
  - opsclawd/sol-usdc-clmm-intelligence#5
---

## Context

The sol-usdc-clmm-intelligence repo needed a persistence layer to store raw observations, normalized observations, derived features, evidence bundles, and research briefs — following a staged pipeline where each layer builds on the previous. The project uses a layered monolith architecture (INT-ARCH #3) with strict dependency rules enforced by `dependency-cruiser`. Adding a database layer creates a tension: domain and application layers must remain independent of infrastructure details, yet DB schema types are needed across multiple layers for type-safe repository interfaces. Content hashing is needed for deduplication, but Node's `crypto` module would violate the "inner layers no Node builtins" boundary rule.

## Guidance

### Use `pgSchema("intelligence")` for schema-scoped Drizzle tables

Follow the regime-engine pattern. Keep all tables under a dedicated Postgres schema rather than polluting `public`:

```ts
// src/db/schema/intelligence.ts
import { pgSchema } from "drizzle-orm/pg-core";
export const PG_SCHEMA_NAME = "intelligence";
export const intelligence = pgSchema(PG_SCHEMA_NAME);
```

All table definitions use `intelligence.table(...)` instead of the global `pgTable(...)`:

```ts
// src/db/schema/raw-observations.ts
import { intelligence } from "./intelligence.js";
export const rawObservations = intelligence.table("raw_observations", { ... });
```

### Use Web Crypto for content hashing in the domain layer

The dependency-cruiser rules forbid `core` (Node built-in) dependencies in inner layers. Use `globalThis.crypto.subtle` instead of `require("crypto")`:

```ts
// src/domain/content-hash.ts
export async function canonicalHash(payload: unknown): Promise<string> {
  const canonical = serializeCanonical(payload);
  const encoded = new TextEncoder().encode(canonical);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
```

Note: `canonicalHash` returns `Promise<string>` (async) because Web Crypto's `subtle.digest` is async. All callers must `await` the result.

### Define repository ports as interfaces, implement with Drizzle in adapters

Port interfaces import only DB schema types (`import type`), which are erased at compile time — no runtime boundary violation:

```ts
// src/ports/observation-repo.ts
import type { RawObservationRow, RawObservationInsert } from "../db/schema/raw-observations.js";
export interface RawObservationRepo {
  insert(row: RawObservationInsert): Promise<RawObservationRow>;
  findByHash(source: string, payloadHash: string): Promise<RawObservationRow | undefined>;
  findBySource(source: string, sinceUnixMs: number): Promise<RawObservationRow[]>;
}
```

Drizzle adapters live in `src/adapters/node/` and wrap the schema types with real DB queries. In-memory fakes in `tests/fakes/` use `Map` and auto-incrementing IDs for unit tests.

### Enforce DB isolation with two dependency-cruiser rules

1. `db-no-upstream` — `src/db` must not import from `application`, `jobs`, `adapters`, `scripts`, or `ports`
2. `inner-layers-no-db` — `domain`, `contracts`, `application`, `jobs` must not import from `src/db`

Only `adapters/node/` and `ports/` (for type-only imports) can touch `src/db`. The runtime Drizzle instance is constructed in `src/adapters/node/composition-root.ts`.

### Create a `createDb` factory with schema-scoped connection

```ts
// src/db/db.ts
export function createDb(connectionString: string) {
  const client = postgres(connectionString, {
    connection: { search_path: "intelligence" },
    ssl: process.env.PG_SSL === "false" ? false : { rejectUnauthorized: false },
    idle_timeout: 30,
    max_lifetime: 1800,
    connect_timeout: 10,
    max: parsedMaxConnections
  });
  return { db: drizzle(client, { schema }), client };
}
```

### Schema declaration and table pattern

Each table lives in its own file under `src/db/schema/`. Use `bigint("...", { mode: "number" })` for unix millisecond timestamps (matching regime-engine convention). Include unique indexes for idempotency (`source + payloadHash`) and time-window queries (`source + observedAtUnixMs + id`).

## Why This Matters

- **Layered architecture integrity**: Without boundary rules, DB imports leak into domain/application code, making the codebase untestable and tightly coupled to Postgres. `dependency-cruiser` catches violations at CI time.
- **Type imports as the escape hatch**: TypeScript `import type` from `src/db/schema/` in ports is safe because type imports are erased at compile time — no runtime dependency crosses the boundary.
- **Web Crypto over Node Crypto**: Using `globalThis.crypto.subtle` instead of `require("crypto")` keeps `src/domain/` free of Node builtins, enabling future browser/Web Worker compatibility and satisfying the `inner-layers-no-node-builtins` rule.
- **Schema-scoped tables**: Using `pgSchema("intelligence")` avoids naming collisions in shared Postgres and mirrors the regime-engine convention, making cross-repo DB management consistent.

## When to Apply

- Adding a new repository port + Drizzle adapter pair for a new pipeline table (e.g., `contextual_evidence`)
- Extending the DB schema with new columns or tables — always use `intelligence.table(...)` not `pgTable(...)`
- Adding domain logic that needs hashing — use `canonicalHash` from `src/domain/content-hash.ts`, not Node's `crypto`
- Adding any module that needs DB access — inject through the port interface, construct the Drizzle adapter in `composition-root.ts`
- Working in a layered monolith where inner layers must stay infrastructure-free

## Examples

**Before (would violate boundaries):**

```ts
// src/domain/content-hash.ts — using Node crypto (violates inner-layers-no-node-builtins)
import { createHash } from "crypto"; // ❌ Node builtin in domain layer
export function canonicalHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex"); // ❌ sync, Node-specific
}
```

**After (boundary-compliant):**

```ts
// src/domain/content-hash.ts — using Web Crypto (boundary-safe)
export async function canonicalHash(payload: unknown): Promise<string> {
  // ✅ async
  const canonical = serializeCanonical(payload);
  const encoded = new TextEncoder().encode(canonical);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", encoded); // ✅ Web Crypto
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
```

**Before (repo directly uses Drizzle in application layer):**

```ts
// src/application/collect-observations.ts — ❌ direct DB dependency
import { db } from "../db/db.js";
await db.insert(rawObservations).values({ ... });
```

**After (repo injected through port interface):**

```ts
// src/application/collect-observations.ts — ✅ depends on port, not adapter
import type { RawObservationRepo } from "../ports/observation-repo.js";
export async function collectObservation(repo: RawObservationRepo, ...) {
  await repo.insert({ ... }); // ✅ port interface, no DB import
}
```
