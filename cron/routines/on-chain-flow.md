Collect SOL/USDC on-chain flow evidence by running `pnpm collect:on-chain-flow`.

This routine collects on-chain flow events from Birdeye pair trades (Phase 1). Helius-derived kinds are documented as future work. It reports source outcomes (COMPLETE, PARTIAL, UNAVAILABLE, FAILED) and persists normalized observations to the database.

## Authority Boundaries

**This routine does NOT:**

- Make trading recommendations or express market direction
- Generate LLM research briefs (schema-constrained briefs are INT-BRIEFS #12)
- Synthesize policy (regime-engine owns final PolicyInsight)
- Execute transactions or manage positions

## Birdeye Phase 1 Configuration

Phase 1 uses Birdeye `/defi/txs/pair` for SOL/USDC pair trades:

- `BIRDEYE_FLOW_API_URL`: Base URL (`https://public-api.birdeye.so`)
- `BIRDEYE_API_KEY`: Birdeye API key
- `ORCA_SOL_USDC_WHIRLPOOL`: Orca whirlpool address (`Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE`)
- `ON_CHAIN_FLOW_LOOKBACK_MS`: Lookback window in milliseconds (`900000` = 15 minutes)

## Event Coverage Matrix

| Event kind        | Phase 1 status | Source                      |
| ----------------- | -------------- | --------------------------- |
| `whale_swap`      | Live           | Birdeye pair trades         |
| `dex_net_flow`    | Live           | Birdeye pair trades         |
| `whale_transfer`  | Unavailable    | Helius follow-up            |
| `stablecoin_flow` | Unavailable    | Helius follow-up            |
| `cex_flow_proxy`  | Unavailable    | Helius/watch-list follow-up |

## Threshold Gating

Live event kinds use minimum USD value thresholds:

- `ON_CHAIN_WHALE_SWAP_MIN_USDC`: Minimum swap amount (default: 1000000)
- `ON_CHAIN_DEX_NET_FLOW_MIN_USDC`: Minimum DEX net flow amount (default: 5000000)

## Source Health Semantics

A healthy Phase 1 run is normally `PARTIAL` because Birdeye provides usable evidence while the disabled Helius source reports unavailable. This is expected behavior, not a failure condition.

## Command Exit Statuses

| Status      | Exit Code | Meaning                                                         |
| ----------- | --------- | --------------------------------------------------------------- |
| COMPLETE    | 0         | All configured sources succeeded (or replayed identically)      |
| PARTIAL     | 0         | At least one source succeeded; others failed or degraded        |
| UNAVAILABLE | 1         | All sources unavailable (HTTP 429, 404, 5xx, timeouts)          |
| FAILED      | 1         | Validation conflict, malformed payload, or zero usable evidence |

## Missing Coverage Not Meaning No Risk

A source returning empty results or an unavailable source is a diagnostic outcome, not a "no flow" determination. Operators should investigate source outages rather than assume clean conditions.

## Scope Limitation

This routine ends at persisted normalized observations in `normalized_observations`. Evidence bundle assembly (INT-PUBLISH #13) is a separate concern.
