Collect SOL/USDC on-chain flow evidence by running `pnpm collect:on-chain-flow`.

This routine collects on-chain flow events from two providers: Helius (whale_transfer querying the Whirlpool address) and Birdeye (whale_swap and dex_net_flow). It reports source outcomes (COMPLETE, PARTIAL, UNAVAILABLE, FAILED) and persists normalized observations to the database.

## Authority Boundaries

**This routine does NOT:**

- Make trading recommendations or express market direction
- Generate LLM research briefs (schema-constrained briefs are INT-BRIEFS #12)
- Synthesize policy (regime-engine owns final PolicyInsight)
- Execute transactions or manage positions
- Provide comprehensive whale surveillance (Helius whale_transfer queries WHIRLPOOL_ADDRESS, not WALLET_PUBLIC_KEY, though addressContext.addressType remains 'wallet' for compatibility)
- Provide stablecoin_flow (deferred pending Circle address verification) or cex_flow_proxy (deferred indefinitely)

## Provider Configuration

**Helius (whale_transfer, Whirlpool target):**

- `HELIUS_FLOW_API_URL`: Base URL (`https://api.helius.xyz`)
- `HELIUS_API_KEY`: Helius API key
- `WHIRLPOOL_ADDRESS`: Authoritative Orca SOL/USDC Whirlpool address (`Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE`). Helius queries this address; `addressContext.addressType` remains `wallet` for compatibility even though `addressContext.address` is the Whirlpool address. `WALLET_PUBLIC_KEY` is retained for its actual position-scoped uses elsewhere.
- `ON_CHAIN_WHALE_TRANSFER_MIN_USDC`: Minimum transfer amount in USDC (default: 100,000)
- `ON_CHAIN_FLOW_LOOKBACK_MS`: Lookback window in milliseconds (default: 900000 = 15 minutes)

**Birdeye (whale_swap, dex_net_flow):**

- `BIRDEYE_FLOW_API_URL`: Base URL (`https://public-api.birdeye.so`)
- `BIRDEYE_API_KEY`: Birdeye API key
- `WHIRLPOOL_ADDRESS`: Authoritative Orca SOL/USDC Whirlpool address (`Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE`)
- `ON_CHAIN_WHALE_SWAP_MIN_USDC`: Minimum swap amount (default: 100,000 USDC)
- `ON_CHAIN_DEX_NET_FLOW_MIN_USDC`: Minimum DEX net flow amount (default: 250,000 USDC)

## Event Coverage Matrix

| Event kind        | Status                               | Source                                              |
| ----------------- | ------------------------------------ | --------------------------------------------------- |
| `whale_transfer`  | Live, Whirlpool target               | Helius address history                              |
| `whale_swap`      | Live                                 | Birdeye pair trades                                 |
| `dex_net_flow`    | Live                                 | Birdeye pair trades                                 |
| `stablecoin_flow` | Deferred pending source verification | No clean free-tier source confirmed                 |
| `cex_flow_proxy`  | Deferred                             | Paid identity/self-maintained address book rejected |

## Pool Target Boundary

Helius `whale_transfer` queries `WHIRLPOOL_ADDRESS`. Note that `addressContext.addressType` remains `wallet` for compatibility even though `addressContext.address` is the Whirlpool address. `WALLET_PUBLIC_KEY` is retained for position-scoped uses elsewhere. The collector polls the Helius legacy address-history endpoint for the Whirlpool address. A saturated page (100 transactions returned, window not fully covered) produces `unavailable` — not a clean no-event (`empty`) result. See docs/operator-runbook.md for the completeness guard details.

## Threshold Gating & Calibration Rationale

`on-chain-flow` runs every 15 minutes (`*/15 * * * *`). The default lookback remains 900,000 ms (15 minutes), so adjacent runs have no structural gap.

Implemented live thresholds by exact repository names and values:

```bash
ON_CHAIN_WHALE_TRANSFER_MIN_USDC=100000
ON_CHAIN_WHALE_SWAP_MIN_USDC=100000
ON_CHAIN_DEX_NET_FLOW_MIN_USDC=250000
```

Calibration arithmetic snapshot:

```text
Current snapshot: $72,954,595 24h volume and $26,150,296 TVL.
$72,954,595 / 96 fifteen-minute windows = approximately $759,944 gross volume per window.
$100,000 / $759,944 = approximately 13.2% of a typical window.
```

Observed VPS names `ON_CHAIN_STABLECOIN_FLOW_MIN_USDC` and `ON_CHAIN_CEX_PROXY_MIN_USDC` are parsed for deferred signal kinds and do not replace the live whale-transfer/whale-swap variables.

> **Operator Callout**: The deployment VPS must set the two live whale values (`ON_CHAIN_WHALE_TRANSFER_MIN_USDC` and `ON_CHAIN_WHALE_SWAP_MIN_USDC`) to `100000`; repository documentation cannot mutate host-local environment state.

Note: The 15-minute cadence makes four times as many Helius/Birdeye collection attempts as the old hourly cadence; provider rate limits and cost must be watched after rollout.

## Source Health Semantics

`empty`: the provider request completed, but no event became accepted or replayed; this is healthy source execution, not usable evidence.

Operators should distinguish between:

- **Clean empty (`empty`)**: Provider request completed with zero qualifying events; healthy source execution, not usable evidence.
- **Saturated page (`unavailable`)**: Helius returns 100 transactions without covering the window — explicitly `unavailable`, window not confirmed clean. Keep saturated Helius pages `unavailable`, not `empty`.

## Command Exit Statuses and Truth Table Reducer Rules

Truth table reducer rules:

```text
all empty -> COMPLETE / exit 0
empty + accepted/replayed -> COMPLETE / exit 0
empty + unavailable/failed -> PARTIAL / exit 0
all unavailable -> UNAVAILABLE / exit 1
all non-empty failures -> FAILED / exit 1
```

| Status      | Exit Code | Meaning                                                                     |
| ----------- | --------- | --------------------------------------------------------------------------- |
| COMPLETE    | 0         | All configured sources succeeded, replayed identically, or reported `empty` |
| PARTIAL     | 0         | At least one source succeeded/empty while others failed or were unavailable |
| UNAVAILABLE | 1         | All sources unavailable (HTTP 429, 404, 5xx, timeouts, saturated page)      |
| FAILED      | 1         | Validation conflict, malformed payload, or non-empty source failure         |

## Missing Coverage Not Meaning No Risk

A source returning empty results or an unavailable source is a diagnostic outcome, not a "no flow" determination. Operators should investigate source outages rather than assume clean conditions. A saturated Helius page is explicitly `unavailable`, not `empty`.

## Scope Limitation

This routine ends at persisted normalized observations in `normalized_observations`. Evidence bundle assembly (INT-PUBLISH #13) is a separate concern.
