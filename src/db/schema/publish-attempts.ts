import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  serial,
  text,
  uniqueIndex,
  varchar
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { intelligence } from "./intelligence.js";

export const publishAttempts = intelligence.table(
  "publish_attempts",
  {
    id: serial("id").primaryKey(),
    target: varchar("target", { length: 64 }).notNull(),
    targetEndpoint: text("target_endpoint").notNull(),
    // evidence_bundle_id and research_brief_id are intentionally logical references without
    // FOREIGN KEY constraints: append-only audit records may be replayed/restored before
    // their evidence rows, and no cascade behavior is valid for immutable history.
    evidenceBundleId: integer("evidence_bundle_id").notNull(),
    researchBriefId: integer("research_brief_id"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    httpStatus: integer("http_status"),
    responseBody: jsonb("response_body"),
    errorCode: varchar("error_code", { length: 128 }),
    errorMessage: text("error_message"),
    attemptNumber: integer("attempt_number").notNull(),
    firstAttemptedAtUnixMs: bigint("first_attempted_at_unix_ms", { mode: "number" }).notNull(),
    completedAtUnixMs: bigint("completed_at_unix_ms", { mode: "number" }),
    receivedAtUnixMs: bigint("received_at_unix_ms", { mode: "number" }).notNull()
  },
  (t) => [
    uniqueIndex("uniq_pub_attempt_idem").on(t.target, t.idempotencyKey, t.attemptNumber),
    index("idx_pub_attempt_target_idem").on(t.target, t.idempotencyKey),
    index("idx_pub_attempt_bundle").on(t.evidenceBundleId),
    index("idx_pub_attempt_brief").on(t.researchBriefId),
    index("idx_pub_attempt_status_recency").on(t.status, t.receivedAtUnixMs),
    check(
      "chk_pub_attempt_status",
      sql`${t.status} IN ('pending', 'sent', 'created', 'idempotent_replay', 'validation_failed', 'auth_failed', 'conflict', 'store_unavailable', 'network_failed', 'unknown_failed')`
    ),
    check(
      "chk_pub_attempt_http_status",
      sql`${t.httpStatus} IS NULL OR (${t.httpStatus} >= 100 AND ${t.httpStatus} <= 599)`
    ),
    check("chk_pub_attempt_number", sql`${t.attemptNumber} > 0`),
    check("chk_pub_attempt_first_timestamp", sql`${t.firstAttemptedAtUnixMs} >= 0`),
    check(
      "chk_pub_attempt_completed_timestamp",
      sql`${t.completedAtUnixMs} IS NULL OR ${t.completedAtUnixMs} >= 0`
    ),
    check("chk_pub_attempt_received_timestamp", sql`${t.receivedAtUnixMs} >= 0`),
    check(
      "chk_pub_attempt_completion_order",
      sql`${t.completedAtUnixMs} IS NULL OR ${t.completedAtUnixMs} >= ${t.firstAttemptedAtUnixMs}`
    )
  ]
);

export type PublishAttemptRow = typeof publishAttempts.$inferSelect;
export type PublishAttemptInsert = typeof publishAttempts.$inferInsert;
