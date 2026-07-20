DO $$
BEGIN
  IF NOT (0 + (SELECT COUNT(*)::bigint FROM "intelligence"."evidence_bundles")) = 0 THEN
    RAISE EXCEPTION 'Migration aborted: historical rows exist in evidence_bundles table. This migration cannot proceed with existing data.';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "intelligence"."evidence_bundles" ADD COLUMN "payload_canonical" text;--> statement-breakpoint
ALTER TABLE "intelligence"."evidence_bundles" ADD COLUMN "idempotency_key" varchar(128);--> statement-breakpoint
ALTER TABLE "intelligence"."evidence_bundles" ALTER COLUMN "payload_canonical" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence"."evidence_bundles" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
DROP INDEX "intelligence"."uniq_bundle_pair_hash";--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_bundle_source_idem" ON "intelligence"."evidence_bundles" USING btree ("schema_version", "pair", "idempotency_key");