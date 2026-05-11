import { bigint, integer, jsonb, serial, varchar, index, uniqueIndex } from "drizzle-orm/pg-core";
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
    confidence: varchar("confidence", { length: 16 }).notNull().default("medium"),
    sourceRefs: jsonb("source_refs"),
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
