export function confidenceFractionToBps(compositeScore: number): number {
  return Math.max(0, Math.min(10_000, Math.round(compositeScore * 10_000)));
}

export function confidenceBpsToFraction(confidenceBps: number): number {
  return Math.max(0, Math.min(1, confidenceBps / 10_000));
}
