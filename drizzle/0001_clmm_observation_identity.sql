ALTER TABLE "intelligence"."raw_observations" ADD COLUMN "source_observation_key" text;--> statement-breakpoint
UPDATE "intelligence"."raw_observations" SET "source_observation_key" = encode(sha256(('v1_legacy_key:'::text || "source"::text || ':'::text || "observed_at_unix_ms"::text || ':'::text || "payload_hash"::text)::bytea), 'hex') WHERE "source_observation_key" IS NULL;--> statement-breakpoint
ALTER TABLE "intelligence"."raw_observations" ALTER COLUMN "source_observation_key" SET NOT NULL;--> statement-breakpoint
DROP INDEX "intelligence"."uniq_norm_obs_source_kind_hash";--> statement-breakpoint
DROP INDEX "intelligence"."uniq_raw_obs_source_payload_hash";--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_norm_obs_raw_kind_hash" ON "intelligence"."normalized_observations" USING btree ("raw_observation_id","observation_kind","payload_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_raw_obs_source_observation_key" ON "intelligence"."raw_observations" USING btree ("source","source_observation_key");--> statement-breakpoint
CREATE INDEX "idx_raw_obs_source_payload_hash" ON "intelligence"."raw_observations" USING btree ("source","payload_hash");