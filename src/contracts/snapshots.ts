export interface PriceSnapshot {
  pair: "SOL/USDC";
  timestamp: string;
  source: string;
  priceUsd: number;
  confidence?: "low" | "medium" | "high";
  raw?: unknown;
}
