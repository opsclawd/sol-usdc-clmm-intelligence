\set ON_ERROR_STOP on
\set tolerance_ms 5000

BEGIN TRANSACTION READ ONLY;

-- Result Set 1: Per-source totals for parsed, pending, skew_failed_rows, and non_skew_failed_rows
WITH bounded_observations AS (
  SELECT
    id,
    source,
    parse_status,
    observed_at_unix_ms - received_at_unix_ms AS observed_future_ms,
    observed_at_unix_ms - fetched_at_unix_ms AS fetch_before_observed_ms,
    fetched_at_unix_ms - received_at_unix_ms AS receive_before_fetch_ms
  FROM intelligence.raw_observations
  WHERE received_at_unix_ms >= floor(extract(epoch FROM now() - interval '90 days') * 1000)
),
flagged_observations AS (
  SELECT
    source,
    parse_status,
    (
      observed_future_ms > :tolerance_ms
      OR fetch_before_observed_ms > :tolerance_ms
      OR receive_before_fetch_ms > :tolerance_ms
    ) AS is_any_skew
  FROM bounded_observations
)
SELECT
  source,
  COUNT(*) FILTER (WHERE parse_status = 'parsed') AS parsed,
  COUNT(*) FILTER (WHERE parse_status = 'pending') AS pending,
  COUNT(*) FILTER (WHERE parse_status = 'failed' AND is_any_skew) AS skew_failed_rows,
  COUNT(*) FILTER (WHERE parse_status = 'failed' AND is_any_skew IS NOT TRUE) AS non_skew_failed_rows
FROM flagged_observations
GROUP BY source
ORDER BY source;

-- Result Set 2: Per-source/per-predicate skew statistics
WITH bounded_observations AS (
  SELECT
    source,
    observed_at_unix_ms - received_at_unix_ms AS observed_future_ms,
    observed_at_unix_ms - fetched_at_unix_ms AS fetch_before_observed_ms,
    fetched_at_unix_ms - received_at_unix_ms AS receive_before_fetch_ms
  FROM intelligence.raw_observations
  WHERE received_at_unix_ms >= floor(extract(epoch FROM now() - interval '90 days') * 1000)
)
SELECT
  source,
  'observed_future' AS predicate,
  COUNT(*) AS count,
  MIN(observed_future_ms) AS min_ms,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY observed_future_ms) AS median_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY observed_future_ms) AS p95_ms,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY observed_future_ms) AS p99_ms,
  MAX(observed_future_ms) AS max_ms
FROM bounded_observations
WHERE observed_future_ms > :tolerance_ms
GROUP BY source

UNION ALL

SELECT
  source,
  'fetch_before_observed' AS predicate,
  COUNT(*) AS count,
  MIN(fetch_before_observed_ms) AS min_ms,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY fetch_before_observed_ms) AS median_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY fetch_before_observed_ms) AS p95_ms,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY fetch_before_observed_ms) AS p99_ms,
  MAX(fetch_before_observed_ms) AS max_ms
FROM bounded_observations
WHERE fetch_before_observed_ms > :tolerance_ms
GROUP BY source

UNION ALL

SELECT
  source,
  'receive_before_fetch' AS predicate,
  COUNT(*) AS count,
  MIN(receive_before_fetch_ms) AS min_ms,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY receive_before_fetch_ms) AS median_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY receive_before_fetch_ms) AS p95_ms,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY receive_before_fetch_ms) AS p99_ms,
  MAX(receive_before_fetch_ms) AS max_ms
FROM bounded_observations
WHERE receive_before_fetch_ms > :tolerance_ms
GROUP BY source
ORDER BY source, predicate;

-- Result Set 3: 100 newest failed rows satisfying a skew predicate
WITH bounded_observations AS (
  SELECT
    id,
    source,
    parse_status,
    received_at_unix_ms,
    observed_at_unix_ms - received_at_unix_ms AS observed_future_ms,
    observed_at_unix_ms - fetched_at_unix_ms AS fetch_before_observed_ms,
    fetched_at_unix_ms - received_at_unix_ms AS receive_before_fetch_ms
  FROM intelligence.raw_observations
  WHERE received_at_unix_ms >= floor(extract(epoch FROM now() - interval '90 days') * 1000)
)
SELECT
  id,
  source,
  received_at_unix_ms,
  observed_future_ms,
  fetch_before_observed_ms,
  receive_before_fetch_ms,
  (observed_future_ms > :tolerance_ms) AS is_observed_future,
  (fetch_before_observed_ms > :tolerance_ms) AS is_fetch_before_observed,
  (receive_before_fetch_ms > :tolerance_ms) AS is_receive_before_fetch
FROM bounded_observations
WHERE parse_status = 'failed'
  AND (
    observed_future_ms > :tolerance_ms
    OR fetch_before_observed_ms > :tolerance_ms
    OR receive_before_fetch_ms > :tolerance_ms
  )
ORDER BY received_at_unix_ms DESC
LIMIT 100;

ROLLBACK;
