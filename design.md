# On-chain flow Phase 1: dex_net_flow & whale_swap Implementation Design

## 1. Problem Statement & Context

The current implementation of the Birdeye flow adapter (`HttpBirdeyeFlowSource`) uses a fictional API response schema (`BirdeyeNetFlowEvent`) which does not exist on Birdeye. It must be replaced with a real implementation that consumes Birdeye's pair-scoped trades endpoint (`/defi/txs/pair`) to extract `dex_net_flow` and `whale_swap` events. This is essential to transition the `collect:on-chain-flow` job from relying on synthetic data to using verified, real production data via the free-tier API, without needing a plan upgrade or a wallet watch-list.

## 2. Key Design Decisions & Trade-offs

### A. Handling the Missing `slot` Field

Birdeye’s pair-trades endpoint does not return a `slot` field for transactions.

- **Option 1**: Look up the slot via a supplementary Solana RPC call for each trade.
- **Option 2**: Make `slot` optional in the on-chain-flow schemas and contracts for Birdeye-sourced events.
- **Decision**: We will proceed with **Option 2**. Performing RPC lookups introduces unnecessary network latency and complexity for a field that has limited analytical value in this specific context (where `blockUnixTime` is already authoritative).

### B. Event Classification

- **Direction Logic**: Direction will be inferred from the `symbol` of the `from` and `to` fields in Birdeye's response. `from.symbol === "SOL"` and `to.symbol === "USDC"` indicates SOL was sold (`outbound` / sell pressure). The reverse indicates SOL was bought (`inbound` / buy pressure).
- **Volume Calculation**: USD-denominated volume will be directly extracted from the USDC side's `uiAmount`, since USDC is practically pegged to $1.

### C. Fallback for Helius

The issue explicitly specifies that `whale_transfer`, `stablecoin_flow`, and `cex_flow_proxy` (which depend on Helius) are out of scope. Instead of leaving broken endpoints active, the Helius adapter path will be disabled to cleanly report an `unavailable` status, preventing unexpected errors during the cron execution.

## 3. Proposed Approach with Rationale

1. **Schema & Contract Updates**:
   - Update `OnChainFlowFreshnessContext` in `src/contracts/on-chain-flow.ts` to make `slot?: number`.
   - Update `freshnessContextSchema`, `whaleSwapFlowSchema`, and `dexNetFlowSchema` in `src/domain/on-chain-flow/validate.ts` to make `slot` optional.
   - Add a fallback `eventIndex: 0` for `whale_swap` schemas, since Birdeye's flat trade list has no intra-transaction instruction index.

2. **Adapter Rewrite (`HttpBirdeyeFlowSource`)**:
   - Refactor `collect()` to query `https://public-api.birdeye.so/defi/txs/pair`.
   - Include query parameters: `address` (Orca pool), `tx_type=swap`, `offset` (pagination), `after_time`, and `before_time`.
   - Paginate through the endpoint's responses until `hasNext` is false or the bounds are exhausted.
   - **dex_net_flow**: Accumulate USDC-side `uiAmount` into `buyVolumeUsdc` and `sellVolumeUsdc` across the entire polling window. Compute `netFlowUsdc = buyVolumeUsdc - sellVolumeUsdc`. Yield a single `dex_net_flow` event.
   - **whale_swap**: Filter trades where the USDC-side `uiAmount` is $\ge$ `WHALE_SWAP_MIN_USDC` threshold. Construct a `whale_swap` event per qualifying trade, using the `owner` field as the wallet address, and the `txHash` for `sourceReferences` and `transactionSignature`.

3. **Configuration & Documentation**:
   - Update `.env.example` to ensure `BIRDEYE_FLOW_API_URL` points to `https://public-api.birdeye.so`.
   - Update `cron/routines/on-chain-flow.md` to reflect the current state (only 2 of 5 events are live).

## 4. Assumptions Made

- The Birdeye pair endpoint guarantees the `SOL` and `USDC` symbols will reliably map to the respective sides of the trade for the pool in question.
- The `WHALE_SWAP_MIN_USDC` threshold configuration can be securely injected into or accessed by the adapter/collector logic.
- Setting `eventIndex: 0` for all `whale_swap` events accurately satisfies schema requirements without breaking any downstream unique constraints, given each `txHash` represents one swap.
- The `after_time` and `before_time` query parameters correctly bound the time window inclusive-exclusive without causing edge-case duplicate event overlaps across consecutive cron executions.

## 5. Scope

**In Scope:**

- Modifying schemas and types to make `slot` optional.
- Complete rewrite of `HttpBirdeyeFlowSource` and related tests using the real Birdeye `/defi/txs/pair` payload structure.
- Generation of valid `dex_net_flow` and `whale_swap` events from Birdeye data.
- Stubbing the Helius adapter path to report `unavailable`.
- `.env.example` and routine documentation updates.

**Out of Scope:**

- Implementation of `whale_transfer`, `stablecoin_flow`, and `cex_flow_proxy` event kinds.
- Supplementary RPC calls to fetch block slots.
- Adding wallet watch-lists or Helius API keys.

## 6. Risks & Concerns

- **Pagination Overhead**: Although the rate limit is 100 requests, a massive burst of trades during a volatile period could require significant pagination requests. If `limit` is small, it could theoretically hit rate limits. We should maximize the `limit` parameter (e.g., 50 or 100) per request to minimize network calls.
- **Memory Consumption**: Aggregating all trades over a 15-minute window directly in memory before producing the `dex_net_flow` event is generally safe, but could scale linearly with network activity. It is deemed acceptable for this scale, but should be noted.
- **Symbol Matching Fragility**: Relying on string matches for `symbol === "SOL"` may be fragile if the provider alters casing or naming. Checking the token mint address would be more resilient.
