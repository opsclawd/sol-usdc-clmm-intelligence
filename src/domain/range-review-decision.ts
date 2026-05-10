import type {
  PoolSnapshot,
  PositionSnapshot,
  PriceSnapshot
} from '../contracts/snapshots.js';
import type { RangeReview } from '../contracts/outputs.js';
import { assessDataQuality } from './data-quality.js';
import { assessRangeStatus } from './range-status.js';

export interface RangeReviewInputs {
  price?: PriceSnapshot;
  pool?: PoolSnapshot;
  position?: PositionSnapshot;
}

export type RangeReviewDecision = Omit<RangeReview, 'timestamp'>;

const REBALANCE_ACTIONS = new Set(['tighten_range', 'widen_range', 'exit_range']);

export function makeRangeReviewDecision(
  inputs: RangeReviewInputs
): RangeReviewDecision {
  const { price, pool, position } = inputs;
  const { quality, missing } = assessDataQuality({ price, pool, position });
  const range = assessRangeStatus(position);
  const recommendedAction =
    quality === 'stale' ? 'pause_rebalances' : range.recommendedAction;

  const shouldRebalance =
    REBALANCE_ACTIONS.has(recommendedAction) && quality !== 'stale';

  const widthBias =
    recommendedAction === 'widen_range' || recommendedAction === 'pause_rebalances'
      ? 'wider'
      : 'unchanged';

  const spotPrice =
    position?.spotPrice ?? pool?.spotPrice ?? price?.priceUsd;

  return {
    pair: 'SOL/USDC',
    recommendedAction,
    shouldRebalance,
    confidence:
      quality === 'complete'
        ? range.breachRisk === 'high'
          ? 'high'
          : 'medium'
        : 'low',
    riskLevel: quality === 'stale' ? 'critical' : range.riskLevel,
    dataQuality: quality,
    missingInputs: missing,
    currentRangeAssessment: {
      status: range.status,
      breachRisk: range.breachRisk,
      ...(position?.lowerPrice != null ? { lowerPrice: position.lowerPrice } : {}),
      ...(position?.upperPrice != null ? { upperPrice: position.upperPrice } : {}),
      ...(spotPrice != null ? { spotPrice } : {}),
      ...(position?.distanceToLowerPercent != null
        ? { distanceToLowerPercent: position.distanceToLowerPercent }
        : {}),
      ...(position?.distanceToUpperPercent != null
        ? { distanceToUpperPercent: position.distanceToUpperPercent }
        : {}),
      ...(position?.inRange != null ? { inRange: position.inRange } : {})
    },
    recommendedRange: {
      type: shouldRebalance ? 'backend_must_calculate_exact_ticks' : 'unchanged',
      widthBias
    },
    reasoning: [
      quality === 'complete'
        ? 'Core inputs available.'
        : `Missing inputs: ${missing.join(', ') || 'unknown'}.`,
      `Range status is ${range.status}.`,
      `Breach risk is ${range.breachRisk}.`,
      shouldRebalance
        ? 'Backend validation is required before any transaction preparation.'
        : 'No deterministic rebalance trigger confirmed.'
    ],
    requiresHumanApproval: shouldRebalance,
    executionPermittedByAgent: false
  };
}