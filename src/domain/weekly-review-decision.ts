import type { PerformanceSnapshot } from '../contracts/snapshots.js';
import type { DataQuality } from './types.js';

export interface WeeklyReviewInputs {
  performance?: PerformanceSnapshot;
  dailyInsight?: Record<string, unknown>;
  rebalance?: Record<string, unknown>;
}

export interface WeeklyReviewDecision {
  pair: 'SOL/USDC';
  dataQuality: Exclude<DataQuality, 'complete'>;
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

export function makeWeeklyReviewDecision(
  inputs: WeeklyReviewInputs
): WeeklyReviewDecision {
  const { performance, dailyInsight, rebalance } = inputs;
  return {
    pair: 'SOL/USDC',
    dataQuality: performance ? 'partial' : 'stale',
    summary: performance
      ? 'Performance snapshot available. Agent should compare CLMM fees, range outcomes, and HODL benchmark.'
      : 'No backend performance snapshot available. Weekly review should be conservative and avoid policy changes.',
    inputs: {
      hasPerformanceSnapshot: Boolean(performance),
      hasDailyInsight: Boolean(dailyInsight),
      hasRebalanceRecommendation: Boolean(rebalance)
    },
    decisionQualityReview: {
      grade: 'ungraded',
      reason: 'Requires backend performance metrics and human review.'
    },
    proposedPolicyChanges: [],
    executionPermittedByAgent: false
  };
}