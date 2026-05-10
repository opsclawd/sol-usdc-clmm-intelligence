import { describe, expect, it } from 'vitest';
import { generateWeeklyReview } from '../../src/application/generate-weekly-review.js';
import { FakeJsonStore, FakeClock } from '../fakes/index.js';

describe('generateWeeklyReview', () => {
  it('reads performance, daily insight, rebalance and writes outputs/weekly-clmm-review.json', async () => {
    const jsonStore = new FakeJsonStore();
    jsonStore.seed('data/latest-performance-snapshot.json', { totalFeesUsd: 12 });
    jsonStore.seed('outputs/sol-usdc-daily-insight.json', { recommendedAction: 'hold' });
    const clock = new FakeClock('2026-05-10T15:00:00.000Z');
    const result = await generateWeeklyReview({ jsonStore, clock });

    expect(jsonStore.writes[0]?.path).toBe('outputs/weekly-clmm-review.json');
    expect(result.timestamp).toBe('2026-05-10T15:00:00.000Z');
    expect(result.dataQuality).toBe('partial');
    expect(result.inputs).toEqual({
      hasPerformanceSnapshot: true,
      hasDailyInsight: true,
      hasRebalanceRecommendation: false
    });
  });

  it('falls back to stale quality when performance snapshot missing', async () => {
    const jsonStore = new FakeJsonStore();
    const clock = new FakeClock('2026-05-10T15:00:00.000Z');
    const result = await generateWeeklyReview({ jsonStore, clock });
    expect(result.dataQuality).toBe('stale');
  });
});