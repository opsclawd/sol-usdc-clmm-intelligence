import {
  bigint,
  boolean,
  integer,
  jsonb,
  numeric,
  serial,
  uniqueIndex,
  varchar,
  index
} from "drizzle-orm/pg-core";
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
    uniqueIndex("uniq_bundle_pair_hash").on(t.pair, t.payloadHash),
    index("idx_bundle_pair_as_of").on(t.pair, t.asOfUnixMs, t.id),
    index("idx_bundle_pair_latest").on(t.pair, t.receivedAtUnixMs, t.id)
  ]
);

export type EvidenceBundleRow = typeof evidenceBundles.$inferSelect;
export type EvidenceBundleInsert = typeof evidenceBundles.$inferInsert;
