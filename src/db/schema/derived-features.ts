import {
  bigint,
  boolean,
  doublePrecision,
  jsonb,
  numeric,
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
    index("idx_features_kind_as_of").on(t.featureKind, t.asOfUnixMs, t.id)
  ]
);

export type DerivedFeatureRow = typeof derivedFeatures.$inferSelect;
export type DerivedFeatureInsert = typeof derivedFeatures.$inferInsert;
