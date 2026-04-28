# Routine: Daily SOL/USDC Insight

You are running the daily SOL/USDC CLMM insight routine.

## Required reads

1. `AGENTS.md`
2. `policies/no-execution-boundary.md`
3. `policies/risk-rules.md`
4. `policies/rebalance-policy.md`
5. `policies/range-width-policy.md`
6. `resources/fundamental-metrics.md`
7. `memory/strategy.md`
8. `memory/rebalance-log.md`
9. `memory/lessons-learned.md`

## Deterministic data step

Run:

```bash
pnpm collect:backend || true
pnpm collect:price || true
pnpm insight:daily
```

If scripts fail, inspect the missing data and produce a conservative output manually.

## Analysis task

Generate `outputs/sol-usdc-daily-insight.json` matching `schemas/sol-usdc-daily-insight.schema.json`.

The insight must answer:

- What is the SOL/USDC market regime?
- Is the current CLMM posture aggressive, neutral, defensive, or paused?
- Should the autopilot prefer tight, medium, wide, or passive range policy?
- What changed since the previous daily insight?
- What should the backend monitor next?

## Hard rules

- Do not execute trades or rebalances.
- Do not invent missing APR, TVL, tick, volatility, or position data.
- If data is missing, recommend `hold` or `watch` with low confidence.
- Fundamentals may adjust posture but cannot directly trigger a rebalance.

## Memory updates

Update `memory/daily-insights.md` with a short append-only summary.
Update `memory/lessons-learned.md` only if there is a durable lesson.

## Final answer

Return a concise summary:

- Recommended action
- Confidence
- Risk level
- Data quality
- Main reason
- Output file path
