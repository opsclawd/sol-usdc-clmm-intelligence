# On-chain flow Phase 1: implement dex_net_flow + whale_swap from Birdeye pair-trades (real, verified, free-tier)

## Goal

Replace the fictional Birdeye/Helius adapter in `pnpm collect:on-chain-flow` with a real implementation covering exactly two of the five on-chain-flow event kinds — `dex_net_flow` and `whale_swap` — sourced entirely from Birdeye's pair-scoped trades endpoint, verified working against the actual deployed API key with no plan upgrade required. This supersedes the "curated watch-list vs. vendor" framing in #66 for these two kinds specifically: they need neither a watch-list nor a paid vendor, just a correct adapter.

Deliberately **not** in scope: `whale_transfer`, `stablecoin_flow`, `cex_flow_proxy` (Helius-sourced, require a wallet watch-list and/or paid-tier attribution — tracked separately, not blocking this).

## Verified against the live endpoint (2026-07-28, this deployment's actual Birdeye key)

```
GET https://public-api.birdeye.so/defi/txs/pair
    ?address=<orca-pool-address>
    &offset=0
    &limit=<n>
    &tx_type=swap
    &after_time=<unix-seconds>
    &before_time=<unix-seconds>
Headers: X-API-KEY: <key>, x-chain: solana
```

Confirmed real response for `Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE` (the current `ORCA_SOL_USDC_WHIRLPOOL`):

```json
{
  "data": {
    "items": [
      {
        "txHash": "3dtFPZCpAnafa4dz5gqDBK8FAmQuNV6pVwRyZCPXiDEaXLbwQRH7rByuyFWqAwVcTNm52QAs9FGVZcpAqgowu1qj",
        "source": "whirlpool",
        "blockUnixTime": 1785277855,
        "txType": "swap",
        "address": "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        "owner": "GoGoGo6N99mpyB7rfzhw2R4fXmaFctURXHaHMoGCyoLD",
        "from": { "symbol": "SOL", "decimals": 9, "address": "So111...112", "amount": 7990631926, "uiAmount": 7.990631926, "price": 73.809... },
        "to":   { "symbol": "USDC", "decimals": 6, "address": "EPjF...t1v", "amount": 589920174, "uiAmount": 589.920174, "price": 0.99977... }
      }
    ],
    "hasNext": true
  },
  "success": true
}
```

- `x-ratelimit-limit: 100` on this key — plenty for a 5-15 min cron poll.
- `after_time`/`before_time` (unix seconds) empirically filter correctly — verified a requested `[1785270000, 1785277000]` window returned only a trade with `blockUnixTime: 1785276979` inside it.
- **No `slot` field anywhere in the response.** This matters — see "Schema gap" below.
- `owner` is the actual trader wallet address — much better than the current adapter's bug of using the tx hash as the address.

## Classification logic

Direction is determined by which side of the swap is SOL vs USDC:

