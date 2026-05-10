import type {
  BreachRisk,
  FeeEnvironment,
  Posture,
  RangeBias,
  RebalanceSensitivity,
  RecommendedAction,
  RiskLevel
} from './types.js';

export interface PolicyInputs {
  recommendedAction: RecommendedAction;
  riskLevel: RiskLevel;
  feeEnvironment: FeeEnvironment;
  breachRisk: BreachRisk;
}

export function deriveRangeBias(inputs: PolicyInputs): RangeBias {
  const { recommendedAction, riskLevel, feeEnvironment, breachRisk } = inputs;
  if (recommendedAction === 'pause_rebalances') return 'passive';
  if (recommendedAction === 'widen_range' || riskLevel === 'elevated') return 'wide';
  if (feeEnvironment === 'strong' && breachRisk === 'low') return 'medium';
  if (feeEnvironment === 'weak') return 'wide';
  return 'medium';
}

export function derivePosture(
  inputs: Pick<PolicyInputs, 'recommendedAction' | 'riskLevel' | 'feeEnvironment'>
): Posture {
  const { recommendedAction, riskLevel, feeEnvironment } = inputs;
  if (recommendedAction === 'pause_rebalances') return 'paused';
  if (riskLevel === 'critical') return 'defensive';
  if (riskLevel === 'elevated') return 'defensive';
  if (feeEnvironment === 'strong') return 'moderately_aggressive';
  if (feeEnvironment === 'weak') return 'defensive';
  return 'neutral';
}

export function deriveRebalanceSensitivity(
  inputs: Pick<PolicyInputs, 'recommendedAction' | 'riskLevel'>
): RebalanceSensitivity {
  if (inputs.recommendedAction === 'pause_rebalances') return 'paused';
  if (inputs.riskLevel === 'elevated') return 'high';
  return 'normal';
}

export function deriveMaxCapitalDeploymentPercent(posture: Posture): number {
  return posture === 'defensive' || posture === 'paused' ? 50 : 70;
}