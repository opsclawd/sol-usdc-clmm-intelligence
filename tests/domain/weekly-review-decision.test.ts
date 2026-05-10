import { describe, expect, it } from 'vitest';
import { makeWeeklyReviewDecision } from '../../src/domain/weekly-review-decision.js';

describe('makeWeeklyReviewDecision', () => {
  it('returns partial-quality summary when performance snapshot exists', () => {
    const out = makeWeeklyReviewDecision({
      performance: { totalFeesUsd: 12 },
      dailyInsight: { recommendedAction: 'hold' }
    });
    expect(out.dataQuality).toBe('partial');
    expect(out.summary).toContain('Performance snapshot available');
    expect(out.inputs).toEqual({
      hasPerformanceSnapshot: true,
      hasDailyInsight: true,
      hasRebalanceRecommendation: false
    });
    expect(out.decisionQualityReview.grade).toBe('ungraded');
    expect(out.proposedPolicyChanges).toEqual([]);
    expect(out.executionPermittedByAgent).toBe(false);
  });

  it('returns stale-quality summary when performance snapshot is missing', () => {
    const out = makeWeeklyReviewDecision({});
    expect(out.dataQuality).toBe('stale');
    expect(out.summary).toContain('No backend performance snapshot');
    expect(out.inputs).toEqual({
      hasPerformanceSnapshot: false,
      hasDailyInsight: false,
      hasRebalanceRecommendation: false
    });
  });
});