CREATE SCHEMA IF NOT EXISTS "intelligence";
--> statement-breakpoint
CREATE TABLE "intelligence"."derived_features" (
	"id" serial PRIMARY KEY NOT NULL,
	"feature_kind" varchar(64) NOT NULL,
	"signal_class" varchar(16) DEFAULT 'deterministic' NOT NULL,
	"evidence_family" varchar(32) DEFAULT 'clmm_state' NOT NULL,
	"value" double precision,
	"structured_payload" jsonb,
	"as_of_unix_ms" bigint NOT NULL,
	"confidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence_composite" numeric(5, 4),
	"confidence_level" varchar(8),
	"valid_until_unix_ms" bigint,
	"is_stale" boolean DEFAULT false NOT NULL,
	"stale_behavior" varchar(24),
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"received_at_unix_ms" bigint NOT NULL,
	CONSTRAINT "chk_features_signal_class" CHECK ("intelligence"."derived_features"."signal_class" IN ('deterministic', 'probabilistic', 'contextual')),
	CONSTRAINT "chk_features_evidence_family" CHECK ("intelligence"."derived_features"."evidence_family" IN ('clmm_state', 'price_quality', 'clmm_economics', 'execution_safety', 'market_regime', 'support_resistance', 'on_chain_flow', 'perp_liquidation', 'macro_protocol_risk')),
	CONSTRAINT "chk_features_confidence_composite" CHECK ("intelligence"."derived_features"."confidence_composite" IS NULL OR ("intelligence"."derived_features"."confidence_composite" >= 0 AND "intelligence"."derived_features"."confidence_composite" <= 1)),
	CONSTRAINT "chk_features_confidence_level" CHECK ("intelligence"."derived_features"."confidence_level" IS NULL OR "intelligence"."derived_features"."confidence_level" IN ('low', 'medium', 'high')),
	CONSTRAINT "chk_features_stale_behavior" CHECK ("intelligence"."derived_features"."stale_behavior" IS NULL OR "intelligence"."derived_features"."stale_behavior" IN ('exclude', 'degrade_confidence', 'allow_context_only'))
);
--> statement-breakpoint
CREATE TABLE "intelligence"."evidence_bundles" (
	"id" serial PRIMARY KEY NOT NULL,
	"schema_version" varchar(16) NOT NULL,
	"pair" varchar(32) NOT NULL,
	"as_of_unix_ms" bigint NOT NULL,
	"expires_at_unix_ms" bigint NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"taxonomy_summary" jsonb,
	"dominant_signal_class" varchar(16) DEFAULT 'deterministic' NOT NULL,
	"confidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence_composite" numeric(5, 4),
	"confidence_level" varchar(8),
	"valid_until_unix_ms" bigint,
	"is_stale" boolean DEFAULT false NOT NULL,
	"stale_behavior" varchar(24),
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"received_at_unix_ms" bigint NOT NULL,
	CONSTRAINT "chk_bundle_dominant_signal_class" CHECK ("intelligence"."evidence_bundles"."dominant_signal_class" IN ('deterministic', 'probabilistic', 'contextual')),
	CONSTRAINT "chk_bundle_confidence_composite" CHECK ("intelligence"."evidence_bundles"."confidence_composite" IS NULL OR ("intelligence"."evidence_bundles"."confidence_composite" >= 0 AND "intelligence"."evidence_bundles"."confidence_composite" <= 1)),
	CONSTRAINT "chk_bundle_confidence_level" CHECK ("intelligence"."evidence_bundles"."confidence_level" IS NULL OR "intelligence"."evidence_bundles"."confidence_level" IN ('low', 'medium', 'high')),
	CONSTRAINT "chk_bundle_stale_behavior" CHECK ("intelligence"."evidence_bundles"."stale_behavior" IS NULL OR "intelligence"."evidence_bundles"."stale_behavior" IN ('exclude', 'degrade_confidence', 'allow_context_only'))
);
--> statement-breakpoint
CREATE TABLE "intelligence"."normalized_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"raw_observation_id" integer NOT NULL,
	"source" varchar(64) NOT NULL,
	"observation_kind" varchar(64) NOT NULL,
	"signal_class" varchar(16) DEFAULT 'deterministic' NOT NULL,
	"evidence_family" varchar(32) DEFAULT 'clmm_state' NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"confidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence_composite" numeric(5, 4),
	"confidence_level" varchar(8),
	"valid_until_unix_ms" bigint,
	"is_stale" boolean DEFAULT false NOT NULL,
	"stale_behavior" varchar(24),
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"received_at_unix_ms" bigint NOT NULL,
	CONSTRAINT "chk_norm_obs_signal_class" CHECK ("intelligence"."normalized_observations"."signal_class" IN ('deterministic', 'probabilistic', 'contextual')),
	CONSTRAINT "chk_norm_obs_evidence_family" CHECK ("intelligence"."normalized_observations"."evidence_family" IN ('clmm_state', 'price_quality', 'clmm_economics', 'execution_safety', 'market_regime', 'support_resistance', 'on_chain_flow', 'perp_liquidation', 'macro_protocol_risk')),
	CONSTRAINT "chk_norm_obs_confidence_composite" CHECK ("intelligence"."normalized_observations"."confidence_composite" IS NULL OR ("intelligence"."normalized_observations"."confidence_composite" >= 0 AND "intelligence"."normalized_observations"."confidence_composite" <= 1)),
	CONSTRAINT "chk_norm_obs_confidence_level" CHECK ("intelligence"."normalized_observations"."confidence_level" IS NULL OR "intelligence"."normalized_observations"."confidence_level" IN ('low', 'medium', 'high')),
	CONSTRAINT "chk_norm_obs_stale_behavior" CHECK ("intelligence"."normalized_observations"."stale_behavior" IS NULL OR "intelligence"."normalized_observations"."stale_behavior" IN ('exclude', 'degrade_confidence', 'allow_context_only'))
);
--> statement-breakpoint
CREATE TABLE "intelligence"."raw_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" varchar(64) NOT NULL,
	"observed_at_unix_ms" bigint NOT NULL,
	"fetched_at_unix_ms" bigint NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"payload_canonical" text NOT NULL,
	"parse_status" varchar(16) DEFAULT 'pending' NOT NULL,
	"source_request_meta" jsonb,
	"received_at_unix_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intelligence"."research_briefs" (
	"id" serial PRIMARY KEY NOT NULL,
	"evidence_bundle_id" integer NOT NULL,
	"prompt_version" varchar(32) NOT NULL,
	"model_provider" varchar(64) NOT NULL,
	"structured_output" jsonb NOT NULL,
	"signal_class" varchar(16) DEFAULT 'contextual' NOT NULL,
	"evidence_family" varchar(32),
	"taxonomy_summary" jsonb,
	"confidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence_composite" numeric(5, 4),
	"confidence_level" varchar(8),
	"valid_until_unix_ms" bigint,
	"is_stale" boolean DEFAULT false NOT NULL,
	"stale_behavior" varchar(24),
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"received_at_unix_ms" bigint NOT NULL,
	CONSTRAINT "chk_brief_signal_class" CHECK ("intelligence"."research_briefs"."signal_class" IN ('deterministic', 'probabilistic', 'contextual')),
	CONSTRAINT "chk_brief_evidence_family" CHECK ("intelligence"."research_briefs"."evidence_family" IS NULL OR "intelligence"."research_briefs"."evidence_family" IN ('clmm_state', 'price_quality', 'clmm_economics', 'execution_safety', 'market_regime', 'support_resistance', 'on_chain_flow', 'perp_liquidation', 'macro_protocol_risk')),
	CONSTRAINT "chk_brief_confidence_composite" CHECK ("intelligence"."research_briefs"."confidence_composite" IS NULL OR ("intelligence"."research_briefs"."confidence_composite" >= 0 AND "intelligence"."research_briefs"."confidence_composite" <= 1)),
	CONSTRAINT "chk_brief_confidence_level" CHECK ("intelligence"."research_briefs"."confidence_level" IS NULL OR "intelligence"."research_briefs"."confidence_level" IN ('low', 'medium', 'high')),
	CONSTRAINT "chk_brief_stale_behavior" CHECK ("intelligence"."research_briefs"."stale_behavior" IS NULL OR "intelligence"."research_briefs"."stale_behavior" IN ('exclude', 'degrade_confidence', 'allow_context_only')),
	CONSTRAINT "chk_brief_taxonomy_summary_required" CHECK ("intelligence"."research_briefs"."evidence_family" IS NOT NULL OR "intelligence"."research_briefs"."taxonomy_summary" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "intelligence"."normalized_observations" ADD CONSTRAINT "fk_normalized_observations_raw_observation" FOREIGN KEY ("raw_observation_id") REFERENCES "intelligence"."raw_observations"("id") ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "intelligence"."research_briefs" ADD CONSTRAINT "fk_research_briefs_evidence_bundle" FOREIGN KEY ("evidence_bundle_id") REFERENCES "intelligence"."evidence_bundles"("id") ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_features_kind_hash" ON "intelligence"."derived_features" USING btree ("feature_kind","payload_hash");--> statement-breakpoint
CREATE INDEX "idx_features_kind_as_of" ON "intelligence"."derived_features" USING btree ("feature_kind","as_of_unix_ms","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_bundle_pair_hash" ON "intelligence"."evidence_bundles" USING btree ("pair","payload_hash");--> statement-breakpoint
CREATE INDEX "idx_bundle_pair_as_of" ON "intelligence"."evidence_bundles" USING btree ("pair","as_of_unix_ms","id");--> statement-breakpoint
CREATE INDEX "idx_bundle_pair_latest" ON "intelligence"."evidence_bundles" USING btree ("pair","received_at_unix_ms","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_norm_obs_source_kind_hash" ON "intelligence"."normalized_observations" USING btree ("source","observation_kind","payload_hash");--> statement-breakpoint
CREATE INDEX "idx_norm_obs_source_kind_stale" ON "intelligence"."normalized_observations" USING btree ("source","observation_kind","is_stale","received_at_unix_ms");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_raw_obs_source_payload_hash" ON "intelligence"."raw_observations" USING btree ("source","payload_hash");--> statement-breakpoint
CREATE INDEX "idx_raw_obs_source_observed" ON "intelligence"."raw_observations" USING btree ("source","observed_at_unix_ms","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_brief_bundle_hash" ON "intelligence"."research_briefs" USING btree ("evidence_bundle_id","payload_hash");--> statement-breakpoint
CREATE INDEX "idx_brief_bundle_id" ON "intelligence"."research_briefs" USING btree ("evidence_bundle_id","received_at_unix_ms");--> statement-breakpoint
CREATE INDEX "idx_brief_model_provider" ON "intelligence"."research_briefs" USING btree ("model_provider","received_at_unix_ms");
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'intelligence_reader') AND
     EXISTS (SELECT FROM pg_roles WHERE rolname = 'intelligence_writer') THEN
    GRANT USAGE ON SCHEMA intelligence TO intelligence_reader, intelligence_writer;
  ELSIF EXISTS (SELECT FROM pg_roles WHERE rolname = 'intelligence_reader') THEN
    GRANT USAGE ON SCHEMA intelligence TO intelligence_reader;
  ELSIF EXISTS (SELECT FROM pg_roles WHERE rolname = 'intelligence_writer') THEN
    GRANT USAGE ON SCHEMA intelligence TO intelligence_writer;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'intelligence_reader') THEN
    GRANT SELECT ON ALL TABLES IN SCHEMA intelligence TO intelligence_reader;
    ALTER DEFAULT PRIVILEGES IN SCHEMA intelligence GRANT SELECT ON TABLES TO intelligence_reader;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'intelligence_writer') THEN
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA intelligence TO intelligence_writer;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA intelligence TO intelligence_writer;
    ALTER DEFAULT PRIVILEGES IN SCHEMA intelligence GRANT SELECT, INSERT, UPDATE ON TABLES TO intelligence_writer;
    ALTER DEFAULT PRIVILEGES IN SCHEMA intelligence GRANT USAGE ON SEQUENCES TO intelligence_writer;
  END IF;
END
$$;