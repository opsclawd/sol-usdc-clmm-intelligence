export function confidenceFractionToBps(compositeScore: number): number {
  return Math.max(0, Math.min(10_000, Math.round(compositeScore * 10_000)));
}
