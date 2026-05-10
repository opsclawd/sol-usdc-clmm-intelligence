import type { JsonStore } from '../ports/json-store.js';
import type { Clock } from '../ports/clock.js';
import type {
  PerformanceSnapshot
} from '../contracts/snapshots.js';
import type { WeeklyReview } from '../contracts/outputs.js';
import { makeWeeklyReviewDecision } from '../domain/weekly-review-decision.js';

export interface GenerateWeeklyReviewDeps {
  jsonStore: JsonStore;
  clock: Clock;
}

export const WEEKLY_REVIEW_OUTPUT_PATH = 'outputs/weekly-clmm-review.json';

export async function generateWeeklyReview(
  deps: GenerateWeeklyReviewDeps
): Promise<WeeklyReview> {
  const { jsonStore, clock } = deps;
  const [performance, dailyInsight, rebalance] = await Promise.all([
    jsonStore.readJson<PerformanceSnapshot>('data/latest-performance-snapshot.json'),
    jsonStore.readJson<Record<string, unknown>>('outputs/sol-usdc-daily-insight.json'),
    jsonStore.readJson<Record<string, unknown>>('outputs/sol-usdc-rebalance-recommendation.json')
  ]);

  const decision = makeWeeklyReviewDecision({
    ...(performance != null ? { performance } : {}),
    ...(dailyInsight != null ? { dailyInsight } : {}),
    ...(rebalance != null ? { rebalance } : {})
  });
  const output: WeeklyReview = { ...decision, timestamp: clock.now() };
  await jsonStore.writeJson(WEEKLY_REVIEW_OUTPUT_PATH, output);
  return output;
}