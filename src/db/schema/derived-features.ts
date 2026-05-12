import {
  bigint,
  boolean,
  check,
  doublePrecision,
  jsonb,
  numeric,
  serial,
  varchar,
  index,
  uniqueIndex
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { intelligence } from "./intelligence.js";

export const derivedFeatures = intelligence.table(
  "derived_features",
  {
    id: serial("id").primaryKey(),
    featureKind: varchar("feature_kind", { length: 64 }).notNull(),
    signalClass: varchar("signal_class", { length: 16 }).notNull().default("deterministic"),
    evidenceFamily: varchar("evidence_family", { length: 32 }).notNull().default("clmm_state"),
    value: doublePrecision("value"),
    structuredPayload: jsonb("structured_payload"),
    asOfUnixMs: bigint("as_of_unix_ms", { mode: "number" }).notNull(),
    confidence: jsonb("confidence").notNull().default({}),
    confidenceComposite: numeric("confidence_composite", { precision: 5, scale: 4 }),
    confidenceLevel: varchar("confidence_level", { length: 8 }),
    validUntilUnixMs: bigint("valid_until_unix_ms", { mode: "number" }),
    isStale: boolean("is_stale").notNull().default(false),
    staleBehavior: varchar("stale_behavior", { length: 24 }),
    provenance: jsonb("provenance").notNull().default({}),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    receivedAtUnixMs: bigint("received_at_unix_ms", { mode: "number" }).notNull()
  },
  (t) => [
    uniqueIndex("uniq_features_kind_hash").on(t.featureKind, t.payloadHash),
    index("idx_features_kind_as_of").on(t.featureKind, t.asOfUnixMs, t.id),
    check(
      "chk_features_signal_class",
      sql`${t.signalClass} IN ('deterministic', 'probabilistic', 'contextual')`
    ),
    check(
      "chk_features_evidence_family",
      sql`${t.evidenceFamily} IN ('clmm_state', 'price_quality', 'clmm_economics', 'execution_safety', 'market_regime', 'support_resistance', 'on_chain_flow', 'perp_liquidation', 'macro_protocol_risk')`
    ),
    check(
      "chk_features_confidence_composite",
      sql`${t.confidenceComposite} IS NULL OR (${t.confidenceComposite} >= 0 AND ${t.confidenceComposite} <= 1)`
    ),
    check(
      "chk_features_confidence_level",
      sql`${t.confidenceLevel} IS NULL OR ${t.confidenceLevel} IN ('low', 'medium', 'high')`
    ),
    check(
      "chk_features_stale_behavior",
      sql`${t.staleBehavior} IS NULL OR ${t.staleBehavior} IN ('exclude', 'degrade_confidence', 'allow_context_only')`
    )
  ]
);

export type DerivedFeatureRow = typeof derivedFeatures.$inferSelect;
export type DerivedFeatureInsert = typeof derivedFeatures.$inferInsert;
