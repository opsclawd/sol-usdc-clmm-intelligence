# Rebalance Policy

## Allowed recommendation actions

- `hold`: no action.
- `watch`: no action, but monitor a threshold.
- `tighten_range`: recommend a narrower range.
- `widen_range`: recommend a wider range.
- `exit_range`: recommend removing liquidity after validation.
- `pause_rebalances`: recommend disabling automated rebalances.

## Action rules

### hold

Use when:

- Position is in range.
- Distance to edges is acceptable.
- Fee environment is not deteriorating materially.
- Volatility is stable.

### watch

Use when:

- Price approaches edge but has not breached threshold.
- Volatility is rising but not critical.
- APR changed but data needs confirmation.

### tighten_range

Use only when:

- Volatility compresses.
- Price consolidates.
- Volume/fees are strong.
- Position math shows expected fees justify active risk.

### widen_range

Use when:

- Volatility expands.
- SOL trends strongly.
- Fee APR is not high enough to justify tight exposure.
- Price is likely to leave current range.

### exit_range

Use when:

- Position is materially out of range.
- Thesis is broken.
- Risk exceeds fee compensation.
- Execution backend validates exit conditions.

### pause_rebalances

Use when:

- Data is stale.
- Network risk is abnormal.
- API sources disagree materially.
- Backend health is degraded.
