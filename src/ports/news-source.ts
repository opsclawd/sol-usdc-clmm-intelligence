export interface NewsSourceRequest {
  readonly pair: "SOL/USDC";
  readonly source: "crypto-news-api" | "regulatory-monitor-api";
  readonly fromUnixMs: number;
  readonly toUnixMs: number;
}

import type { BoundedNewsSourceRecord } from "../contracts/news-events.js";
export type { BoundedNewsSourceRecord };

export interface NewsSourceSnapshot {
  readonly source: NewsSourceRequest["source"];
  readonly providerId: string;
  readonly providerRunId: string;
  readonly retrievedAtUnixMs: number;
  readonly records: readonly BoundedNewsSourceRecord[];
}

export type NewsSourceError =
  | { readonly kind: "timeout"; readonly diagnostic: string }
  | { readonly kind: "network"; readonly diagnostic: string }
  | { readonly kind: "unavailable"; readonly diagnostic: string }
  | { readonly kind: "malformed"; readonly diagnostic: string };

export interface NewsSourcePort {
  collect(request: NewsSourceRequest): Promise<NewsSourceSnapshot>;
}
