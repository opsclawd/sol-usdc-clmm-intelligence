export interface NewsSourceRequest {
  readonly pair: "SOL/USDC";
  readonly source: "crypto-news-api" | "regulatory-monitor-api";
  readonly fromUnixMs: number;
  readonly toUnixMs: number;
}

export interface BoundedNewsSourceRecord {
  readonly id: string;
  readonly headline: string;
  readonly publishedAtUnixMs: number;
  readonly source: string;
  readonly url: string;
  readonly categories: readonly string[];
  readonly license: string;
  readonly reference: string;
  readonly compliance: {
    readonly isSponsored: boolean;
    readonly isAffiliate: boolean;
  };
}

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
