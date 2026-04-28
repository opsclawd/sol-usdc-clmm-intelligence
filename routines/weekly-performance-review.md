# Routine: Weekly Performance Review

You are running the weekly SOL/USDC CLMM performance review.

## Required reads

1. `AGENTS.md`
2. All `policies/`
3. `memory/strategy.md`
4. `memory/rebalance-log.md`
5. `memory/daily-insights.md`
6. `memory/lessons-learned.md`
7. Latest backend performance snapshot if available.

## Deterministic data step

Run:

```bash
pnpm collect:backend || true
pnpm review:weekly
```

## Task

Generate `outputs/weekly-clmm-review.json`.

Assess:

- CLMM strategy vs SOL HODL.
- Fees earned vs estimated IL/range risk.
- Rebalance quality.
- Whether range policy was too tight, too wide, or appropriate.
- What should change next week.

## Rules

- Do not rewrite policies directly.
- Propose policy changes under a `proposedPolicyChanges` section.
- Do not overfit one week.
- Separate decision quality from outcome quality.

## Memory updates

Append a structured weekly summary to `memory/weekly-reviews.md`.
Update `memory/lessons-learned.md` only for durable lessons.
