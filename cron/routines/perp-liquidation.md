Collect SOL/USDC perp market and liquidation evidence by running `pnpm collect:perp-liquidation`.

This routine collects perp market data (funding rate, open interest, mark price) and liquidation events from two allowed sources: Binance (`binance-fapi`) and Drift (`drift-perp`). It reports source outcomes (COMPLETE, PARTIAL, UNAVAILABLE, FAILED), computes derived feature metrics, and persists raw observations, normalized observations, and derived features to the database.

## Authority Boundaries

**This routine does NOT:**

- Make policy decisions or derive trading plans (regime-engine owns deterministic market regime classification and PolicyInsight synthesis)
- Execute trades, sign or submit transactions, move liquidity, or adjust positions
- Treat liquidation clusters or funding spikes as direct execution triggers
- Retain unverified or un-auditable liquidation records

## Two-Source Allowlist

This routine collects only from two approved perpetual venue sources:

- `binance-fapi`: Binance Futures API (Public REST endpoints for SOLUSDT perpetual funding rate, open interest, and mark price). Note: Binance public REST force-orders API is account-bound (`USER_DATA`), so Binance provides perp market metrics only, not market-wide public liquidation history.
- `drift-perp`: Drift Protocol API (Solana on-chain perp DEX public REST/RPC endpoints for SOL-PERP funding rate, open interest, oracle price, and historical public liquidation events).

## Metric Coverage & Polling Windows

- **Polling Frequency:** 5-minute interval (`*/5 * * * *`)
- **Metric Coverage:**
  - `funding_rate`: Annualized funding rate (Binance 8-hour rate scaled to 1-year; Drift hourly rate scaled to 1-year)
  - `open_interest`: Open interest in base SOL units
  - `mark_price`: Mark/oracle price in quote units
  - `liquidation_event`: Aggregated liquidation notionals and side imbalance (Drift public liquidation stream)
- **Calculation Lookback Windows:**
  - Open interest delta: 4-hour window (`oi_delta_4h_bps`)
  - Liquidation aggregate: 1-hour window (`liquidation_notional_1h_usd`, `liquidation_side_imbalance_1h`)

## Binance Liquidation Limitation

Binance public REST does not provide market-wide public force orders/liquidations without account authentication (`USER_DATA` permission). Consequently:

- `binance-fapi` metrics are limited to perp market state (funding, OI, mark price).
- `drift-perp` is required for public SOL-PERP liquidation history coverage.
- If Binance quote asset is `USDT` (`SOLUSDT`), configuration must specify `SOLUSDT` while canonical normalization maps quote asset metadata appropriately.

## Freshness Caps and Confidence Degradation

- **Freshness Caps:**
  - Funding rate, OI, Mark price: 15 minutes (`maxObservedAgeMs: 900000`)
  - Liquidation events: 60 minutes (`maxObservedAgeMs: 3600000`)
- **Confidence Degradation:**
  - Stale observations (> max observed age) decay confidence by 50% and receive `stale_observation` penalty reasons.
  - Partial source coverage (e.g. one source unavailable) marks confidence status as `degraded`.
  - Stale or degraded data prevents evidence from being treated as fully available telemetry.

## Command Exit Statuses

| Status      | Exit Code | Meaning                                                         |
| ----------- | --------- | --------------------------------------------------------------- |
| COMPLETE    | 0         | All configured sources succeeded (or replayed identically)      |
| PARTIAL     | 0         | At least one source succeeded; others failed or degraded        |
| UNAVAILABLE | 1         | All sources unavailable (HTTP 429, 404, 5xx, timeouts)          |
| FAILED      | 1         | Validation conflict, malformed payload, or zero usable evidence |

## Unavailable Coverage Not Evidence of No Risk

An unavailable source, failed metric endpoint, or missing liquidation stream is a diagnostic degradation state, NOT evidence of zero liquidation risk or neutral funding. Operators must investigate endpoint outages rather than assuming market stability when data is unavailable.

## Scope Limitation

This routine ends at persisted observations and derived features in the `intelligence` DB schema. Final evidence bundle publication to `regime-engine` (INT-PUBLISH #13) and research brief generation (INT-BRIEFS #12) are separate concerns.
