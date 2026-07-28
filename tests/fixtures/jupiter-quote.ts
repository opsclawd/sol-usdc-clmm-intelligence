export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const MSOL_MINT = "mSoLzYCxHdDgdzmojag2KnE2dJ7RQfPpmZctD6Z2J6b";

export interface JupiterQuoteRoutePlan {
  swapMode?: "ExactIn" | "ExactOut";
  swapInfo: {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount?: string;
    outAmount?: string;
    updateContextSlot?: string | number;
  };
  intermediateTokens?: string[];
  percent: number;
  bps?: number | null;
}

export interface JupiterQuoteHop {
  pool: string;
  inputMint: string;
  outputMint: string;
  protocol: string;
  protocolVersion?: number;
  protocolName?: string;
}

export interface JupiterQuoteRouteSummary {
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  marketInfos: Record<string, unknown>;
  amount: string;
  swapMode: "ExactIn" | "ExactOut";
  slippageBps: number;
  otherAmounts: Array<{
    idx: number;
    amount: string;
  }>;
  splitNum: number;
  remainingAccounts: Array<{
    pubkey: string;
    isSigner: boolean;
    isWritable: boolean;
  }>;
  jupiterQuoteVersion: string;
}

export interface JupiterQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold?: string;
  swapMode: "ExactIn" | "ExactOut";
  slippageBps: number;
  priceImpactPct: string;
  routePlan: JupiterQuoteRoutePlan[];
  contextSlot: number;
  timeTaken: number;
  platformFee: {
    amount: string;
    feeBps: number;
  } | null;
  swapUsdValue?: string;
  mostReliableAmmsQuoteReport?: Record<string, unknown>;
  longtailMarketQuoteReport?: Record<string, unknown> | null;
  useIncurredSlippageForQuoting?: boolean | null;
  useRewards?: boolean | null;
  otherRoutePlans?: JupiterQuoteRoutePlan[] | null;
  loadedLongtailToken?: boolean;
  instructionVersion?: number | null;
  priceImpactPctList?: string[];
  trustlessBootstrapMode?: boolean;
  remainderAmount?: string;
  virtualTokenReserves?: Record<string, unknown>;
  lastUpdatedSlot?: number;
  requestId?: string;
  notEnoughLiquidity?: boolean;
  exceedsLiquidity?: boolean;
  highPriceImpact?: boolean;
  routeSummary?: JupiterQuoteRouteSummary;
  additionalTransferFeeAmount?: string;
  restrictIntermediateTokens?: boolean;
  bridgeUsed?: boolean;
  pubkey?: string;
}

export function makeJupiterQuote(overrides?: Partial<JupiterQuote>): JupiterQuote {
  return {
    inputMint: SOL_MINT,
    inAmount: "1000000000",
    outputMint: USDC_MINT,
    outAmount: "175000000",
    otherAmountThreshold: "173250000",
    swapMode: "ExactIn",
    slippageBps: 50,
    priceImpactPct: "0.004",
    routePlan: [
      {
        swapInfo: {
          ammKey: SOL_MINT,
          label: "SOL-USDC",
          inputMint: SOL_MINT,
          outputMint: USDC_MINT,
          inAmount: "1000000000",
          outAmount: "175000000"
        },
        percent: 100,
        bps: null
      }
    ],
    contextSlot: 123456789,
    timeTaken: 0.042,
    platformFee: null,
    swapUsdValue: "175.00",
    ...overrides
  };
}

export function makeJupiterQuoteWithExtraFields(): JupiterQuote & {
  extraField: string;
  nested: { data: number };
} {
  return {
    ...makeJupiterQuote(),
    extraField: "should be retained",
    nested: { data: 42 }
  };
}

export function makeJupiterMultiHopQuote(): JupiterQuote {
  return makeJupiterQuote({
    routePlan: [
      {
        swapInfo: {
          ammKey: SOL_MINT,
          label: "SOL-mSOL",
          inputMint: SOL_MINT,
          outputMint: MSOL_MINT,
          inAmount: "1000000000",
          outAmount: "23456789"
        },
        percent: 100,
        bps: null
      },
      {
        swapInfo: {
          ammKey: "mSoLeMN5玉",
          label: "mSOL-USDC",
          inputMint: MSOL_MINT,
          outputMint: USDC_MINT,
          inAmount: "23456789",
          outAmount: "173250000"
        },
        percent: 100,
        bps: null
      }
    ],
    priceImpactPct: "0.004"
  });
}

export function makeJupiterHighPriceImpactQuote(): JupiterQuote {
  return makeJupiterQuote({
    priceImpactPct: "1.5"
  });
}
