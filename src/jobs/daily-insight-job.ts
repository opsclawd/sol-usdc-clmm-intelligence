import {
  generateDailyInsight,
  type GenerateDailyInsightDeps
} from '../application/generate-daily-insight.js';
import type { DailyInsight } from '../contracts/outputs.js';

export function dailyInsightJob(deps: GenerateDailyInsightDeps): () => Promise<DailyInsight> {
  return () => generateDailyInsight(deps);
}