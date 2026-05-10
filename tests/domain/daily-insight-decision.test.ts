import { describe, expect, it } from 'vitest';
import { makeDailyInsightDecision } from '../../src/domain/daily-insight-decision.js';
import type {
  PoolSnapshot,
  PositionSnapshot,
  PriceSnapshot
} from '../../src/contracts/snapshots.js';

const price: PriceSnapshot = {
  pair: 'SOL/USDC',
  timestamp: '2026-05-10T12:00:00.000Z',
  source: 'jupiter-price-v3',
  priceUsd: 175.4,
  confidence: 'high'
};

const pool: PoolSnapshot = {
  pair: 'SOL/USDC',
  timestamp: '2026-05-10T12:00:00.000Z',
  source: 'fastify-clmm-backend',
  spotPrice: 175.5,
  feeApr: 95,
  volume24hUsd: 12_000_000,
  feeAprTrend: 'rising',
  volumeTrend: 'rising'
};

const position: PositionSnapshot = {
  pair: 'SOL/USDC',
  timestamp: '2026-05-10T12:00:00.000Z',
  source: 'fastify-clmm-backend',
  inRange: true,
  lowerPrice: 150,
  upperPrice: 200,
  spotPrice: 175.5,
  distanceToLowerPercent: 14.5,
  distanceToUpperPercent: 14.0
};

describe('makeDailyInsightDecision', () => {
  it('produces complete-quality hold decision when all snapshots are healthy and fees strong', () => {
    const out = makeDailyInsightDecision({ price, pool, position });

    expect(out.dataQuality).toBe('complete');
    expect(out.recommendedAction).toBe('hold');
    expect(out.riskLevel).toBe('normal');
    expect(out.confidence).toBe('medium');
    expect(out.marketRegime).toBe('range_healthy_fee_strong');
    expect(out.fundamentalRegime).toBe('unknown');
    expect(out.clmmPolicy).toEqual({
      posture: 'moderately_aggressive',
      rangeBias: 'medium',
      rebalanceSensitivity: 'normal',
      maxCapitalDeploymentPercent: 70
    });
    expect(out.feeEnvironment).toEqual({
      classification: 'strong',
      feeApr: 95,
      feeAprTrend: 'rising',
      volume24hUsd: 12_000_000,
      volumeTrend: 'rising'
    });
    expect(out.price).toEqual({
      spotPrice: 175.5,
      jupiterPriceUsd: 175.4
    });
    expect(out.requiresHumanApproval).toBe(false);
    expect(out.executionPermittedByAgent).toBe(false);
    expect(out.sources).toEqual(['jupiter-price-v3', 'fastify-clmm-backend', 'fastify-clmm-backend']);
    expect(out.missingInputs).toEqual([]);
  });

  it('overrides recommendedAction to pause_rebalances when data quality is stale', () => {
    const out = makeDailyInsightDecision({});
    expect(out.dataQuality).toBe('stale');
    expect(out.recommendedAction).toBe('pause_rebalances');
    expect(out.riskLevel).toBe('elevated');
    expect(out.confidence).toBe('low');
    expect(out.clmmPolicy.posture).toBe('paused');
    expect(out.clmmPolicy.rangeBias).toBe('passive');
    expect(out.clmmPolicy.rebalanceSensitivity).toBe('paused');
    expect(out.clmmPolicy.maxCapitalDeploymentPercent).toBe(50);
    expect(out.requiresHumanApproval).toBe(true);
    expect(out.missingInputs).toEqual(['price', 'pool', 'position']);
    expect(out.sources).toEqual([]);
  });

  it('keeps domain decision under partial quality when only price is missing', () => {
    const out = makeDailyInsightDecision({ pool, position });
    expect(out.dataQuality).toBe('partial');
    expect(out.recommendedAction).toBe('hold');
    expect(out.confidence).toBe('low');
    expect(out.missingInputs).toEqual(['price']);
  });

  it('flags requiresHumanApproval when recommendedAction is anything other than hold', () => {
    const outOfRange: PositionSnapshot = { ...position, inRange: false };
    const out = makeDailyInsightDecision({ price, pool, position: outOfRange });
    expect(out.recommendedAction).toBe('exit_range');
    expect(out.requiresHumanApproval).toBe(true);
  });
});