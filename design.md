# Design Document: On-Chain Flow Research Collectors Pack B

## The Problem and Why It Matters

The intelligence agent requires context about SOL/USDC-relevant market pressure to better understand broader market regimes and price action drivers. Currently, it relies on local pool data, price data, and news, but lacks direct observation of massive on-chain flows (whales, stablecoin mints/burns, and broader DEX/CEX flows) that often precede or explain significant market moves. Capturing these flows allows the system to provide higher-quality, evidence-backed contextual signals to the regime engine, separating the deterministic facts (e.g., "$100M USDC minted") from interpretative inferences (e.g., "institutions are buying").

## Key Design Decisions and Trade-offs Considered

1. **Source Selection & Source Adapters:**
   - _Considered:_ Building custom RPC indexers vs. using specialized data providers (e.g., Helius, Birdeye, SolanaFM).
   - _Decision:_ Utilize specialized data providers via external HTTP APIs, mapping them into the `Source` taxonomy. This reduces maintenance overhead of low-level RPC indexing while providing acceptable latency for intelligence gathering. We will introduce new `Source` types (e.g., `helius-api`, `birdeye-api`) in `src/contracts/taxonomy.ts`.

2. **Differentiating Facts vs. Interpretations:**
   - _Considered:_ Enhancing observation payloads with inferred motives directly in the normalization phase.
   - _Decision:_ Strictly adhere to the guardrail that "a transfer is a fact; motive is an interpretation". Normalized payloads will strictly contain facts (amount, direction, venue, address context). Any interpretation will be deferred or handled separately, explicitly separated from deterministic fact storage. The `signalClass` for these observations will be marked as `contextual` or `probabilistic` if uncertainty is involved (like CEX proxies), but the flow itself will be treated as `deterministic` facts of the blockchain event.

3. **CEX Proxy Noise Handling:**
   - _Decision:_ CEX flow proxies inherently suffer from address attribution errors. We will mandate that the `ConfidencePolicy` and `ConfidenceComponents` for these specific proxies are configured with lower default source reliability or data completeness, ensuring the noise/confidence metadata is passed downstream to the regime engine.

4. **Thresholding and Deduplication:**
   - _Considered:_ Hardcoding thresholds in adapters.
   - _Decision:_ Thresholds (e.g., "whale" definition of >$1M) must be configurable (via environment or job configuration) and documented. Deduplication will be handled by robust `payloadHash` and `sourceObservationKey` generation to prevent identical on-chain events observed multiple times from duplicating records in the database.

## Proposed Approach with Rationale

1. **Taxonomy Updates (`src/contracts/taxonomy.ts`):**
   - **ObservationKinds:** Add `whale_transfer`, `whale_swap`, `stablecoin_flow`, `dex_net_flow`, `cex_flow_proxy`.
   - **Sources:** Add necessary sources (e.g., `helius-api`, `solana-fm-api`).
   - Associate these new kinds with the existing `EvidenceFamily` of `"on_chain_flow"`.

2. **Domain & Contracts:**
   - Define payload interfaces for each new `ObservationKind` (e.g., `WhaleTransferPayload`, `DexNetFlowPayload`), ensuring they include fields for `amount`, `direction`, `venue`, `addressContext`, `freshness`, and `confidence`.

3. **Ports & Adapters:**
   - Create new port interfaces in `src/ports/` (e.g., `OnChainFlowSource`).
   - Implement Node adapters in `src/adapters/node/` (e.g., `http-helius-flow-source.ts`) for fetching data.

4. **Application Layer (Use Cases):**
   - Create a new use case, e.g., `src/application/collect-on-chain-flow.ts`, which coordinates fetching from sources, raw retention (saving to `RawObservationRepo`), normalization, and threshold filtering, and then saves to `NormalizedObservationRepo`.
   - Ensure the use case filters out events below configured thresholds (e.g., small transfers that do not qualify as "whale").

5. **Tests:**
   - Ensure unit tests for the use case cover scenarios with large events, duplicate events (verifying idempotency via hashes), malformed API responses, and empty (no-event) scenarios.

## Assumptions Made

- We assume the existence of third-party API keys (e.g., Helius, Birdeye) that will be injected via environment variables.
- We assume the existing `RawObservationRepo` and `NormalizedObservationRepo` interfaces are flexible enough to accommodate the new on-chain flow payloads without schema changes, since payloads are stored as `unknown` or JSONB in the database.
- We assume cron orchestration will schedule these flow collectors at an appropriate cadence (e.g., every 5-15 minutes) to ensure data freshness without exceeding rate limits.
- We assume "CEX flow proxies" rely on known CEX hot wallet labels provided by our selected data sources.

## What is In Scope

- Expanding the `ObservationKind` and `Source` taxonomies.
- Source adapter implementations for fetching on-chain flow data.
- The use case for raw retention, normalization, and deduplication.
- Application of confidence scaling and explicit noise handling for CEX proxies.
- Configuration for event size thresholds.
- Comprehensive unit tests covering the new use case and normalization logic.

## What is Explicitly Out of Scope

- Making policy decisions based on this flow data (handled by regime-engine).
- Speculative motive inference of the flows as deterministic truth.
- LLM final summarization or research brief generation over these flows (to be handled in separate brief-generation jobs).
- Provisioning or paying for third-party API access (an operational task).

## Risks or Concerns Identified

- **Data Source Reliability:** Upstream indexers or APIs might have high latency or downtime, requiring resilient retry logic in the `fetch-http` adapter.
- **Data Volume:** Defining thresholds too low could spam the `raw_observations` and `normalized_observations` tables. Thresholds must be strictly enforced before database insertion.
- **Deduplication Flaws:** If `sourceObservationKey` is not constructed consistently (e.g., differing based on pagination offsets instead of transaction hashes), we risk polluting the database with duplicate events. We must rely on canonical on-chain identifiers (like transaction signatures) for deduplication.
