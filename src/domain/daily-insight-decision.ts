import type {
  PoolSnapshot,
  PositionSnapshot,
  PriceSnapshot
} from '../contracts/snapshots.js';
import type { RecommendedAction, Confidence, RiskLevel, DataQuality, Posture, RangeBias, RebalanceSensitivity, RangeStatus, BreachRisk, FeeEnvironment } from './types.js';
import { assessDataQuality } from './data-quality.js';
import { assessRangeStatus } from './range-status.js';
import { classifyFeeEnvironment } from './fee-classification.js';
import {
  derivePosture,
  deriveRangeBias,
  deriveRebalanceSensitivity,
  deriveMaxCapitalDeploymentPercent
} from './advisory-policy.js';

export interface DailyInsightInputs {
  price?: PriceSnapshot;
  pool?: PoolSnapshot;
  position?: PositionSnapshot;
}

export interface DailyInsightDecision {
  pair: 'SOL/USDC';
  marketRegime: string;
  fundamentalRegime: 'unknown';
  recommendedAction: RecommendedAction;
  confidence: Confidence;
  riskLevel: RiskLevel;
  dataQuality: DataQuality;
  missingInputs: string[];
  clmmPolicy: {
    posture: Posture;
    rangeBias: RangeBias;
    rebalanceSensitivity: RebalanceSensitivity;
    maxCapitalDeploymentPercent: number;
  };
  currentRangeAssessment: {
    status: RangeStatus;
    breachRisk: BreachRisk;
    distanceToLowerPercent?: number;
    distanceToUpperPercent?: number;
  };
  feeEnvironment: {
    classification: FeeEnvironment;
    feeApr?: number;
    feeAprTrend: 'rising' | 'flat' | 'falling' | 'unknown';
    volume24hUsd?: number;
    volumeTrend: 'rising' | 'flat' | 'falling' | 'unknown';
  };
  price: {
    spotPrice?: number;
    jupiterPriceUsd?: number;
  };
  reasoning: string[];
  sources: string[];
  requiresHumanApproval: boolean;
  executionPermittedByAgent: false;
}

export function makeDailyInsightDecision(
  inputs: DailyInsightInputs
): DailyInsightDecision {
  const { price, pool, position } = inputs;
  const { quality, missing } = assessDataQuality({ price, pool, position });
  const range = assessRangeStatus(position);
  const feeEnvironment = classifyFeeEnvironment(pool);

  const recommendedAction =
    quality === 'stale' ? 'pause_rebalances' : range.recommendedAction;
  const riskLevel = quality === 'stale' ? 'elevated' : range.riskLevel;

  const posture = derivePosture({ recommendedAction, riskLevel, feeEnvironment });
  const rangeBias = deriveRangeBias({
    recommendedAction,
    riskLevel,
    feeEnvironment,
    breachRisk: range.breachRisk
  });
  const rebalanceSensitivity = deriveRebalanceSensitivity({
    recommendedAction,
    riskLevel
  });
  const maxCapitalDeploymentPercent = deriveMaxCapitalDeploymentPercent(posture);

  return {
    pair: 'SOL/USDC',
    marketRegime: `range_${range.status}_fee_${feeEnvironment}`,
    fundamentalRegime: 'unknown',
    recommendedAction,
    confidence: quality === 'complete' ? 'medium' : 'low',
    riskLevel,
    dataQuality: quality,
    missingInputs: missing,
    clmmPolicy: {
      posture,
      rangeBias,
      rebalanceSensitivity,
      maxCapitalDeploymentPercent
    },
    currentRangeAssessment: {
      status: range.status,
      breachRisk: range.breachRisk,
      ...(position?.distanceToLowerPercent != null
        ? { distanceToLowerPercent: position.distanceToLowerPercent }
        : {}),
      ...(position?.distanceToUpperPercent != null
        ? { distanceToUpperPercent: position.distanceToUpperPercent }
        : {})
    },
    feeEnvironment: {
      classification: feeEnvironment,
      ...(pool?.feeApr != null ? { feeApr: pool.feeApr } : {}),
      feeAprTrend: pool?.feeAprTrend ?? 'unknown',
      ...(pool?.volume24hUsd != null ? { volume24hUsd: pool.volume24hUsd } : {}),
      volumeTrend: pool?.volumeTrend ?? 'unknown'
    },
    price: {
      ...(pool?.spotPrice != null
        ? { spotPrice: pool.spotPrice }
        : position?.spotPrice != null
        ? { spotPrice: position.spotPrice }
        : price?.priceUsd != null
        ? { spotPrice: price.priceUsd }
        : {}),
      ...(price?.priceUsd != null ? { jupiterPriceUsd: price.priceUsd } : {})
    },
    reasoning: [
      quality === 'complete'
        ? 'Core price, pool, and position inputs are available.'
        : `Missing inputs: ${missing.join(', ') || 'unknown'}.`,
      `Range status is ${range.status} with ${range.breachRisk} breach risk.`,
      `Fee environment is ${feeEnvironment}.`,
      'Recommendation remains advisory only; backend and wallet control execution.'
    ],
    sources: [price?.source, pool?.source, position?.source].filter(
      (value): value is string => Boolean(value)
    ),
    requiresHumanApproval: recommendedAction !== 'hold',
    executionPermittedByAgent: false
  };
}