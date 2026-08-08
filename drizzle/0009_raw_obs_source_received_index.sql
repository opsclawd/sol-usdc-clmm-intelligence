CREATE INDEX IF NOT EXISTS "idx_raw_obs_source_received" ON "intelligence"."raw_observations" ("source", "received_at_unix_ms");
