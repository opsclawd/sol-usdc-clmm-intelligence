# Claude/OpenClaw Project Instructions

This repo controls an analysis pipeline for a SOL/USDC concentrated-liquidity autopilot.

The pipeline exists to create durable, structured insight. It is not a wallet, not a signer, and not an execution bot.

## Required behavior

- Prefer deterministic scripts for calculations.
- Use the LLM for interpretation, regime classification, narrative compression, and policy recommendation.
- Write machine-readable JSON before writing prose.
- Cite source names in outputs when data came from external resources.
- Do not hallucinate current price, APR, TVL, volume, tick, position, or fees.
- Mark missing data explicitly.
- Treat one-day moves as noisy unless confirmed by volatility/volume/liquidity data.

## Routine discipline

Each scheduled run must:

1. Read the relevant routine in `routines/`.
2. Read `policies/`.
3. Read relevant `memory/`.
4. Use `scripts/` or backend APIs for data.
5. Write `outputs/*.json`.
6. Update memory only if there is durable learning.

## Output discipline

Every recommendation must include:

- Recommended action: `hold`, `watch`, `tighten_range`, `widen_range`, `exit_range`, or `pause_rebalances`.
- Confidence: `low`, `medium`, or `high`.
- Risk level: `normal`, `elevated`, or `critical`.
- Data quality: `complete`, `partial`, or `stale`.
- Explicit reason not to act when no action is recommended.

## Execution boundary

The agent cannot execute transactions. The backend and wallet enforce execution.
