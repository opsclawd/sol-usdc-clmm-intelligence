import type { PositionSnapshot } from '../contracts/snapshots.js';
import type {
  BreachRisk,
  RangeStatus,
  RecommendedAction,
  RiskLevel
} from '../contracts/outputs.js';

export interface RangeAssessment {
  status: RangeStatus;
  breachRisk: BreachRisk;
  recommendedAction: RecommendedAction;
  riskLevel: RiskLevel;
}

export function assessRangeStatus(position?: PositionSnapshot): RangeAssessment {
  if (!position) {
    return {
      status: 'unknown',
      breachRisk: 'unknown',
      recommendedAction: 'watch',
      riskLevel: 'elevated'
    };
  }

  if (!position.inRange) {
    return {
      status: 'out_of_range',
      breachRisk: 'high',
      recommendedAction: 'exit_range',
      riskLevel: 'critical'
    };
  }

  const lower = position.distanceToLowerPercent;
  const upper = position.distanceToUpperPercent;

  if (lower != null && lower <= 3) {
    return {
      status: 'near_lower_edge',
      breachRisk: 'high',
      recommendedAction: 'widen_range',
      riskLevel: 'elevated'
    };
  }

  if (upper != null && upper <= 3) {
    return {
      status: 'near_upper_edge',
      breachRisk: 'high',
      recommendedAction: 'widen_range',
      riskLevel: 'elevated'
    };
  }

  if ((lower != null && lower <= 6) || (upper != null && upper <= 6)) {
    return {
      status: lower != null && lower <= 6 ? 'near_lower_edge' : 'near_upper_edge',
      breachRisk: 'medium',
      recommendedAction: 'watch',
      riskLevel: 'normal'
    };
  }

  return {
    status: 'healthy',
    breachRisk: 'low',
    recommendedAction: 'hold',
    riskLevel: 'normal'
  };
}