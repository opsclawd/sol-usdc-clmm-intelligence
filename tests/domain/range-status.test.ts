import { describe, expect, it } from 'vitest';
import { assessRangeStatus } from '../../src/domain/range-status.js';
import type { PositionSnapshot } from '../../src/contracts/snapshots.js';

const base: PositionSnapshot = {
  pair: 'SOL/USDC',
  timestamp: '2026-05-10T12:00:00.000Z',
  source: 'test',
  inRange: true
};

describe('assessRangeStatus', () => {
  it('returns unknown / elevated / watch when position is undefined', () => {
    expect(assessRangeStatus(undefined)).toEqual({
      status: 'unknown',
      breachRisk: 'unknown',
      recommendedAction: 'watch',
      riskLevel: 'elevated'
    });
  });

  it('returns out_of_range / critical / exit_range when inRange is false', () => {
    expect(assessRangeStatus({ ...base, inRange: false })).toEqual({
      status: 'out_of_range',
      breachRisk: 'high',
      recommendedAction: 'exit_range',
      riskLevel: 'critical'
    });
  });

  it('returns near_lower_edge / widen_range / elevated when distanceToLowerPercent <= 3', () => {
    expect(
      assessRangeStatus({ ...base, distanceToLowerPercent: 3, distanceToUpperPercent: 50 })
    ).toEqual({
      status: 'near_lower_edge',
      breachRisk: 'high',
      recommendedAction: 'widen_range',
      riskLevel: 'elevated'
    });
  });

  it('returns near_upper_edge / widen_range / elevated when distanceToUpperPercent <= 3', () => {
    expect(
      assessRangeStatus({ ...base, distanceToLowerPercent: 50, distanceToUpperPercent: 2.5 })
    ).toEqual({
      status: 'near_upper_edge',
      breachRisk: 'high',
      recommendedAction: 'widen_range',
      riskLevel: 'elevated'
    });
  });

  it('returns near_lower_edge / watch / normal when 3 < lower <= 6', () => {
    expect(
      assessRangeStatus({ ...base, distanceToLowerPercent: 5, distanceToUpperPercent: 50 })
    ).toEqual({
      status: 'near_lower_edge',
      breachRisk: 'medium',
      recommendedAction: 'watch',
      riskLevel: 'normal'
    });
  });

  it('returns near_upper_edge / watch / normal when lower > 6 and upper <= 6', () => {
    expect(
      assessRangeStatus({ ...base, distanceToLowerPercent: 20, distanceToUpperPercent: 5 })
    ).toEqual({
      status: 'near_upper_edge',
      breachRisk: 'medium',
      recommendedAction: 'watch',
      riskLevel: 'normal'
    });
  });

  it('returns healthy / hold / normal when distances are comfortably wide', () => {
    expect(
      assessRangeStatus({ ...base, distanceToLowerPercent: 25, distanceToUpperPercent: 25 })
    ).toEqual({
      status: 'healthy',
      breachRisk: 'low',
      recommendedAction: 'hold',
      riskLevel: 'normal'
    });
  });
});