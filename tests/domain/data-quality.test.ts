import { describe, expect, it } from 'vitest';
import { assessDataQuality } from '../../src/domain/data-quality.js';

describe('assessDataQuality', () => {
  it('returns complete with no missing when every input is defined', () => {
    expect(assessDataQuality({ a: 1, b: 'x', c: {} })).toEqual({
      quality: 'complete',
      missing: []
    });
  });

  it('returns partial with missing keys when 1 input is null', () => {
    expect(assessDataQuality({ a: 1, b: null })).toEqual({
      quality: 'partial',
      missing: ['b']
    });
  });

  it('returns partial when 2 inputs are missing', () => {
    expect(assessDataQuality({ a: undefined, b: null, c: 3 })).toEqual({
      quality: 'partial',
      missing: ['a', 'b']
    });
  });

  it('returns stale when 3 or more inputs are missing', () => {
    expect(
      assessDataQuality({ a: undefined, b: null, c: undefined })
    ).toEqual({
      quality: 'stale',
      missing: ['a', 'b', 'c']
    });
  });

  it('preserves key order from the input object in the missing array', () => {
    const result = assessDataQuality({ price: undefined, pool: null, position: 1 });
    expect(result.missing).toEqual(['price', 'pool']);
  });
});