- `from.symbol === "SOL"`, `to.symbol === "USDC"` → trader sold SOL → **sell pressure** (SOL outbound from the pool's perspective... i.e. `direction: "outbound"` per the existing domain convention where inbound = SOL bought)
- `from.symbol === "USDC"`, `to.symbol === "SOL"` → trader bought SOL → **buy pressure** (`direction: "inbound"`)

USD-denominated volume for a trade = the USDC side's `uiAmount` (USDC ≈ $1, no conversion needed).

**`dex_net_flow`** (aggregated per polling window): sum USDC-side `uiAmount` into `buyVolumeUsdc` (SOL bought) and `sellVolumeUsdc` (SOL sold) buckets; `netFlowUsdc = buyVolumeUsdc - sellVolumeUsdc`. Maps directly to `DexNetFlowPayloadV1` / the domain's `dex_net_flow` eventKind (`src/domain/on-chain-flow/normalize.ts` already has a correct `normalizeDexNetFlow` implementation for this — it currently only gets fed by the broken `birdeye_net_flow`/`dex_net_flow` adapter path, so this is a source-side fix, not a domain-layer fix).

**`whale_swap`**: any individual trade where the USDC-side `uiAmount` >= `WHALE_SWAP_MIN_USDC` threshold (already defined: `whaleSwapMinUsdc` in `src/domain/on-chain-flow/threshold.ts`). Maps to the domain's `whale_swap` eventKind:

| Domain field                        | Source                                                                                                                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sourceEventId`                     | `txHash`                                                                                                                                                                         |
| `observedAtUnixMs`                  | `blockUnixTime * 1000`                                                                                                                                                           |
| `amountUsdc`                        | USDC-side `uiAmount`, as a decimal string                                                                                                                                        |
| `direction`                         | `"inbound"` if SOL bought, `"outbound"` if SOL sold                                                                                                                              |
| `venue`                             | `"solana"` (literal)                                                                                                                                                             |
| `addressContext`                    | `{ addressType: "wallet", address: owner }`                                                                                                                                      |
| `sourceReferences`                  | `[\`https://solscan.io/tx/${txHash}\`]` (schema requires real URLs — `z.string().url()`)                                                                                         |
| `sourceQuality`                     | `{ provider: "birdeye-api", freshness: "windowed", completeness: "full" }`                                                                                                       |
| `transactionSignature`              | `txHash`                                                                                                                                                                         |
| `stablecoinOperation`               | `"transfer"` (schema requires this enum even for swaps — see note below; a swap's underlying token movement is a transfer, not a mint/burn)                                      |
| `solDelta` / `usdcDelta` (optional) | derive from `from`/`to.changeAmount` if useful for the existing direction-inference logic in `normalize.ts` (`whale_swap` case already computes direction from these if present) |

## Schema gap to resolve as part of this work

`freshnessContextSchema` (`src/domain/on-chain-flow/validate.ts`) requires `slot: z.number().int().nonnegative()` and `blockTimestampUnixMs`, and `whaleSwapFlowSchema`/`dexNetFlowSchema` both require a top-level `slot` too. **Birdeye's pair-trades endpoint has no slot field at all.** Do not fabricate one (this repo has had multiple bugs this session from exactly that pattern — synthetic placeholder values silently persisted as if real). Two real options:

1. Make `slot` optional/nullable in the on-chain-flow contracts for Birdeye-sourced events specifically (Helius-sourced events, if implemented later, do have a real slot) — the freshness policy doesn't strictly need slot precision when `blockUnixTime`/`observedAtUnixMs` is already present and authoritative.
2. Look up the slot via a supplementary Solana RPC call per trade (extra latency, extra dependency, for a field with limited analytical value here).

**Recommended: option 1.** Also need a value for `eventIndex` (`whaleSwapFlowSchema` requires `z.number().int().nonnegative()`) — Birdeye's flat trade list has no intra-transaction instruction index; default to `0` is reasonable (each `txHash` corresponds to one swap event in this feed, not the general case of extracting from raw instruction logs).

## Acceptance Criteria

- `HttpBirdeyeFlowSource` (or a rewritten equivalent) calls the real `defi/txs/pair` endpoint for the configured pool, paginating via `offset` and bounding by `after_time`/`before_time` derived from the collector's lookback window.
- Produces real `whale_swap` events for trades at or above `WHALE_SWAP_MIN_USDC`, and one aggregated `dex_net_flow` event per polling window, both passing `src/domain/on-chain-flow/validate.ts`'s existing schemas.
- `freshnessContextSchema`/`whaleSwapFlowSchema`/`dexNetFlowSchema`'s `slot` requirement is resolved per the recommendation above (or an equivalent real fix) — not defaulted to a fake number.
- `BIRDEYE_FLOW_API_URL` (or a renamed equivalent) in `.env.example` points at the real base URL (`https://public-api.birdeye.so`), and the on-chain-flow cron routine doc (`cron/routines/on-chain-flow.md`) is updated to describe what's actually implemented (currently describes all 5 kinds as if live).
- Helius adapter is left disabled/unwired for now (or explicitly returns `unavailable` with a clear diagnostic) rather than hitting its current broken/fictional endpoint — `whale_transfer`/`stablecoin_flow`/`cex_flow_proxy` remain `UNAVAILABLE` until the Helius watch-list work (tracked separately) lands.
- Regression tests use a fixture captured from (or matching) the real response shape verified above — not hand-authored to match the code's assumptions, which is the root cause of nearly every bug found in this repo this session.
- Live-verified against the deployment target: `pnpm collect:on-chain-flow` produces real `dex_net_flow`/`whale_swap` evidence, `whale_transfer`/`stablecoin_flow`/`cex_flow_proxy` cleanly report `unavailable` rather than erroring.

## Open Questions

None.
