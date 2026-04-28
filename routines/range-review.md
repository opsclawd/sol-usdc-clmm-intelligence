# Routine: Range Review

You are running the four-hour SOL/USDC CLMM range review.

## Required reads

1. `AGENTS.md`
2. `policies/no-execution-boundary.md`
3. `policies/risk-rules.md`
4. `policies/rebalance-policy.md`
5. `memory/rebalance-log.md`
6. Latest `outputs/sol-usdc-daily-insight.json` if available.

## Deterministic data step

Run:

```bash
pnpm collect:backend || true
pnpm collect:price || true
pnpm review:range
```

## Task

Generate `outputs/sol-usdc-rebalance-recommendation.json` matching `schemas/rebalance-recommendation.schema.json`.

Decide whether the position is:

- healthy
- near lower edge
- near upper edge
- out of range
- unsafe due to stale data

## Rules

- `shouldRebalance=true` is allowed only as a recommendation.
- Set `requiresHumanApproval=true` for any non-hold recommendation.
- Set `executionPermittedByAgent=false` always.
- If data is partial or stale, recommend `watch`, `hold`, or `pause_rebalances`.

## Memory updates

Append to `memory/rebalance-log.md` only if the recommendation changed or a meaningful threshold was reached.
