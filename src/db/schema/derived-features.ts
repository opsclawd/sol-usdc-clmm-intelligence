import {
  bigint,
  doublePrecision,
  jsonb,
  serial,
  varchar,
  index,
  uniqueIndex
} from "drizzle-orm/pg-core";
import { intelligence } from "./intelligence.js";

export const derivedFeatures = intelligence.table(
  "derived_features",
  {
    id: serial("id").primaryKey(),
    featureKind: varchar("feature_kind", { length: 64 }).notNull(),
    value: doublePrecision("value"),
    structuredPayload: jsonb("structured_payload"),
    asOfUnixMs: bigint("as_of_unix_ms", { mode: "number" }).notNull(),
    confidence: varchar("confidence", { length: 16 }).notNull().default("medium"),
    inputLineage: jsonb("input_lineage"),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    receivedAtUnixMs: bigint("received_at_unix_ms", { mode: "number" }).notNull()
  },
  (t) => [
    uniqueIndex("uniq_features_kind_hash").on(t.featureKind, t.payloadHash),
    index("idx_features_kind_as_of").on(t.featureKind, t.asOfUnixMs, t.id),
    index("idx_features_kind_confidence").on(t.featureKind, t.confidence, t.receivedAtUnixMs)
  ]
);

export type DerivedFeatureRow = typeof derivedFeatures.$inferSelect;
export type DerivedFeatureInsert = typeof derivedFeatures.$inferInsert;
