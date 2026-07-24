# Design Document: Collect and Normalize Solana Ecosystem News and Regulatory Risk Evidence

## The Problem Being Solved and Why It Matters

Solana ecosystem news and regulatory developments provide critical contextual intelligence for market regime classification and policy generation. Unlike deterministic on-chain data (prices, pool statistics), news and regulatory evidence are qualitative, asynchronous, and inherently lower confidence.

The current system handles deterministic signals, support/resistance, scheduled events, and active protocol incidents. However, unpredictable news and regulatory risks require different handling due to the nature of their sources, varying confidence levels, data retention constraints (copyright), and high rates of syndication and duplication. By collecting, normalizing, and clustering this contextual evidence, we enable downstream systems (like the regime engine) to synthesize policies that account for macroscopic risk factors before they fully manifest in on-chain price or volume action.

## Key Design Decisions and Trade-offs Considered

1. **Separation from Scheduled Events:** News and regulatory updates are treated as a distinct pipeline from scheduled macro events or protocol incidents.
   - _Trade-off:_ This introduces new taxonomy and contract types rather than reusing existing event structures.
   - _Rationale:_ News aggregation requires complex clustering and deduplication (handling syndication), different source-quality metadata, and strict copyright compliance constraints that don't apply to on-chain protocol incidents.

2. **Compliant Retention and Copyright:** We will retain bounded factual extracts, source URLs, and metadata rather than scraping or storing full article bodies.
   - _Trade-off:_ We lose the complete context of the article if the source URL becomes unavailable.
   - _Rationale:_ Strict adherence to copyright law, terms of service, and robots.txt restrictions is a hard requirement.

3. **Immutable Corrections:** Corrections and updates to news will be appended as new records linked to the original, rather than overwriting history.
   - _Trade-off:_ Increases storage and logic complexity for querying the "latest" state.
   - _Rationale:_ Ensures a full auditable history of what evidence was available at any given time.

4. **Clustering vs. Corroboration:** Syndicated coverage will be grouped into clusters using deterministic identifiers or similarity heuristics, but will _not_ be counted as independent corroboration. Conflicting reports will remain visible as separate evidence.
   - _Rationale:_ Prevents false certainty driven by high-volume syndicated news echoing a single unconfirmed source.

## Proposed Approach with Rationale

1. **Taxonomy Additions (`src/contracts/taxonomy.ts`):**
   - Add new `ObservationKind`s: `ecosystem_news` and `regulatory_risk`.
   - Add new `EvidenceFamily`s: `ecosystem_news` and `regulatory_risk`.
   - Add new `Source`s (e.g., `crypto-news-api`, `regulatory-monitor-api`).
   - The `SignalClass` will explicitly be `contextual`.

2. **Normalized Contracts (`src/contracts/news-events.ts`):**
   - Define `NewsPayloadV1` and `RegulatoryPayloadV1` containing fields for: stable article identity, topic tags, bounded factual summary, publication/retrieval times, publisher/source-quality metadata, corroboration state, affected scope, cluster identity, and warnings.

3. **Source Adapters and Ports (`src/ports/news-source.ts`):**
   - Introduce a new port for news adapters, configuring an explicit allowlist of supported sources.
   - Adapters will fetch the data and return bounded extracts that conform to a strict interface, omitting prohibited full-text content.

4. **Domain Logic (`src/domain/clustering.ts`):**
   - Implement pure domain functions to calculate cluster identities (e.g., via hash of title/topic or deterministic syndication IDs provided by APIs).
   - Evaluate independent corroboration, ensuring syndicated duplicates don't falsely inflate confidence.

5. **Persistence (`src/application` & `src/db`):**
   - Integrate into the existing `raw_observations` → `normalized_observations` pipeline.
   - Deduplication will ensure exact source replays are idempotent.

## Assumptions Made

- We assume that source adapters will utilize third-party APIs that provide structured news metadata (titles, summaries, URLs, publication times) rather than requiring us to scrape raw HTML.
- We assume basic text similarity or provider-supplied syndication IDs will be sufficient for clustering, avoiding the need for heavy NLP models within this service.
- We assume that when an API provides a short description or summary, it falls within fair-use or bounded extraction limits for retention.
- The `asOf` time will default to the article's publication time if available, falling back to retrieval time otherwise.

## Scope

**In Scope:**

- Ecosystem-news and regulatory-risk source adapters.
- Source allowlist/configuration.
- Compliant raw/source-reference retention.
- Normalized contracts and taxonomy additions.
- Logic for clustering, deduplication, correction handling, freshness calculation, confidence scoring, and provenance tracking.
- Persistence layer integration, fixtures, tests, and documentation updates.

**Out of Scope:**

- Support/resistance evidence handling.
- Scheduled macro events and active protocol incidents.
- On-chain flow or perp/liquidation evidence.
- LLM research-brief generation beyond the deterministic bounded extraction explicitly required for normalization.
- Final policy synthesis, UI representation, or execution behavior.

## Risks or Concerns Identified from Code Analysis

1. **Clustering Complexity:** Without complex NLP, relying solely on deterministic IDs or basic text similarity might lead to under-clustering (failing to group syndicated news with altered titles) or over-clustering. The thresholds must be carefully tuned.
2. **Data Sparsity in Corrections:** Handling article corrections and updates asynchronously means we may process policy based on outdated facts before the correction is ingested. The pipeline needs robust handling for `asOf` versus `retrievedAt` timelines.
3. **API Rate Limits and Paywalls:** External news sources may block requests or return partial/paywalled content, leading to malformed payload structures. The adapters must map these strictly to the `ParseStatus.failed` state or apply explicit warnings in the normalized contract.
