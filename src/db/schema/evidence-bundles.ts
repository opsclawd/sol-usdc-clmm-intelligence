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
