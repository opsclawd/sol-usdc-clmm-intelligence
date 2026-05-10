export type RecommendedAction =
  | 'hold'
  | 'watch'
  | 'tighten_range'
  | 'widen_range'
  | 'exit_range'
  | 'pause_rebalances';

export type Confidence = 'low' | 'medium' | 'high';
export type RiskLevel = 'normal' | 'elevated' | 'critical';
export type DataQuality = 'complete' | 'partial' | 'stale';
export type Posture =
  | 'paused'
  | 'defensive'
  | 'neutral'
  | 'moderately_aggressive';
export type RangeBias = 'wide' | 'medium' | 'narrow' | 'passive';
export type RebalanceSensitivity = 'paused' | 'high' | 'normal';
export type RangeStatus =
  | 'healthy'
  | 'near_lower_edge'
  | 'near_upper_edge'
  | 'out_of_range'
  | 'unknown';
export type BreachRisk = 'low' | 'medium' | 'high' | 'unknown';
export type FeeEnvironment = 'strong' | 'normal' | 'weak' | 'unknown';

export interface DailyInsight {
  pair: 'SOL/USDC';
  timestamp: string;
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

export interface RangeReview {
  pair: 'SOL/USDC';
  timestamp: string;
  recommendedAction: RecommendedAction;
  shouldRebalance: boolean;
  confidence: Confidence;
  riskLevel: RiskLevel;
  dataQuality: DataQuality;
  missingInputs: string[];
  currentRangeAssessment: {
    status: RangeStatus;
    breachRisk: BreachRisk;
    lowerPrice?: number;
    upperPrice?: number;
    spotPrice?: number;
    distanceToLowerPercent?: number;
    distanceToUpperPercent?: number;
    inRange?: boolean;
  };
  recommendedRange: {
    type: 'backend_must_calculate_exact_ticks' | 'unchanged';
    widthBias: 'wider' | 'unchanged';
  };
  reasoning: string[];
  requiresHumanApproval: boolean;
  executionPermittedByAgent: false;
}

export interface WeeklyReview {
  pair: 'SOL/USDC';
  timestamp: string;
  dataQuality: 'partial' | 'stale';
  summary: string;
  inputs: {
    hasPerformanceSnapshot: boolean;
    hasDailyInsight: boolean;
    hasRebalanceRecommendation: boolean;
  };
  decisionQualityReview: {
    grade: 'ungraded';
    reason: string;
  };
  proposedPolicyChanges: unknown[];
  executionPermittedByAgent: false;
}