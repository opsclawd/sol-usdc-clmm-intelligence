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
import { rawObservations } from "./raw-observations.js";

export const normalizedObservations = intelligence.table(
  "normalized_observations",
  {
    id: serial("id").primaryKey(),
    rawObservationId: integer("raw_observation_id")
      .notNull()
      .references(() => rawObservations.id, { onDelete: "restrict" }),
    source: varchar("source", { length: 64 }).notNull(),
    observationKind: varchar("observation_kind", { length: 64 }).notNull(),
    signalClass: varchar("signal_class", { length: 16 }).notNull().default("deterministic"),
    evidenceFamily: varchar("evidence_family", { length: 32 }).notNull().default("clmm_state"),
    payload: jsonb("payload").notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    confidence: jsonb("confidence").notNull().default({}),
    confidenceComposite: numeric("confidence_composite", { precision: 5, scale: 4 }),
    confidenceLevel: varchar("confidence_level", { length: 8 }),
    validUntilUnixMs: bigint("valid_until_unix_ms", { mode: "number" }),
    isStale: boolean("is_stale").notNull().default(false),
    staleBehavior: varchar("stale_behavior", { length: 24 }),
    provenance: jsonb("provenance").notNull().default({}),
    receivedAtUnixMs: bigint("received_at_unix_ms", { mode: "number" }).notNull()
  },
  (t) => [
    uniqueIndex("uniq_norm_obs_source_kind_hash").on(t.source, t.observationKind, t.payloadHash),
    index("idx_norm_obs_source_kind_stale").on(
      t.source,
      t.observationKind,
      t.isStale,
      t.receivedAtUnixMs
    )
  ]
);

export type NormalizedObservationRow = typeof normalizedObservations.$inferSelect;
export type NormalizedObservationInsert = typeof normalizedObservations.$inferInsert;
