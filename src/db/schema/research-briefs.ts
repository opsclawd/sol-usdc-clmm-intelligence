import {
  bigint,
  boolean,
  integer,
  jsonb,
  numeric,
  serial,
  varchar,
  index,
  uniqueIndex
} from "drizzle-orm/pg-core";
import { intelligence } from "./intelligence.js";
import { evidenceBundles } from "./evidence-bundles.js";

export const researchBriefs = intelligence.table(
  "research_briefs",
  {
    id: serial("id").primaryKey(),
    evidenceBundleId: integer("evidence_bundle_id")
      .notNull()
      .references(() => evidenceBundles.id, { onDelete: "restrict" }),
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
    index("idx_brief_model_provider").on(t.modelProvider, t.receivedAtUnixMs)
  ]
);

export type ResearchBriefRow = typeof researchBriefs.$inferSelect;
export type ResearchBriefInsert = typeof researchBriefs.$inferInsert;
