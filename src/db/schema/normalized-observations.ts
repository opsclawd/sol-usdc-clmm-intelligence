import {
  bigint,
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  numeric,
  serial,
  uniqueIndex,
  varchar,
  index
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { intelligence } from "./intelligence.js";
import { rawObservations } from "./raw-observations.js";

export const normalizedObservations = intelligence.table(
  "normalized_observations",
  {
    id: serial("id").primaryKey(),
    rawObservationId: integer("raw_observation_id").notNull(),
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
    ),
    check(
      "chk_norm_obs_signal_class",
      sql`${t.signalClass} IN ('deterministic', 'probabilistic', 'contextual')`
    ),
    check(
      "chk_norm_obs_evidence_family",
      sql`${t.evidenceFamily} IN ('clmm_state', 'price_quality', 'clmm_economics', 'execution_safety', 'market_regime', 'support_resistance', 'on_chain_flow', 'perp_liquidation', 'macro_protocol_risk')`
    ),
    check(
      "chk_norm_obs_confidence_composite",
      sql`${t.confidenceComposite} IS NULL OR (${t.confidenceComposite} >= 0 AND ${t.confidenceComposite} <= 1)`
    ),
    check(
      "chk_norm_obs_confidence_level",
      sql`${t.confidenceLevel} IS NULL OR ${t.confidenceLevel} IN ('low', 'medium', 'high')`
    ),
    check(
      "chk_norm_obs_stale_behavior",
      sql`${t.staleBehavior} IS NULL OR ${t.staleBehavior} IN ('exclude', 'degrade_confidence', 'allow_context_only')`
    ),
    foreignKey({
      name: "fk_normalized_observations_raw_observation",
      columns: [t.rawObservationId],
      foreignColumns: [rawObservations.id]
    }).onDelete("restrict")
  ]
);

export type NormalizedObservationRow = typeof normalizedObservations.$inferSelect;
export type NormalizedObservationInsert = typeof normalizedObservations.$inferInsert;
