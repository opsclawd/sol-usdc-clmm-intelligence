# Routine: Emergency Volatility Check

You are running the hourly lightweight volatility and range-breach check.

## Required reads

1. `AGENTS.md`
2. `policies/no-execution-boundary.md`
3. `policies/risk-rules.md`
4. Latest data snapshots if available.

## Deterministic data step

Run:

```bash
pnpm collect:backend || true
pnpm collect:price || true
pnpm review:range
```

## Task

Only escalate if one of these is true:

- Position is out of range.
- Price is within the configured edge danger zone.
- Volatility is critical.
- Data is stale enough that automation should pause.
- Backend reports degraded health.

## Output rule

If nothing requires attention, return `NO_REPLY`.

If escalation is required, return:

- Issue
- Current range state
- Recommended action
- Why human/backend validation is required
