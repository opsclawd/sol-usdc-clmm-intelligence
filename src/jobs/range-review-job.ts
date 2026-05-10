import {
  generateRangeReview,
  type GenerateRangeReviewDeps
} from '../application/generate-range-review.js';
import type { RangeReview } from '../contracts/outputs.js';

export function rangeReviewJob(deps: GenerateRangeReviewDeps): () => Promise<RangeReview> {
  return () => generateRangeReview(deps);
}