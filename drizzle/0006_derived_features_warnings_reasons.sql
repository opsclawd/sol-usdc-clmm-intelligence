ALTER TABLE "intelligence"."derived_features" ADD COLUMN "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence"."derived_features" ADD COLUMN "reasons" jsonb DEFAULT '[]'::jsonb NOT NULL;
