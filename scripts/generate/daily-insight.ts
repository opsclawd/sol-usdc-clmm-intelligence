import { readJsonFile, writeJsonFile } from '../lib/fs.js';
import {
  assessDataQuality,
  assessRangeStatus,
  classifyFeeEnvironment,
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
  const feeEnvironment = classifyFeeEnvironment(pool);

  const recommendedAction = quality === 'stale' ? 'pause_rebalances' : range.recommendedAction;
  const riskLevel = quality === 'stale' ? 'elevated' : range.riskLevel;

  const rangeBias =
    recommendedAction === 'pause_rebalances' ? 'passive' :
    recommendedAction === 'widen_range' || riskLevel === 'elevated' ? 'wide' :
    feeEnvironment === 'strong' && range.breachRisk === 'low' ? 'medium' :
    feeEnvironment === 'weak' ? 'wide' :
    'medium';

  const posture =
    recommendedAction === 'pause_rebalances' ? 'paused' :
    riskLevel === 'critical' ? 'defensive' :
    riskLevel === 'elevated' ? 'defensive' :
    feeEnvironment === 'strong' ? 'moderately_aggressive' :
    feeEnvironment === 'weak' ? 'defensive' :
    'neutral';

  const output = {
    pair: 'SOL/USDC',
    timestamp: new Date().toISOString(),
    marketRegime: `range_${range.status}_fee_${feeEnvironment}`,
    fundamentalRegime: 'unknown',
    recommendedAction,
    confidence: quality === 'complete' ? 'medium' : 'low',
    riskLevel,
    dataQuality: quality,
    missingInputs: missing,
    clmmPolicy: {
      posture,
      rangeBias,
      rebalanceSensitivity: recommendedAction === 'pause_rebalances' ? 'paused' : riskLevel === 'elevated' ? 'high' : 'normal',
      maxCapitalDeploymentPercent: posture === 'defensive' || posture === 'paused' ? 50 : 70
    },
    currentRangeAssessment: {
      status: range.status,
      breachRisk: range.breachRisk,
      distanceToLowerPercent: position?.distanceToLowerPercent,
      distanceToUpperPercent: position?.distanceToUpperPercent
    },
    feeEnvironment: {
      classification: feeEnvironment,
      feeApr: pool?.feeApr,
      feeAprTrend: pool?.feeAprTrend ?? 'unknown',
      volume24hUsd: pool?.volume24hUsd,
      volumeTrend: pool?.volumeTrend ?? 'unknown'
    },
    price: {
      spotPrice: pool?.spotPrice ?? position?.spotPrice ?? price?.priceUsd,
      jupiterPriceUsd: price?.priceUsd
    },
    reasoning: [
      quality === 'complete' ? 'Core price, pool, and position inputs are available.' : `Missing inputs: ${missing.join(', ') || 'unknown'}.`,
      `Range status is ${range.status} with ${range.breachRisk} breach risk.`,
      `Fee environment is ${feeEnvironment}.`,
      'Recommendation remains advisory only; backend and wallet control execution.'
    ],
    sources: [price?.source, pool?.source, position?.source].filter(Boolean),
    requiresHumanApproval: recommendedAction !== 'hold',
    executionPermittedByAgent: false
  };

  await writeJsonFile('outputs/sol-usdc-daily-insight.json', output);
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
