import { describe, expect, it } from 'vitest';
import { generateRangeReview } from '../../src/application/generate-range-review.js';
import { FakeJsonStore, FakeClock } from '../fakes/index.js';

describe('generateRangeReview', () => {
  it('writes outputs/sol-usdc-rebalance-recommendation.json with timestamp and decision', async () => {
    const jsonStore = new FakeJsonStore();
    jsonStore.seed('data/latest-position-snapshot.json', {
      pair: 'SOL/USDC',
      timestamp: '2026-05-10T12:00:00.000Z',
      source: 'fastify',
      inRange: false,
      lowerPrice: 150,
      upperPrice: 200,
      spotPrice: 145
    });
    const clock = new FakeClock('2026-05-10T13:00:00.000Z');
    const result = await generateRangeReview({ jsonStore, clock });

    expect(jsonStore.writes[0]?.path).toBe('outputs/sol-usdc-rebalance-recommendation.json');
    expect(result.timestamp).toBe('2026-05-10T13:00:00.000Z');
    expect(result.recommendedAction).toBe('exit_range');
    expect(result.shouldRebalance).toBe(true);
  });

  it('emits pause_rebalances under stale data', async () => {
    const jsonStore = new FakeJsonStore();
    const clock = new FakeClock('2026-05-10T13:00:00.000Z');
    const result = await generateRangeReview({ jsonStore, clock });
    expect(result.recommendedAction).toBe('pause_rebalances');
    expect(result.shouldRebalance).toBe(false);
  });
});