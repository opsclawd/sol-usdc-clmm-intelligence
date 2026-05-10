import type { DailyInsightDecision } from '../domain/daily-insight-decision.js';
import type { RangeReviewDecision } from '../domain/range-review-decision.js';
import type { WeeklyReviewDecision } from '../domain/weekly-review-decision.js';

export interface DailyInsight extends DailyInsightDecision { timestamp: string; }
export interface RangeReview extends RangeReviewDecision { timestamp: string; }
export interface WeeklyReview extends WeeklyReviewDecision { timestamp: string; }