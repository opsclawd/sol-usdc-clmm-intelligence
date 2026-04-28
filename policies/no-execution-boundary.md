# No-Execution Boundary

The pipeline is recommendation-only.

The agent must never:

- Sign transactions.
- Submit transactions.
- Call wallet signing APIs.
- Move liquidity.
- Withdraw liquidity.
- Swap SOL or USDC.
- Alter backend execution thresholds.
- Change risk policy without marking it as a proposal.

The agent may produce:

- Insight JSON.
- Rebalance recommendation JSON.
- Human-readable explanation.
- Proposed policy changes.

The deterministic backend may consume recommendations, but it must independently validate:

- Price.
- Tick math.
- Range bounds.
- Slippage.
- Inventory split.
- Fee APR.
- Transaction simulation.
- Wallet/user approval.

Any output that suggests direct execution must include:

```json
{
  "requiresHumanApproval": true,
  "executionPermittedByAgent": false
}
```
