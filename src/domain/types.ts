export type RecommendedAction =
  | "hold"
  | "watch"
  | "tighten_range"
  | "widen_range"
  | "exit_range"
  | "pause_rebalances";

export type Confidence = "low" | "medium" | "high";
export type RiskLevel = "normal" | "elevated" | "critical";
export type DataQuality = "complete" | "partial" | "stale";
export type Posture = "paused" | "defensive" | "neutral" | "moderately_aggressive";
export type RangeBias = "wide" | "medium" | "narrow" | "passive";
export type RebalanceSensitivity = "paused" | "high" | "normal";
export type RangeStatus =
  | "healthy"
  | "near_lower_edge"
  | "near_upper_edge"
  | "out_of_range"
  | "unknown";
export type BreachRisk = "low" | "medium" | "high" | "unknown";
export type FeeEnvironment = "strong" | "normal" | "weak" | "unknown";
