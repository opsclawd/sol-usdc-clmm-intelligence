import {
  bigint,
  boolean,
  check,
  integer,
  jsonb,
  numeric,
  serial,
  text,
  uniqueIndex,
  varchar,
  index
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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
    payloadCanonical: text("payload_canonical").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    taxonomySummary: jsonb("taxonomy_summary"),
    dominantSignalClass: varchar("dominant_signal_class", { length: 16 })
      .notNull()
      .default("deterministic"),
    confidence: jsonb("confidence").notNull().default({}),
    confidenceComposite: numeric("confidence_composite", { precision: 5, scale: 4 }),
    confidenceLevel: varchar("confidence_level", { length: 8 }),
    validUntilUnixMs: bigint("valid_until_unix_ms", { mode: "number" }),
    isStale: boolean("is_stale").notNull().default(false),
    staleBehavior: varchar("stale_behavior", { length: 24 }),
    provenance: jsonb("provenance").notNull().default({}),
    version: integer("version").notNull().default(1),
    receivedAtUnixMs: bigint("received_at_unix_ms", { mode: "number" }).notNull()
  },
  (t) => [
    uniqueIndex("uniq_bundle_source_idem").on(t.schemaVersion, t.pair, t.idempotencyKey),
    index("idx_bundle_pair_as_of").on(t.pair, t.asOfUnixMs, t.id),
    index("idx_bundle_pair_latest").on(t.pair, t.receivedAtUnixMs, t.id),
    check(
      "chk_bundle_dominant_signal_class",
      sql`${t.dominantSignalClass} IN ('deterministic', 'probabilistic', 'contextual')`
    ),
    check(
      "chk_bundle_confidence_composite",
      sql`${t.confidenceComposite} IS NULL OR (${t.confidenceComposite} >= 0 AND ${t.confidenceComposite} <= 1)`
    ),
    check(
      "chk_bundle_confidence_level",
      sql`${t.confidenceLevel} IS NULL OR ${t.confidenceLevel} IN ('low', 'medium', 'high')`
    ),
    check(
      "chk_bundle_stale_behavior",
      sql`${t.staleBehavior} IS NULL OR ${t.staleBehavior} IN ('exclude', 'degrade_confidence', 'allow_context_only')`
    )
  ]
);

export type EvidenceBundleRow = typeof evidenceBundles.$inferSelect;
export type EvidenceBundleInsert = typeof evidenceBundles.$inferInsert;
