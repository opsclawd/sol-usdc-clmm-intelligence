import { readJsonFile, writeJsonFile } from '../lib/fs.js';

async function main(): Promise<void> {
  const performance = await readJsonFile<Record<string, unknown>>('data/latest-performance-snapshot.json');
  const dailyInsight = await readJsonFile<Record<string, unknown>>('outputs/sol-usdc-daily-insight.json');
  const rebalance = await readJsonFile<Record<string, unknown>>('outputs/sol-usdc-rebalance-recommendation.json');

  const output = {
    pair: 'SOL/USDC',
    timestamp: new Date().toISOString(),
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

  await writeJsonFile('outputs/weekly-clmm-review.json', output);
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
