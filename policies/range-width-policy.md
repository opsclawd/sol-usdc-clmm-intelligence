# Range Width Policy

Range widths are policy recommendations, not exact tick instructions.

## Baseline buckets

| Bucket | Width | Use case |
|---|---:|---|
| Tight | 5-8% | Low volatility, strong fee APR, confirmed consolidation |
| Medium | 10-18% | Normal active management |
| Wide | 20-35% | High volatility, directional trend, defensive posture |
| Passive | 40%+ | Unclear regime, low confidence, avoid churn |

## Bias rules

Increase width when:

- Realized volatility rises.
- Price accelerates toward range edge.
- Fee APR falls.
- Liquidity thins.
- Macro or network risk rises.

Decrease width when:

- Volatility compresses.
- Price consolidates.
- Fee APR rises.
- Volume is strong.
- Range breach risk is low.

## Hard principle

Fee capture must compensate for active range risk. If it does not, widen or hold.
