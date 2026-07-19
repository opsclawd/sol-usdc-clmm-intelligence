import { z } from "zod";
import { canonicalHash } from "../content-hash.js";
import { isValidIntegerString } from "./decimal.js";
import type {
  ExecutableQuotePayloadV1,
  PriceObservationWarning
} from "../../contracts/normalized-price-observation.js";

const SOL_USD_ASSETS = {
  baseMint: "So11111111111111111111111111111111111111112",
  quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  baseDecimals: 9,
  quoteDecimals: 6
} as const;

const JupiterQuoteRoutePlanSchema = z.object({
  swapMode: z.enum(["ExactIn", "ExactOut"]),
  wallets: z.array(
    z.object({
      publicKey: z.string(),
      source: z.string(),
      destination: z.string()
    })
  ),
  intermediateTokens: z.array(z.string()),
  percent: z.number()
});

const JupiterQuoteRouteSummarySchema = z.object({
  inAmount: z.string(),
  outAmount: z.string(),
  priceImpactPct: z.string(),
  marketInies: z.record(z.unknown()),
  amount: z.string(),
  swapMode: z.enum(["ExactIn", "ExactOut"]),
  slippageBps: z.number(),
  otherAmounts: z.array(
    z.object({
      idx: z.number(),
      amount: z.string()
    })
  ),
  splitNum: z.number(),
  remainingAccounts: z.array(
    z.object({
      pubkey: z.string(),
      isSigner: z.boolean(),
      isWritable: z.boolean()
    })
  ),
  jupiterQuoteVersion: z.string()
});

const JupiterQuoteSchema = z
  .object({
    inputMint: z.string(),
    inAmount: z
      .string()
      .refine(isValidIntegerString, { message: "inAmount must be a valid integer string" }),
    outputMint: z.string(),
    outAmount: z
      .string()
      .refine(isValidIntegerString, { message: "outAmount must be a valid integer string" }),
    otherAmounts: z.array(
      z.object({
        idx: z.number(),
        amount: z.string()
      })
    ),
    swapMode: z.enum(["ExactIn", "ExactOut"]),
    slippageBps: z.number(),
    priceImpactPct: z.string(),
    routePlan: z.array(JupiterQuoteRoutePlanSchema).min(1),
    contextSlot: z.number(),
    timeTaken: z.number(),
    platformFee: z
      .object({
        amount: z.string(),
        feeBps: z.number()
      })
      .nullable(),
    priceImpactPctList: z.array(z.string()),
    trustlessBootstrapMode: z.boolean(),
    directRoutes: z.array(z.unknown()),
    splitting: z.array(
      z.object({
        sourceAmount: z.string(),
        distributions: z.array(
          z.object({
            idx: z.number(),
            amount: z.string(),
            swapMode: z.enum(["ExactIn", "ExactOut"])
          })
        )
      })
    ),
    remainderAmount: z.string(),
    virtualTokenReserves: z.record(z.unknown()),
    lastUpdatedSlot: z.number(),
    requestId: z.string(),
    notEnoughLiquidity: z.boolean(),
    exceedsLiquidity: z.boolean(),
    highPriceImpact: z.boolean(),
    routeSummary: JupiterQuoteRouteSummarySchema,
    additionalTransferFeeAmount: z.string(),
    fees: z.object({
      totalFeeAndDevPercent: z.number(),
      devFee: z.object({
        amount: z.string(),
        mint: z.string()
      }),
      totalFees: z.object({
        amount: z.string(),
        uiAmount: z.string()
      })
    }),
    restrictIntermediateTokens: z.boolean(),
    bridgeUsed: z.boolean(),
    pubkey: z.string()
  })
  .passthrough();

export type JupiterQuote = z.infer<typeof JupiterQuoteSchema>;

export interface AcceptJupiterQuoteResult {
  quote: JupiterQuote;
}

