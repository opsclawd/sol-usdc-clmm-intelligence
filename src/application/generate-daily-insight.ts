import type { JsonStore } from '../ports/json-store.js';
import type { Clock } from '../ports/clock.js';
import type {
  PoolSnapshot,
  PositionSnapshot,
  PriceSnapshot
} from '../contracts/snapshots.js';
import type { DailyInsight } from '../contracts/outputs.js';
import { makeDailyInsightDecision } from '../domain/daily-insight-decision.js';

export interface GenerateDailyInsightDeps {
  jsonStore: JsonStore;
  clock: Clock;
}

export const DAILY_INSIGHT_OUTPUT_PATH = 'outputs/sol-usdc-daily-insight.json';

export async function generateDailyInsight(
  deps: GenerateDailyInsightDeps
): Promise<DailyInsight> {
  const { jsonStore, clock } = deps;
  const [price, pool, position] = await Promise.all([
    jsonStore.readJson<PriceSnapshot>('data/latest-price-snapshot.json'),
    jsonStore.readJson<PoolSnapshot>('data/latest-pool-snapshot.json'),
    jsonStore.readJson<PositionSnapshot>('data/latest-position-snapshot.json')
  ]);

  const decision = makeDailyInsightDecision({
    ...(price != null ? { price } : {}),
    ...(pool != null ? { pool } : {}),
    ...(position != null ? { position } : {})
  });
  const output: DailyInsight = { ...decision, timestamp: clock.now() };
  await jsonStore.writeJson(DAILY_INSIGHT_OUTPUT_PATH, output);
  return output;
}