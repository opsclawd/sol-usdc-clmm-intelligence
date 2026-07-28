# Orca collector: public/pool endpoint returns 404, and response shape changed

## What's broken

The Orca leaf of `pnpm collect:core` fails with:

```
GET https://api.orca.so/v2/solana/public/pool?address=HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw&stats=24h failed: 404 Not Found
```

`ORCA_API_BASE=https://api.orca.so/v2/solana` is the current default in `.env.example`, and the adapter appends `/public/pool`, which is dead.

## Confirmed working replacement

```
curl 'https://api.orca.so/v2/solana/pools?address=HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw'
# -> 200, returns {"data": [{ address, whirlpoolsConfig, tickSpacing, feeRate, liquidity, sqrtPrice, tickCurrentIndex, tokenMintA, ... }]}
```

Two changes needed in the Orca adapter:

1. URL path: `/public/pool` → `/pools` (path segment change, and the `?stats=24h` query param may no longer be needed/supported — verify against the new response for whether volume/fee stats are still present or need a separate call).
2. Response shape: the new endpoint wraps the pool in a `{"data": [...]}` array rather than returning a single pool object directly — the parser needs to unwrap `data[0]` (matched by `address`) instead of parsing the top-level response as the pool.

## Where to look

The adapter reading `ORCA_API_BASE` and building the pool-stats request (likely `src/adapters/node/http-orca-*.ts`), plus whatever zod schema in `src/contracts/` or `src/domain/` currently expects the old single-object shape.

## Goal

Fix the Orca collector to use the current, live `api.orca.so/v2/solana/pools?address=...` endpoint and correctly unwrap its `{data: [...]}` array response, so `pnpm collect:core` succeeds against live Orca instead of failing with 404.

## Acceptance Criteria

- The Orca adapter requests the correct current path (`/pools?address=...` or documented equivalent) instead of the dead `/public/pool` path.
- The adapter correctly parses the `{"data": [pool]}` wrapper, matching the pool by `address`, instead of expecting a bare pool object.
- `pnpm collect:core` run against the real network returns an `orca` outcome with a success status, not `unavailable`/404.
- If 24h volume/fee stats are no longer present on this endpoint, the adapter degrades explicitly (documented warning) rather than silently fabricating values, per this repo's "never fabricate current price/APR/TVL/volume" rule.
- Existing unit tests for the Orca adapter/collector are updated to reflect the new URL/response shape and still pass.

## Open Questions

None.

## Update (2026-07-28): the earlier "confirmed working replacement" above is incomplete

A PR against this issue (#54, closed as insufficient) revealed the real root cause is deeper than an endpoint/param rename. Re-verified directly against the live API:

**The configured pool address is dead**, not just the endpoint path:

```bash
curl https://api.orca.so/v2/solana/pools/HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw
# -> HTTP 404, body: "Whirlpool not found"
```

Both `?address=<addr>` and `?addresses=<addr>` on the `/pools` list endpoint were red herrings in earlier testing — neither actually filters by address:

- `?address=<addr>` (singular) is silently ignored — it returns an arbitrary unfiltered default page of 50 pools that does **not** include the target address at all. (This is why the original 404-vs-200 test in this issue's first comment was misleading — a 200 status there doesn't mean the pool was found.)
- `?addresses=<addr>` (plural, what #54 used) returns `{"data": [], ...}` — empty, because the address genuinely doesn't exist in Orca's registry.

**The real canonical SOL/USDC pool**, found via Orca's documented search endpoint:

```bash
curl 'https://api.orca.so/v2/solana/pools/search?q=SOL-USDC&sortBy=tvl'
# -> Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE, tvlUsdc=25298071.68, feeRate=400 (4bps)
#    (~2 orders of magnitude above the next-largest SOL/USDC pool)
```

This is almost certainly a stale/deprecated address left over from before a pool migration — it's referenced as the default everywhere in this repo (`.env.example`'s `ORCA_SOL_USDC_WHIRLPOOL`/`WHIRLPOOL_ADDRESS`, README, docs, test fixtures).

**Also**: per Orca's docs (`docs.orca.so/api-reference/whirlpools`), the `/pools` endpoint's `stats` query param (e.g. `stats=24h`) is opt-in — volume/fee stats are **not** returned by default. Any fix must include `stats=24h` in the request or `volume24hUsdc`/`fees24hUsdc` will silently be absent from every collected pool record.

## Revised fix (supersedes the "Confirmed working replacement" section above)

1. Use `GET /pools?addresses=<addr>&stats=24h` (or the path-style `GET /pools/<addr>` single-pool lookup, if it also supports `stats`) and unwrap the `{data: [...]}` array — this part of #54's approach was correct and can be reused.
2. Update the default pool address wherever it's configured (`ORCA_SOL_USDC_WHIRLPOOL`, `WHIRLPOOL_ADDRESS` in `.env.example`, README, docs, and test fixtures) from `HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw` to `Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE`.
3. Include `stats=24h` in the request so volume/fee fields are actually populated.

## Open Questions

None.