export function acceptJupiterQuote(quote: unknown): AcceptJupiterQuoteResult {
  const parsed = JupiterQuoteSchema.safeParse(quote);
  if (!parsed.success) {
    throw new Error(`Invalid Jupiter quote: ${parsed.error.issues[0]?.message ?? "unknown error"}`);
  }

  if (parsed.data.inputMint !== SOL_USD_ASSETS.baseMint) {
    throw new Error(
      `Input mint mismatch: expected ${SOL_USD_ASSETS.baseMint}, got ${parsed.data.inputMint}`
    );
  }

  if (parsed.data.outputMint !== SOL_USD_ASSETS.quoteMint) {
    throw new Error(
      `Output mint mismatch: expected ${SOL_USD_ASSETS.quoteMint}, got ${parsed.data.outputMint}`
    );
  }

  if (parsed.data.swapMode !== "ExactIn") {
    throw new Error(`Swap mode mismatch: expected ExactIn, got ${parsed.data.swapMode}`);
  }

  if (parsed.data.inAmount !== "1000000000") {
    throw new Error(`Input amount mismatch: expected 1000000000, got ${parsed.data.inAmount}`);
  }

  if (typeof parsed.data.contextSlot !== "number" || !Number.isFinite(parsed.data.contextSlot)) {
    throw new Error("Context slot is required and must be a finite number");
  }

  if (parsed.data.routePlan.length === 0) {
    throw new Error("Route plan must contain at least one route");
  }

  const outAmountValue = BigInt(parsed.data.outAmount);
  if (outAmountValue <= BigInt(0)) {
    throw new Error("Output amount must be positive");
  }

  return {
    quote: parsed.data
  };
}

export interface JupiterSourceIdentityInput {
  readonly inputMint: string;
  readonly outputMint: string;
  readonly inAmount: string;
  readonly swapMode: "ExactIn" | "ExactOut";
  readonly contextSlot: number;
}

export async function deriveJupiterSourceObservationKey(
  input: JupiterSourceIdentityInput
): Promise<string> {
  const identityPayload = {
    identityVersion: 1,
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    inAmount: input.inAmount,
    swapMode: input.swapMode,
    contextSlot: input.contextSlot
  };
  return canonicalHash(identityPayload);
}

export interface NormalizeJupiterQuoteResult extends ExecutableQuotePayloadV1 {}

function parsePriceImpactToBasisPoints(priceImpactPct: string): string {
  const priceImpactDecimal = BigInt(priceImpactPct.replace(".", ""));
  const decimalIndex = priceImpactPct.indexOf(".");
  const decimalPlaces = decimalIndex >= 0 ? priceImpactPct.length - decimalIndex - 1 : 0;
  let bpsValue: bigint;
  if (decimalPlaces > 4) {
    bpsValue = priceImpactDecimal / 10n ** BigInt(decimalPlaces - 4);
  } else {
    const multiplier = 10n ** BigInt(Math.max(0, 4 - decimalPlaces));
    bpsValue = priceImpactDecimal * multiplier;
  }
  return String(bpsValue);
}

export function normalizeJupiterQuote(
  quote: unknown,
  fetchedAtUnixMs: number
): NormalizeJupiterQuoteResult {
  const { quote: acceptedQuote } = acceptJupiterQuote(quote);

  const outAmountAtomic = BigInt(acceptedQuote.outAmount);
  if (outAmountAtomic <= BigInt(0)) {
    throw new Error("Output amount must be positive");
  }

  const divisor = 10n ** BigInt(SOL_USD_ASSETS.quoteDecimals);
  const integerPart = outAmountAtomic / divisor;
  const fractionalPart = outAmountAtomic % divisor;
  const priceDecimal =
    String(integerPart) + "." + String(fractionalPart).padStart(SOL_USD_ASSETS.quoteDecimals, "0");

  const warnings: PriceObservationWarning[] = [];

  if (acceptedQuote.highPriceImpact) {
    warnings.push("price_impact_exceeds_threshold");
  }

  const priceImpactRatio = parsePriceImpactToBasisPoints(acceptedQuote.priceImpactPct);

  const hops = acceptedQuote.routePlan.flatMap((plan) =>
    plan.wallets.map((wallet) => ({
      pool: wallet.publicKey,
      inputMint: wallet.source === "SOL" ? SOL_USD_ASSETS.baseMint : wallet.source,
      outputMint: wallet.destination === "USDC" ? SOL_USD_ASSETS.quoteMint : wallet.destination,
      protocol: "jupiter"
    }))
  );

  const routeSummary =
    hops.length > 0
      ? {
          routeAvailable: true as const,
          hops
        }
      : {
          routeAvailable: false as const,
          failureReason: "no route available"
        };

  return {
    kind: "executable_quote",
    schemaVersion: 1,
    pair: "SOL/USDC",
    assets: SOL_USD_ASSETS,
    quoteData: {
      price: priceDecimal,
      slippageBps: acceptedQuote.slippageBps,
      thresholdBps: 50,
      exactProbe: acceptedQuote.swapMode.toLowerCase() as "exactIn" | "exactOut",
      receivedAtUnixMs: Date.now(),
      fetchedAtUnixMs
    },
    observedSource: {
      source: "jupiter-quote",
      observedAtUnixMs: Date.now(),
      slot: acceptedQuote.contextSlot
    },
    routeSummary,
    warnings,
    priceImpactRatio
  };
}
