# Design Document: Perp and Liquidation Research Collectors (Pack C)

## Problem and Motivation

The SOL/USDC market often experiences sharp volatility driven by leverage unwinding and crowding. Currently, the intelligence pipeline lacks visibility into perpetual futures data such as funding rates, open interest (OI) trends, perp/spot basis, and liquidation cascades. Without this context, the downstream `regime-engine` cannot accurately identify leverage-driven market stress or directional crowding, potentially leading to unsafe LP positioning or misclassified market regimes. Integrating this evidence family allows the system to detect when the market is over-leveraged and vulnerable to cascades.

## Proposed Approach and Architecture

We will implement a new set of collectors focused on the `perp_liquidation` evidence family. The architecture will follow the existing layered monolith pattern:

1. **Taxonomy Extensions (`src/contracts/taxonomy.ts`)**:
   - **ObservationKinds**: `funding_rate`, `open_interest`, `perp_basis`, `liquidation_event`, `leverage_proxy`.
   - **FeatureKinds**: `oi_trend_4h`, `funding_rate_annualized`, `liquidation_cluster_1h`, `basis_spread_bps`.
   - **Sources**: `binance-fapi` (for dominant CEX liquidity), `drift-api` (for dominant Solana on-chain liquidity).

2. **Ports (`src/ports/perp-liquidation-source.ts`)**:
   - Define a `PerpLiquidationSource` interface that abstracts the fetching of funding rates, OI, basis, and recent liquidations.

3. **Adapters (`src/adapters/node/`)**:
   - `http-binance-fapi-source.ts`: Adapter for Binance USDⓈ-M Futures API (unauthenticated public endpoints).
   - `http-drift-source.ts`: Adapter for Drift Protocol's public API / RPC.

4. **Domain (`src/domain/perp-liquidation/`)**:
   - **Normalization**: Pure functions to transform raw venue responses into canonical `NormalizedObservationRow` shapes, ensuring no venue-specific quirks leak.
   - **Derivation**: Pure functions to compute deterministic features (e.g., calculating a 4h OI trend from recent observations, or clustering liquidations over the last hour).
   - **Freshness & Confidence**: Strict policies. Missing or stale data will explicitly degrade confidence but not fail the pipeline entirely.

5. **Application & Jobs**:
   - `src/application/collect-perp-liquidation.ts`: Orchestrates fetching from ports, saving raw observations, normalizing, and storing.
   - A new cron job entry to schedule collection at the appropriate cadence (e.g., every 5 minutes).

## Design Decisions and Trade-offs

- **CEX vs DEX Sourcing**:
  - _Trade-off_: Binance has the most liquidity and leads price discovery, but is centralized. Drift is on-chain but has less volume.
  - _Decision_: Implement adapters for both. Binance provides the macro leverage context, while Drift provides localized Solana ecosystem leverage context.
- **Polling vs WebSockets**:
  - _Trade-off_: Liquidations happen in real-time, but our system architecture is based on cron polling.
  - _Decision_: Rely on REST API snapshots (e.g., recent liquidation history endpoints) rather than maintaining stateful WebSocket connections. This fits the existing pipeline design and is sufficient for 5-minute regime evaluations.
- **Data Degradation vs Hard Failure**:
  - _Trade-off_: If a perp API goes down, should we halt the pipeline?
  - _Decision_: Missing or stale perp data will "degrade explicitly" via the confidence model (e.g., `stale_input_degraded`), allowing the downstream regime engine to proceed cautiously rather than flying blind or halting.

## Assumptions

- **Public API Access**: It is assumed that Binance's `fapi` and Drift's public APIs provide sufficient data without requiring authenticated rate-limit tiers for our polling frequency.
- **Cron Frequency**: It is assumed the collection will run on a standard schedule (e.g., 5m or 15m), meaning we are looking for "clusters" of liquidations in the intervening time window, not millisecond-precise triggers.
- **No LLM in Collection Phase**: It is assumed that summarizing the leverage state via LLM happens downstream (or in the research brief phase), and this epic purely handles raw data collection and deterministic derivations.

## Scope Boundaries

**In Scope**:

- Definition of new taxonomy types for perp/liquidation data.
- Implementation of `PerpLiquidationSource` port.
- Concrete adapters for Binance (`binance-fapi`) and Drift (`drift-api`).
- Logic for raw retention, normalization, and deterministic feature derivation.
- Confidence and freshness models tailored for highly ephemeral leverage data.
- Comprehensive unit tests covering both positive cases and failure modes (stale data, API unavailability).

**Explicitly Out of Scope**:

- Downstream policy decisions (e.g., what to do with the leverage data).
- LLM final summarization prompts (handled in a separate brief generation step).
- Integrating unsupported or low-quality venues (e.g., small off-shore CEXes or unverified lending protocols).
