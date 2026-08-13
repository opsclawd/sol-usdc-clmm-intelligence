Collect SOL/USDC on-chain flow evidence by running `pnpm collect:on-chain-flow`.

This routine collects on-chain flow events from two providers: Helius (windowed `dex_net_flow` querying the Whirlpool contract address) and Birdeye (`whale_swap` and `dex_net_flow`). It reports source outcomes (COMPLETE, PARTIAL, UNAVAILABLE, FAILED) and persists normalized observations to the database.

## Authority Boundaries

**This routine does NOT:**

- Make trading recommendations or express market direction
- Generate LLM research briefs (schema-constrained briefs are INT-BRIEFS #12)
- Synthesize policy (regime-engine owns final PolicyInsight)
- Execute transactions or manage positions
- Provide stablecoin_flow (deferred pending Circle address verification) or cex_flow_proxy (deferred indefinitely)

## Provider Configuration

**Helius (dex_net_flow, Whirlpool contract target):**

- `HELIUS_FLOW_API_URL`: Base URL (`https://api.helius.xyz`)
- `HELIUS_API_KEY`: Helius API key
- `WHIRLPOOL_ADDRESS`: Authoritative Orca SOL/USDC Whirlpool address (`Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE`). Helius queries this address; `addressContext.addressType` is `contract`.
- `ON_CHAIN_DEX_NET_FLOW_MIN_USDC`: Minimum DEX net flow amount in USDC (default: 250,000)
- `ON_CHAIN_FLOW_LOOKBACK_MS`: Lookback window in milliseconds (default: 900000 = 15 minutes)

**Birdeye (whale_swap, dex_net_flow):**

- `BIRDEYE_FLOW_API_URL`: Base URL (`https://public-api.birdeye.so`)
- `BIRDEYE_API_KEY`: Birdeye API key
- `WHIRLPOOL_ADDRESS`: Authoritative Orca SOL/USDC Whirlpool address (`Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE`)
- `ON_CHAIN_WHALE_SWAP_MIN_USDC`: Minimum swap amount (default: 100,000 USDC)
- `ON_CHAIN_DEX_NET_FLOW_MIN_USDC`: Minimum DEX net flow amount (default: 250,000 USDC)

## Event Coverage Matrix

| Event kind        | Status                               | Source                                                |
| ----------------- | ------------------------------------ | ----------------------------------------------------- |
| `whale_swap`      | Live                                 | Birdeye pair trades                                   |
| `dex_net_flow`    | Live                                 | Birdeye pair trades, Helius address history aggregate |
| `whale_transfer`  | Retired                              | Retired (replaced by Helius windowed net flow)        |
| `stablecoin_flow` | Deferred pending source verification | No clean free-tier source confirmed                   |
| `cex_flow_proxy`  | Deferred                             | Paid identity/self-maintained address book rejected   |

## Pool Target Boundary

Helius `dex_net_flow` queries `WHIRLPOOL_ADDRESS` (`addressContext.addressType: "contract"`). The collector walks the Helius transaction history endpoint for the Whirlpool address across the lookback window, aggregating USDC transfers into pool (buy volume) and out of pool (sell volume). Reaching the 25-page cap marks the aggregate as `partial` completeness without losing the calculated volume.

## Threshold Gating & Calibration Rationale

`on-chain-flow` runs every 15 minutes (`*/15 * * * *`). The default lookback is 900,000 ms (15 minutes), so adjacent runs have no structural gap.

Implemented live thresholds by exact repository names and values:

```bash
ON_CHAIN_WHALE_SWAP_MIN_USDC=100000
ON_CHAIN_DEX_NET_FLOW_MIN_USDC=250000
```

Calibration arithmetic snapshot:

```text
Current snapshot: $72,954,595 24h volume and $26,150,296 TVL.
$72,954,595 / 96 fifteen-minute windows = approximately $759,944 gross volume per window.
$250,000 net flow represents ~32.9% net imbalance of a typical window volume.
$100,000 swap / $759,944 = approximately 13.2% of a typical window.
```

## Source Health Semantics

`empty`: the provider request completed, but no event met the qualification threshold; this is healthy source execution, not usable evidence.

Operators should distinguish between:

- **Clean empty (`empty`)**: Provider request completed with net flow or swap size below threshold; healthy source execution.
- **Provider failure (`unavailable`)**: HTTP timeout, 429, or 5xx error from Helius or Birdeye.

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
| UNAVAILABLE | 1         | All sources unavailable (HTTP 429, 404, 5xx, timeouts)                      |
| FAILED      | 1         | Validation conflict, malformed payload, or non-empty source failure         |

## Scope Limitation

This routine ends at persisted normalized observations in `normalized_observations`. Evidence bundle assembly (INT-PUBLISH #13) is a separate concern.
