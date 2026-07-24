Collect SOL/USDC on-chain flow evidence by running `pnpm collect:on-chain-flow`.

This routine collects on-chain flow events from two allowed sources: Helius (transaction flows) and Birdeye (DEX net flows). It reports source outcomes (COMPLETE, PARTIAL, UNAVAILABLE, FAILED) and persists normalized observations to the database.

## Authority Boundaries

**This routine does NOT:**

- Make trading recommendations or express market direction
- Generate LLM research briefs (schema-constrained briefs are INT-BRIEFS #12)
- Synthesize policy (regime-engine owns final PolicyInsight)
- Execute transactions or manage positions

## Two-Source Allowlist

This routine only collects from two approved sources configured via environment variables:

- `HELIUS_API_URL`: Base URL for the Helius API provider.
- `HELIUS_API_KEY`: API key for the Helius provider.
- `BIRDEYE_API_URL`: Base URL for the Birdeye API provider.
- `BIRDEYE_API_KEY`: API key for the Birdeye provider.

## Flow Event Types

The routine collects five on-chain flow event kinds:

| Event Kind        | Source  | Description                         |
| ----------------- | ------- | ----------------------------------- |
| `whale_transfer`  | Helius  | Large SOL/USDC transfers            |
| `whale_swap`      | Helius  | Large DEX swaps                     |
| `stablecoin_flow` | Helius  | Stablecoin mint/burn/transfer flows |
| `dex_net_flow`    | Birdeye | DEX buy/sell volume imbalance       |
| `cex_flow_proxy`  | Helius  | Probabilistic CEX flow attribution  |

## Threshold Gating

Each event kind has a minimum USD value threshold configured via environment variables:

- `WHALE_TRANSFER_MIN_USDC`: Minimum transfer amount (default: 10000)
- `WHALE_SWAP_MIN_USDC`: Minimum swap amount (default: 10000)
- `STABLECOIN_FLOW_MIN_USDC`: Minimum stablecoin flow amount (default: 50000)
- `DEX_NET_FLOW_MIN_USDC`: Minimum DEX net flow amount (default: 10000)
- `CEX_FLOW_PROXY_MIN_USDC`: Minimum CEX proxy amount (default: 10000)
- `CEX_MIN_ATTRIBUTION_CONFIDENCE`: Minimum attribution confidence for CEX proxy (default: 0.5)

## Provenance and Freshness

- All flow events carry 15-minute freshness windows (`maxObservedAgeMs: 900000`)
- Clock skew tolerance is 5 seconds
- Stale behavior is `allow_context_only` — events may be used as contextual evidence but not core telemetry

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
