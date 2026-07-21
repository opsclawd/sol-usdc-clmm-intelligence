import { bigint, index, jsonb, serial, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { intelligence } from "./intelligence.js";

export const rawObservations = intelligence.table(
  "raw_observations",
  {
    id: serial("id").primaryKey(),
    source: varchar("source", { length: 64 }).notNull(),
    sourceObservationKey: text("source_observation_key").notNull(),
    observedAtUnixMs: bigint("observed_at_unix_ms", { mode: "number" }).notNull(),
    fetchedAtUnixMs: bigint("fetched_at_unix_ms", { mode: "number" }).notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    payloadCanonical: text("payload_canonical").notNull(),
    parseStatus: varchar("parse_status", { length: 16 }).notNull().default("pending"),
    sourceRequestMeta: jsonb("source_request_meta"),
    receivedAtUnixMs: bigint("received_at_unix_ms", { mode: "number" }).notNull()
  },
  (t) => [
    uniqueIndex("uniq_raw_obs_source_observation_key").on(t.source, t.sourceObservationKey),
    index("idx_raw_obs_source_payload_hash").on(t.source, t.payloadHash),
    index("idx_raw_obs_source_observed").on(t.source, t.observedAtUnixMs, t.id)
  ]
);

export type RawObservationRow = typeof rawObservations.$inferSelect;
export type RawObservationInsert = typeof rawObservations.$inferInsert;
