import {
  bigint,
  boolean,
  check,
  doublePrecision,
  integer,
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
    structuredPayload: jsonb("structured_payload").notNull(),
    asOfUnixMs: bigint("as_of_unix_ms", { mode: "number" }).notNull(),
    confidence: jsonb("confidence").notNull().default({}),
    confidenceComposite: numeric("confidence_composite", { precision: 5, scale: 4 }),
    confidenceLevel: varchar("confidence_level", { length: 8 }),
    validUntilUnixMs: bigint("valid_until_unix_ms", { mode: "number" }),
    isStale: boolean("is_stale").notNull().default(false),
    staleBehavior: varchar("stale_behavior", { length: 24 }),
    provenance: jsonb("provenance").notNull().default({}),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    receivedAtUnixMs: bigint("received_at_unix_ms", { mode: "number" }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    unit: varchar("unit", { length: 8 }).notNull(),
    pair: varchar("pair", { length: 32 }).notNull().default("SOL/USDC"),
    calculatorVersion: varchar("calculator_version", { length: 32 }).notNull(),
    selectionVersion: varchar("selection_version", { length: 32 }).notNull(),
    inputObservationIds: integer("input_observation_ids").array().notNull().default([]),
    rejectedObservationIds: integer("rejected_observation_ids").array().notNull().default([]),
    derivationKey: varchar("derivation_key", { length: 128 }).notNull(),
    poolId: varchar("pool_id", { length: 64 }),
    positionId: varchar("position_id", { length: 64 })
  },
  (t) => [
    uniqueIndex("uniq_features_kind_derivation_key").on(t.featureKind, t.derivationKey),
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
    ),
    check("chk_features_status", sql`${t.status} IN ('AVAILABLE', 'PARTIAL', 'UNAVAILABLE')`),
    check("chk_features_unit", sql`${t.unit} IN ('BPS', 'PPM')`),
    check(
      "chk_features_kind_allowlist",
      sql`${t.featureKind} IN ('range_location', 'distance_to_lower', 'distance_to_upper', 'oracle_dex_divergence', 'oracle_confidence_width', 'realized_volatility_1h', 'volume_liquidity_ratio_24h')`
    ),
    check(
      "chk_features_status_value",
      sql`((${t.status} = 'UNAVAILABLE' AND ${t.value} IS NULL) OR (${t.status} <> 'UNAVAILABLE' AND ${t.value} IS NOT NULL))`
    ),
    check(
      "chk_features_unit_bps",
      sql`((${t.featureKind} = 'oracle_dex_divergence' AND ${t.unit} = 'BPS') OR (${t.featureKind} <> 'oracle_dex_divergence'))`
    ),
    check(
      "chk_features_unit_bps2",
      sql`((${t.featureKind} = 'oracle_confidence_width' AND ${t.unit} = 'BPS') OR (${t.featureKind} <> 'oracle_confidence_width'))`
    ),
    check(
      "chk_features_unit_bps3",
      sql`((${t.featureKind} = 'realized_volatility_1h' AND ${t.unit} = 'BPS') OR (${t.featureKind} <> 'realized_volatility_1h'))`
    ),
    check(
      "chk_features_unit_ppm",
      sql`((${t.featureKind} = 'range_location' AND ${t.unit} = 'PPM') OR (${t.featureKind} <> 'range_location'))`
    ),
    check(
      "chk_features_unit_ppm2",
      sql`((${t.featureKind} = 'distance_to_lower' AND ${t.unit} = 'PPM') OR (${t.featureKind} <> 'distance_to_lower'))`
    ),
    check(
      "chk_features_unit_ppm3",
      sql`((${t.featureKind} = 'distance_to_upper' AND ${t.unit} = 'PPM') OR (${t.featureKind} <> 'distance_to_upper'))`
    ),
    check(
      "chk_features_unit_ppm4",
      sql`((${t.featureKind} = 'volume_liquidity_ratio_24h' AND ${t.unit} = 'PPM') OR (${t.featureKind} <> 'volume_liquidity_ratio_24h'))`
    ),
    check(
      "chk_features_scope_position",
      sql`(((${t.featureKind} IN ('range_location', 'distance_to_lower', 'distance_to_upper')) AND ${t.poolId} IS NOT NULL AND ${t.positionId} IS NOT NULL) OR (${t.featureKind} NOT IN ('range_location', 'distance_to_lower', 'distance_to_upper')))`
    ),
    check(
      "chk_features_scope_volume",
      sql`(((${t.featureKind} = 'volume_liquidity_ratio_24h') AND ${t.poolId} IS NOT NULL AND ${t.positionId} IS NULL) OR (${t.featureKind} <> 'volume_liquidity_ratio_24h'))`
    ),
    check(
      "chk_features_scope_other",
      sql`(((${t.featureKind} IN ('oracle_dex_divergence', 'oracle_confidence_width', 'realized_volatility_1h')) AND ${t.poolId} IS NULL AND ${t.positionId} IS NULL) OR (${t.featureKind} NOT IN ('oracle_dex_divergence', 'oracle_confidence_width', 'realized_volatility_1h')))`
    )
  ]
);

export type DerivedFeatureRow = typeof derivedFeatures.$inferSelect;
export type DerivedFeatureInsert = typeof derivedFeatures.$inferInsert;
