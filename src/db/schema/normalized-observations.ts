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
