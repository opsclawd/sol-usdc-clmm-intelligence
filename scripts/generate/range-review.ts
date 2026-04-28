import { readJsonFile, writeJsonFile } from '../lib/fs.js';
import {
  assessDataQuality,
  assessRangeStatus,
  type PoolSnapshot,
  type PositionSnapshot,
  type PriceSnapshot
} from '../lib/metrics.js';

async function main(): Promise<void> {
  const [price, pool, position] = await Promise.all([
    readJsonFile<PriceSnapshot>('data/latest-price-snapshot.json'),
    readJsonFile<PoolSnapshot>('data/latest-pool-snapshot.json'),
    readJsonFile<PositionSnapshot>('data/latest-position-snapshot.json')
  ]);

  const { quality, missing } = assessDataQuality({ price, pool, position });
  const range = assessRangeStatus(position);
  const recommendedAction = quality === 'stale' ? 'pause_rebalances' : range.recommendedAction;

  const shouldRebalance = ['tighten_range', 'widen_range', 'exit_range'].includes(recommendedAction) && quality !== 'stale';

  const output = {
    pair: 'SOL/USDC',
    timestamp: new Date().toISOString(),
    recommendedAction,
    shouldRebalance,
    confidence: quality === 'complete' ? (range.breachRisk === 'high' ? 'high' : 'medium') : 'low',
    riskLevel: quality === 'stale' ? 'critical' : range.riskLevel,
    dataQuality: quality,
    missingInputs: missing,
    currentRangeAssessment: {
      status: range.status,
      breachRisk: range.breachRisk,
      lowerPrice: position?.lowerPrice,
      upperPrice: position?.upperPrice,
      spotPrice: position?.spotPrice ?? pool?.spotPrice ?? price?.priceUsd,
      distanceToLowerPercent: position?.distanceToLowerPercent,
      distanceToUpperPercent: position?.distanceToUpperPercent,
      inRange: position?.inRange
    },
    recommendedRange: {
      type: shouldRebalance ? 'backend_must_calculate_exact_ticks' : 'unchanged',
      widthBias: recommendedAction === 'widen_range' || recommendedAction === 'pause_rebalances' ? 'wider' : 'unchanged'
    },
    reasoning: [
      quality === 'complete' ? 'Core inputs available.' : `Missing inputs: ${missing.join(', ') || 'unknown'}.`,
      `Range status is ${range.status}.`,
      `Breach risk is ${range.breachRisk}.`,
      shouldRebalance ? 'Backend validation is required before any transaction preparation.' : 'No deterministic rebalance trigger confirmed.'
    ],
    requiresHumanApproval: shouldRebalance,
    executionPermittedByAgent: false
  };

  await writeJsonFile('outputs/sol-usdc-rebalance-recommendation.json', output);
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
