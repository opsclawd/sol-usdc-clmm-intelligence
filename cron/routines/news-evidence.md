Collect SOL/USDC ecosystem and regulatory news evidence by running `pnpm collect:news-evidence`.

This routine collects bounded factual extracts from two allowed news sources: `crypto-news-api` for ecosystem news and `regulatory-monitor-api` for regulatory risk. It reports source outcomes (COMPLETE, PARTIAL, UNAVAILABLE, FAILED) and persists normalized observations to the database.

## Authority Boundaries

**This routine does NOT:**

- Make trading recommendations or express market direction
- Generate LLM research briefs (schema-constrained briefs are INT-BRIEFS #12)
- Synthesize policy (regime-engine owns final PolicyInsight)
- Execute transactions or manage positions
- Retain full article text, bodies, or copyrighted content

**Headline-based trading recommendations are explicitly forbidden.** News evidence is lower-confidence contextual data. Missing coverage does not mean no risk.

## Two-Source Allowlist

This routine only collects from two approved sources configured via environment variables:

- `NEWS_SOURCE_ALLOWLIST`: Comma-separated list of source names. Must be exactly `crypto-news-api,regulatory-monitor-api` (canonical order).
- `CRYPTO_NEWS_API_URL`: Base URL for the crypto news provider.
- `CRYPTO_NEWS_API_KEY`: Optional API key for the crypto news provider.
- `REGULATORY_MONITOR_API_URL`: Base URL for the regulatory monitor provider.
- `REGULATORY_MONITOR_API_KEY`: Optional API key for the regulatory monitor provider.

## Bounded Extract Limits

Each article record carries `retentionMode: "bounded_factual_extract"` and contains:

- Title, factual summary, extracted claims (max 20), topic tags
- Publisher metadata, source quality indicators, corroboration state
- Source references (HTTPS URLs only, no paywalled or robots-disallowed content)
- Immutable article and version identities

Providers must declare non-empty `license` and confirm `robotsCompliance: true` and `termsAccepted: true`. Missing or negative declarations cause collection to abort.

## Immutable Article/Version and Correction Semantics

Each article carries:

- `articleId`: Stable provider-supplied article identity
- `sourceVersionId`: Immutable version marker for this specific content snapshot
- `correctsSourceVersionId`: If non-null, indicates this record corrects an earlier version

A correction creates a new record with the correction reference, never a mutation. The original version remains in the database as historical evidence.

A provider reusing `sourceVersionId` for changed content creates a hard conflict, not an inferred correction.

## Freshness Caps

- Ecosystem news (`ecosystem_news`): 24-hour freshness window (`expiresAtUnixMs = retrievedAtUnixMs + 86400000`)
- Regulatory risk (`regulatory_risk`): 72-hour freshness window (`expiresAtUnixMs = retrievedAtUnixMs + 259200000`)

## Syndication vs Independent Corroboration

Articles carry a `corroborationState` field:

- `unconfirmed`: Single source, unverified
- `single_source`: Single source, verification status unknown
- `independently_corroborated`: Multiple independent sources confirm the same facts
- `conflicting`: Sources disagree on material facts

Syndicated content (same `syndicationId` across sources) is distinguished from independent reporting. Independent corroboration elevates confidence but does not create deterministic authority.

## Conflict and Stale Behavior

- `sourceVersionId` collision with different content = hard conflict, collection fails closed
- Stale articles (past `expiresAtUnixMs`) are excluded from selection but retained as historical evidence
- Freshness is evaluated at collection time; later expiry does not retroactively corrupt earlier records

## Command Exit Statuses

| Status      | Exit Code | Meaning                                                         |
| ----------- | --------- | --------------------------------------------------------------- |
| COMPLETE    | 0         | All configured sources succeeded (or replayed identically)      |
| PARTIAL     | 0         | At least one source succeeded; others failed or degraded        |
| UNAVAILABLE | 1         | All sources unavailable (HTTP 429, 404, 5xx, timeouts)          |
| FAILED      | 1         | Validation conflict, malformed payload, or zero usable evidence |

## Lower-Confidence Contextual Cap

News evidence is explicitly lower-confidence contextual evidence. It supplements core telemetry but cannot become execution authority. Confidence is capped at the source-supplied `reliability` value (0.0-1.0), never artificially elevated.

## Missing Coverage Not Meaning No Risk

A source returning empty results or an unavailable source is a diagnostic outcome, not a "no risk" determination. Operators should investigate source outages rather than assume clean conditions.

## Scope Limitation

This routine ends at persisted normalized observations in `normalized_observations`. Evidence bundle assembly (INT-PUBLISH #13) and research brief generation (INT-BRIEFS #12) are separate issues.
