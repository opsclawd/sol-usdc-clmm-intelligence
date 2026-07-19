export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export interface JupiterQuoteRoutePlan {
  swapMode: "ExactIn" | "ExactOut";
  wallets: Array<{
    publicKey: string;
    source: string;
    destination: string;
  }>;
  intermediateTokens: string[];
  percent: number;
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
  marketInies: Record<string, unknown>;
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
  otherAmounts: Array<{
    idx: number;
    amount: string;
  }>;
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
  priceImpactPctList: string[];
  trustlessBootstrapMode: boolean;
  directRoutes: unknown[];
  splitting: Array<{
    sourceAmount: string;
    distributions: Array<{
      idx: number;
      amount: string;
      swapMode: "ExactIn" | "ExactOut";
    }>;
  }>;
  remainderAmount: string;
  virtualTokenReserves: Record<string, unknown>;
  lastUpdatedSlot: number;
  requestId: string;
  notEnoughLiquidity: boolean;
  exceedsLiquidity: boolean;
  highPriceImpact: boolean;
  routeSummary: JupiterQuoteRouteSummary;
  additionalTransferFeeAmount: string;
  fees: {
    totalFeeAndDevPercent: number;
    devFee: {
      amount: string;
      mint: string;
    };
    totalFees: {
      amount: string;
      uiAmount: string;
    };
  };
  restrictIntermediateTokens: boolean;
  bridgeUsed: boolean;
  pubkey: string;
}

export function makeJupiterQuote(overrides?: Partial<JupiterQuote>): JupiterQuote {
  return {
    inputMint: SOL_MINT,
    inAmount: "1000000000",
    outputMint: USDC_MINT,
    outAmount: "175000000",
    otherAmounts: [],
    swapMode: "ExactIn",
    slippageBps: 50,
    priceImpactPct: "0.015",
    routePlan: [
      {
        swapMode: "ExactIn",
        wallets: [
          {
            publicKey: SOL_MINT,
            source: "SOL",
            destination: "USDC"
          }
        ],
        intermediateTokens: [],
        percent: 100
      }
    ],
    contextSlot: 123456789,
    timeTaken: 42,
    platformFee: null,
    priceImpactPctList: ["0.015"],
    trustlessBootstrapMode: false,
    directRoutes: [],
    splitting: [],
    remainderAmount: "0",
    virtualTokenReserves: {},
    lastUpdatedSlot: 123456789,
    requestId: "req-123",
    notEnoughLiquidity: false,
    exceedsLiquidity: false,
    highPriceImpact: false,
    routeSummary: {
      inAmount: "1000000000",
      outAmount: "175000000",
      priceImpactPct: "0.015",
      marketInies: {},
      amount: "1000000000",
      swapMode: "ExactIn",
      slippageBps: 50,
      otherAmounts: [],
      splitNum: 1,
      remainingAccounts: [],
      jupiterQuoteVersion: "6.0"
    },
    additionalTransferFeeAmount: "0",
    fees: {
      totalFeeAndDevPercent: 0,
      devFee: {
        amount: "0",
        mint: SOL_MINT
      },
      totalFees: {
        amount: "0",
        uiAmount: "0"
      }
    },
    restrictIntermediateTokens: true,
    bridgeUsed: false,
    pubkey: "QuotePubkey123",
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
        swapMode: "ExactIn",
        wallets: [
          {
            publicKey: SOL_MINT,
            source: "SOL",
            destination: "mSOL"
          }
        ],
        intermediateTokens: [],
        percent: 100
      },
      {
        swapMode: "ExactIn",
        wallets: [
          {
            publicKey: "mSoLeMN5玉",
            source: "mSOL",
            destination: "USDC"
          }
        ],
        intermediateTokens: [],
        percent: 100
      }
    ],
    priceImpactPct: "0.03",
    highPriceImpact: false,
    routeSummary: {
      ...makeJupiterQuote().routeSummary,
      priceImpactPct: "0.03"
    }
  });
}

export function makeJupiterHighPriceImpactQuote(): JupiterQuote {
  return makeJupiterQuote({
    priceImpactPct: "1.5",
    highPriceImpact: true,
    routeSummary: {
      ...makeJupiterQuote().routeSummary,
      priceImpactPct: "1.5"
    }
  });
}
