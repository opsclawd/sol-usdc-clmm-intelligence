import {
  bigint,
  boolean,
  check,
  foreignKey,
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
import { evidenceBundles } from "./evidence-bundles.js";

export const researchBriefs = intelligence.table(
  "research_briefs",
  {
    id: serial("id").primaryKey(),
    evidenceBundleId: integer("evidence_bundle_id").notNull(),
    promptVersion: varchar("prompt_version", { length: 32 }).notNull(),
    modelProvider: varchar("model_provider", { length: 64 }).notNull(),
    structuredOutput: jsonb("structured_output").notNull(),
    signalClass: varchar("signal_class", { length: 16 }).notNull().default("contextual"),
    evidenceFamily: varchar("evidence_family", { length: 32 }),
    taxonomySummary: jsonb("taxonomy_summary"),
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
    uniqueIndex("uniq_brief_bundle_hash").on(t.evidenceBundleId, t.payloadHash),
    index("idx_brief_bundle_id").on(t.evidenceBundleId, t.receivedAtUnixMs),
    index("idx_brief_model_provider").on(t.modelProvider, t.receivedAtUnixMs),
    check(
      "chk_brief_signal_class",
      sql`${t.signalClass} IN ('deterministic', 'probabilistic', 'contextual')`
    ),
    check(
      "chk_brief_evidence_family",
      sql`${t.evidenceFamily} IS NULL OR ${t.evidenceFamily} IN ('clmm_state', 'price_quality', 'clmm_economics', 'execution_safety', 'market_regime', 'support_resistance', 'on_chain_flow', 'perp_liquidation', 'macro_protocol_risk')`
    ),
    check(
      "chk_brief_confidence_composite",
      sql`${t.confidenceComposite} IS NULL OR (${t.confidenceComposite} >= 0 AND ${t.confidenceComposite} <= 1)`
    ),
    check(
      "chk_brief_confidence_level",
      sql`${t.confidenceLevel} IS NULL OR ${t.confidenceLevel} IN ('low', 'medium', 'high')`
    ),
    check(
      "chk_brief_stale_behavior",
      sql`${t.staleBehavior} IS NULL OR ${t.staleBehavior} IN ('exclude', 'degrade_confidence', 'allow_context_only')`
    ),
    check(
      "chk_brief_taxonomy_summary_required",
      sql`${t.evidenceFamily} IS NOT NULL OR ${t.taxonomySummary} IS NOT NULL`
    ),
    foreignKey({
      name: "fk_research_briefs_evidence_bundle",
      columns: [t.evidenceBundleId],
      foreignColumns: [evidenceBundles.id]
    }).onDelete("restrict")
  ]
);

export type ResearchBriefRow = typeof researchBriefs.$inferSelect;
export type ResearchBriefInsert = typeof researchBriefs.$inferInsert;
