export type PriceObservationWarning =
  | "stale_observation"
  | "wide_confidence_interval"
  | "price_impact_exceeds_threshold"
  | "oracle_divergence_suspect"
  | "route_unavailable";

export interface OraclePricePayloadV1 {
  readonly kind: "oracle_price";
  readonly schemaVersion: 1;
  readonly pair: "SOL/USDC";
  readonly assets: {
    readonly baseMint: string;
    readonly quoteMint: string;
    readonly baseDecimals: number;
    readonly quoteDecimals: number;
  };
  readonly priceData: {
    readonly price: string;
    readonly confidence: string;
    readonly status: "trading" | "halted" | "auction";
    readonly ageMs: number;
  };
  readonly observedSource: {
    readonly source: "pyth-hermes" | "jupiter-quote";
    readonly observedAtUnixMs: number;
    readonly fetchedAtUnixMs: number;
    readonly slot: number;
  };
  readonly bounds: {
    readonly upperBound: string;
    readonly lowerBound: string;
  };
  readonly confidenceRatio: string;
  readonly warnings: readonly PriceObservationWarning[];
}

export interface ExecutableQuotePayloadV1 {
  readonly kind: "executable_quote";
  readonly schemaVersion: 1;
  readonly pair: "SOL/USDC";
  readonly assets: {
    readonly baseMint: string;
    readonly quoteMint: string;
    readonly baseDecimals: number;
    readonly quoteDecimals: number;
  };
  readonly quoteData: {
    readonly price: string;
    readonly slippageBps: number;
    readonly thresholdBps: number;
    readonly exactProbe: "exactIn" | "exactOut";
    readonly receivedAtUnixMs: number;
    readonly fetchedAtUnixMs: number;
  };
  readonly observedSource: {
    readonly source: "pyth-hermes" | "jupiter-quote";
    readonly observedAtUnixMs: number;
    readonly slot: number;
  };
  readonly routeSummary: {
    readonly routeAvailable: true;
    readonly hops: ReadonlyArray<{
      readonly pool: string;
      readonly inputMint: string;
      readonly outputMint: string;
      readonly protocol: string;
    }>;
  };
  readonly warnings: readonly PriceObservationWarning[];
  readonly priceImpactRatio: string;
}

export type PriceNormalizedCandidate = OraclePricePayloadV1 | ExecutableQuotePayloadV1;
