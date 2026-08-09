DO $$
DECLARE
  has_downstream boolean;
BEGIN
  SELECT EXISTS (
    WITH candidates AS (
      SELECT DISTINCT n.id
      FROM "intelligence"."normalized_observations" n
      JOIN "intelligence"."raw_observations" ro ON ro.id = n.raw_observation_id
      CROSS JOIN LATERAL jsonb_array_elements(n.provenance->'sourceRefs') ref
      WHERE ro.source = 'solana-status-api'
        AND ref->>'refType' = 'raw_observation'
        AND (ref->>'id')::bigint = ro.id
        AND ref->>'payloadHash' <> ro.payload_hash
    )
    SELECT 1
    FROM "intelligence"."derived_features" df
    JOIN candidates c ON c.id = ANY(df.input_observation_ids)
  ) INTO has_downstream;

  IF has_downstream THEN
    RAISE EXCEPTION 'unverifiable context-event rows have downstream derived feature references';
  END IF;
END $$;--> statement-breakpoint
DELETE FROM "intelligence"."normalized_observations"
WHERE id IN (
  SELECT DISTINCT n.id
  FROM "intelligence"."normalized_observations" n
  JOIN "intelligence"."raw_observations" ro ON ro.id = n.raw_observation_id
  CROSS JOIN LATERAL jsonb_array_elements(n.provenance->'sourceRefs') ref
  WHERE ro.source = 'solana-status-api'
    AND ref->>'refType' = 'raw_observation'
    AND (ref->>'id')::bigint = ro.id
    AND ref->>'payloadHash' <> ro.payload_hash
);
