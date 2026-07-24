# feat: collect and normalize Solana ecosystem news and regulatory risk evidence

## Summary

Collect, retain, normalize, cluster, and deduplicate Solana ecosystem news and regulatory-risk evidence relevant to SOL/USDC.

This is the third PR-sized child of #9. It is deliberately separated from deterministic support/resistance evidence and scheduled event/protocol-incident collection because news sources, confidence, retention, and deduplication require different rules.

## Correct boundary

This issue produces contextual evidence records and source-linked factual summaries. It does not make the final policy decision, predict price direction from headlines, or authorize execution.

News and regulatory evidence must carry visibly lower and more conditional confidence than deterministic on-chain/oracle facts.

## Required evidence families

At minimum support normalized records for:

- material Solana ecosystem announcements;
- protocol upgrades, launches, deprecations, or governance changes not already represented as scheduled events;
- material security disclosures and post-incident reporting;
- token unlock/supply news not available as a canonical scheduled event;
- regulatory or legal developments with a defensible SOL/USDC market-risk relationship;
- major exchange/custody/access developments affecting SOL availability or liquidity.

## Required normalized record

Each record must include at minimum:

- stable source/article identity;
- evidence family and topic tags;
- bounded factual summary or extracted claims;
- publication time, source update time when available, retrieval time, `asOf`, and `expiresAt`;
- source publisher and source-quality metadata;
- confidence and corroboration state;
- affected protocols/assets/jurisdictions where applicable;
- source references and compliant raw/extract provenance;
- cluster/deduplication identity;
- warnings for unconfirmed claims, corrections, paywalled/partial material, or source disagreement.

Do not store a directional recommendation as part of the normalized evidence record.

## Source, retention, and copyright behavior

- Use adapters behind ports and an explicit allowlist/configuration of sources.
- Respect source terms, licensing, robots restrictions, and retention constraints.
- Store URLs, metadata, hashes, and bounded compliant extracts rather than copying full copyrighted articles.
- Preserve corrections and updates without overwriting historical source records.
- Reject content that cannot be traced to a source reference.

## Clustering and deduplication

- Exact source replays are idempotent.
- Syndicated or materially duplicate coverage should be grouped into a cluster using deterministic identifiers and similarity thresholds.
- Preserve every source reference used for corroboration.
- Do not count a syndicated copy as independent corroboration.
- Conflicting reports remain visible as conflicting evidence rather than being compressed into false certainty.

## Scope

In scope:

- ecosystem-news and regulatory-risk source adapters;
- source allowlist/configuration;
- compliant raw/source-reference retention;
- normalized contracts and taxonomy additions;
- clustering, deduplication, correction handling, freshness, confidence, and provenance;
- persistence, fixtures, tests, and documentation.

Out of scope:

- support/resistance evidence;
- scheduled macro events and active protocol incidents;
- on-chain flow or perp/liquidation evidence;
- LLM research-brief generation beyond any deterministic bounded extraction explicitly required for normalization;
- final policy synthesis, UI, or execution behavior.

## Guardrails

- Do not infer market direction from a headline.
- Unconfirmed claims remain explicitly unconfirmed.
- Syndication is not independent corroboration.
- Missing news coverage does not imply no risk.
- Contextual evidence cannot override deterministic execution guards.

## Acceptance criteria

- [ ] Ecosystem-news and regulatory-risk records have a strict source-linked normalized contract.
- [ ] Source retention is compliant and does not copy prohibited full article content.
- [ ] Exact replays are idempotent, syndicated duplicates are clustered, and independent corroborating sources remain traceable.
- [ ] Corrections, conflicting reports, unconfirmed claims, stale items, and unavailable sources are represented explicitly.
- [ ] Tests cover exact duplicates, syndication, corroboration, conflicts, corrections, partial/paywalled material, stale items, and malformed source responses.
- [ ] Documentation defines the source allowlist, retention policy, freshness rules, and the lower-confidence contextual boundary.

## Parent

Child of #9.

## Dependencies

The architecture, persistence, and taxonomy foundations from #3, #5, and #6 must be present on the target branch.
