-- evidence_bundle_id and research_brief_id are intentionally logical references without
-- FOREIGN KEY constraints: append-only audit records may be replayed/restored before
-- their evidence rows, and no cascade behavior is valid for immutable history.
CREATE TABLE "intelligence"."publish_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"target" varchar(64) NOT NULL,
	"target_endpoint" text NOT NULL,
	"evidence_bundle_id" integer NOT NULL,
	"research_brief_id" integer,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"status" varchar(32) NOT NULL,
	"http_status" integer,
	"response_body" jsonb,
	"error_code" varchar(128),
	"error_message" text,
	"attempt_number" integer NOT NULL,
	"first_attempted_at_unix_ms" bigint NOT NULL,
	"completed_at_unix_ms" bigint,
	"received_at_unix_ms" bigint NOT NULL,
	CONSTRAINT "chk_pub_attempt_status" CHECK ("intelligence"."publish_attempts"."status" IN ('pending', 'sent', 'created', 'idempotent_replay', 'validation_failed', 'auth_failed', 'conflict', 'store_unavailable', 'network_failed', 'unknown_failed')),
	CONSTRAINT "chk_pub_attempt_http_status" CHECK ("intelligence"."publish_attempts"."http_status" IS NULL OR ("intelligence"."publish_attempts"."http_status" >= 100 AND "intelligence"."publish_attempts"."http_status" <= 599)),
	CONSTRAINT "chk_pub_attempt_number" CHECK ("intelligence"."publish_attempts"."attempt_number" > 0),
	CONSTRAINT "chk_pub_attempt_first_timestamp" CHECK ("intelligence"."publish_attempts"."first_attempted_at_unix_ms" >= 0),
	CONSTRAINT "chk_pub_attempt_completed_timestamp" CHECK ("intelligence"."publish_attempts"."completed_at_unix_ms" IS NULL OR "intelligence"."publish_attempts"."completed_at_unix_ms" >= 0),
	CONSTRAINT "chk_pub_attempt_received_timestamp" CHECK ("intelligence"."publish_attempts"."received_at_unix_ms" >= 0),
	CONSTRAINT "chk_pub_attempt_completion_order" CHECK ("intelligence"."publish_attempts"."completed_at_unix_ms" IS NULL OR "intelligence"."publish_attempts"."completed_at_unix_ms" >= "intelligence"."publish_attempts"."first_attempted_at_unix_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_pub_attempt_idem" ON "intelligence"."publish_attempts" USING btree ("target","idempotency_key","attempt_number");--> statement-breakpoint
CREATE INDEX "idx_pub_attempt_target_idem" ON "intelligence"."publish_attempts" USING btree ("target","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_pub_attempt_bundle" ON "intelligence"."publish_attempts" USING btree ("evidence_bundle_id");--> statement-breakpoint
CREATE INDEX "idx_pub_attempt_brief" ON "intelligence"."publish_attempts" USING btree ("research_brief_id");--> statement-breakpoint
CREATE INDEX "idx_pub_attempt_status_recency" ON "intelligence"."publish_attempts" USING btree ("status","received_at_unix_ms");