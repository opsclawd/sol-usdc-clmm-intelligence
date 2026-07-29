Collect SOL/USDC on-chain flow evidence by running `pnpm collect:on-chain-flow`.

This routine collects on-chain flow events from two providers: Helius (whale_transfer for the position wallet only) and Birdeye (whale_swap and dex_net_flow). It reports source outcomes (COMPLETE, PARTIAL, UNAVAILABLE, FAILED) and persists normalized observations to the database.

## Authority Boundaries

**This routine does NOT:**

- Make trading recommendations or express market direction
- Generate LLM research briefs (schema-constrained briefs are INT-BRIEFS #12)
- Synthesize policy (regime-engine owns final PolicyInsight)
- Execute transactions or manage positions
- Provide comprehensive whale surveillance (Helius whale_transfer is scoped to WALLET_PUBLIC_KEY only)
- Provide stablecoin_flow (deferred pending Circle address verification) or cex_flow_proxy (deferred indefinitely)

## Provider Configuration

**Helius (whale_transfer, position wallet only):**

- `HELIUS_FLOW_API_URL`: Base URL (`https://api.helius.xyz`)
- `HELIUS_API_KEY`: Helius API key
- `WALLET_PUBLIC_KEY`: Position wallet address (the only wallet watched)
- `ON_CHAIN_WHALE_TRANSFER_MIN_USDC`: Minimum transfer amount in USDC (default: 1,000,000)
- `ON_CHAIN_FLOW_LOOKBACK_MS`: Lookback window in milliseconds (default: 900000 = 15 minutes)

**Birdeye (whale_swap, dex_net_flow):**

- `BIRDEYE_FLOW_API_URL`: Base URL (`https://public-api.birdeye.so`)
- `BIRDEYE_API_KEY`: Birdeye API key
- `ORCA_SOL_USDC_WHIRLPOOL`: Orca whirlpool address (`Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE`)
- `ON_CHAIN_WHALE_SWAP_MIN_USDC`: Minimum swap amount (default: 1,000,000 USDC)
- `ON_CHAIN_DEX_NET_FLOW_MIN_USDC`: Minimum DEX net flow amount (default: 5,000,000 USDC)

## Event Coverage Matrix

| Event kind        | Status                               | Source                                              |
| ----------------- | ------------------------------------ | --------------------------------------------------- |
| `whale_transfer`  | Live, position wallet only           | Helius address history                              |
| `whale_swap`      | Live                                 | Birdeye pair trades                                 |
| `dex_net_flow`    | Live                                 | Birdeye pair trades                                 |
| `stablecoin_flow` | Deferred pending source verification | No clean free-tier source confirmed                 |
| `cex_flow_proxy`  | Deferred                             | Paid identity/self-maintained address book rejected |

## Watched-Wallet Boundary

Helius whale_transfer is scoped exclusively to `WALLET_PUBLIC_KEY`. The collector polls the Helius legacy address-history endpoint for this single wallet only. A saturated page (100 transactions returned, window not fully covered) produces `unavailable` — not a clean no-event result. See docs/operator-runbook.md for the completeness guard details.

## Threshold Gating

Live event kinds use minimum USD value thresholds:

- `ON_CHAIN_WHALE_TRANSFER_MIN_USDC`: Minimum whale transfer amount (default: 1,000,000 USDC)
- `ON_CHAIN_WHALE_SWAP_MIN_USDC`: Minimum whale swap amount (default: 1,000,000 USDC)
- `ON_CHAIN_DEX_NET_FLOW_MIN_USDC`: Minimum DEX net flow amount (default: 5,000,000 USDC)

## Source Health Semantics

A normally `PARTIAL` run indicates Birdeye provides usable evidence while Helius reports `unavailable` due to a saturated page (not a clean no-event result). Operators should distinguish between:

- **Clean empty**: Helius returns fewer than 100 transactions covering the full lookback window — genuine no qualifying events
- **Saturated page**: Helius returns 100 transactions without covering the window — `unavailable`, window not confirmed clean

## Command Exit Statuses

| Status      | Exit Code | Meaning                                                                |
| ----------- | --------- | ---------------------------------------------------------------------- |
| COMPLETE    | 0         | All configured sources succeeded (or replayed identically)             |
| PARTIAL     | 0         | At least one source succeeded; others failed or degraded               |
| UNAVAILABLE | 1         | All sources unavailable (HTTP 429, 404, 5xx, timeouts, saturated page) |
| FAILED      | 1         | Validation conflict, malformed payload, or zero usable evidence        |

## Missing Coverage Not Meaning No Risk

A source returning empty results or an unavailable source is a diagnostic outcome, not a "no flow" determination. Operators should investigate source outages rather than assume clean conditions. A saturated Helius page is explicitly unavailable, not a clean no-event result.

## Scope Limitation

This routine ends at persisted normalized observations in `normalized_observations`. Evidence bundle assembly (INT-PUBLISH #13) is a separate concern.
