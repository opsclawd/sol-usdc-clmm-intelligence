import type { PoolSnapshot } from '../contracts/snapshots.js';
import type { FeeEnvironment } from './types.js';

export function classifyFeeEnvironment(pool?: PoolSnapshot): FeeEnvironment {
  if (!pool || pool.feeApr == null) return 'unknown';
  if (pool.feeApr >= 80) return 'strong';
  if (pool.feeApr >= 25) return 'normal';
  return 'weak';
}