import {
  generateWeeklyReview,
  type GenerateWeeklyReviewDeps
} from "../application/generate-weekly-review.js";
import type { WeeklyReview } from "../contracts/outputs.js";

export function weeklyReviewJob(deps: GenerateWeeklyReviewDeps): () => Promise<WeeklyReview> {
  return () => generateWeeklyReview(deps);
}
