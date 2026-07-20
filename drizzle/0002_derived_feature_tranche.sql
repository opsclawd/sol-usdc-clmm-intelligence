DO $$
BEGIN
  IF NOT (0 + (SELECT COUNT(*)::bigint FROM "intelligence"."derived_features")) = 0 THEN
    RAISE EXCEPTION 'Migration aborted: historical rows exist in derived_features table. This migration cannot proceed with existing data.';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD COLUMN "status" varchar(16);--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD COLUMN "unit" varchar(8);--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD COLUMN "pair" varchar(32) DEFAULT 'SOL/USDC';--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD COLUMN "calculator_version" varchar(32);--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD COLUMN "selection_version" varchar(32);--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD COLUMN "input_observation_ids" integer[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD COLUMN "rejected_observation_ids" integer[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD COLUMN "derivation_key" varchar(128);--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD COLUMN "pool_id" varchar(64);--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD COLUMN "position_id" varchar(64);--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ALTER COLUMN "unit" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ALTER COLUMN "pair" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ALTER COLUMN "calculator_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ALTER COLUMN "selection_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ALTER COLUMN "input_observation_ids" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ALTER COLUMN "rejected_observation_ids" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ALTER COLUMN "derivation_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ALTER COLUMN "structured_payload" SET NOT NULL;--> statement-breakpoint
DROP INDEX "intelligence"."uniq_features_kind_hash";--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_features_kind_derivation_key" ON "intelligence"."derived_features" USING btree ("feature_kind", "derivation_key");--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD CONSTRAINT "chk_features_status" CHECK ("status" IN ('AVAILABLE', 'PARTIAL', 'UNAVAILABLE'));--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD CONSTRAINT "chk_features_unit" CHECK ("unit" IN ('BPS', 'PPM'));--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD CONSTRAINT "chk_features_kind_allowlist" CHECK ("feature_kind" IN ('range_location', 'distance_to_lower', 'distance_to_upper', 'oracle_dex_divergence', 'oracle_confidence_width', 'realized_volatility_1h', 'volume_liquidity_ratio_24h'));--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD CONSTRAINT "chk_features_status_value" CHECK (("status" = 'UNAVAILABLE' AND "value" IS NULL) OR ("status" <> 'UNAVAILABLE' AND "value" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD CONSTRAINT "chk_features_unit_bps" CHECK (("feature_kind" = 'oracle_dex_divergence' AND "unit" = 'BPS') OR ("feature_kind" <> 'oracle_dex_divergence'));--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD CONSTRAINT "chk_features_unit_bps2" CHECK (("feature_kind" = 'oracle_confidence_width' AND "unit" = 'BPS') OR ("feature_kind" <> 'oracle_confidence_width'));--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD CONSTRAINT "chk_features_unit_bps3" CHECK (("feature_kind" = 'realized_volatility_1h' AND "unit" = 'BPS') OR ("feature_kind" <> 'realized_volatility_1h'));--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD CONSTRAINT "chk_features_unit_ppm" CHECK (("feature_kind" = 'range_location' AND "unit" = 'PPM') OR ("feature_kind" <> 'range_location'));--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD CONSTRAINT "chk_features_unit_ppm2" CHECK (("feature_kind" = 'distance_to_lower' AND "unit" = 'PPM') OR ("feature_kind" <> 'distance_to_lower'));--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD CONSTRAINT "chk_features_unit_ppm3" CHECK (("feature_kind" = 'distance_to_upper' AND "unit" = 'PPM') OR ("feature_kind" <> 'distance_to_upper'));--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD CONSTRAINT "chk_features_unit_ppm4" CHECK (("feature_kind" = 'volume_liquidity_ratio_24h' AND "unit" = 'PPM') OR ("feature_kind" <> 'volume_liquidity_ratio_24h'));--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD CONSTRAINT "chk_features_scope_position" CHECK ((("feature_kind" IN ('range_location', 'distance_to_lower', 'distance_to_upper') AND "pool_id" IS NOT NULL AND "position_id" IS NOT NULL) OR ("feature_kind" NOT IN ('range_location', 'distance_to_lower', 'distance_to_upper')));--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD CONSTRAINT "chk_features_scope_volume" CHECK ((("feature_kind" = 'volume_liquidity_ratio_24h' AND "pool_id" IS NOT NULL AND "position_id" IS NULL) OR ("feature_kind" <> 'volume_liquidity_ratio_24h'));--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD CONSTRAINT "chk_features_scope_other" CHECK ((("feature_kind" IN ('oracle_dex_divergence', 'oracle_confidence_width', 'realized_volatility_1h') AND "pool_id" IS NULL AND "position_id" IS NULL) OR ("feature_kind" NOT IN ('oracle_dex_divergence', 'oracle_confidence_width', 'realized_volatility_1h')));