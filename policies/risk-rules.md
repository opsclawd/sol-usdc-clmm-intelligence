# SOL/USDC CLMM Risk Rules

## Scope

These rules apply to all SOL/USDC CLMM recommendations.

## Capital deployment

- Maintain a USDC reserve unless explicitly overridden by human operator.
- Do not recommend full capital deployment.
- Do not recommend increasing risk during stale or partial data conditions.

## Range behavior

- Prefer wider ranges during high volatility.
- Prefer medium ranges when fee APR is healthy and volatility is normal.
- Consider tighter ranges only during confirmed consolidation plus strong fee environment.
- Never recommend ultra-tight ranges based only on narrative or news.

## Rebalance behavior

Recommend rebalance only when at least one is true:

- Current price is close to range edge.
- Position is out of range.
- Fee APR no longer compensates for range risk.
- Volatility regime changed materially.
- Inventory split has become strategically undesirable.
- Deterministic backend threshold is already triggered.

## News/fundamentals

Fundamentals may influence posture. They are not direct execution triggers.

## Missing data

When critical data is missing:

- `recommendedAction = hold` or `watch`.
- `dataQuality = partial` or `stale`.
- Include missing fields.
