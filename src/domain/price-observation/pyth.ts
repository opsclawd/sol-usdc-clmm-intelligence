import { z } from "zod";
import { canonicalHash } from "../content-hash.js";
import {
  atomicToDecimalString,
  computeConfidenceBounds,
  computeConfidenceRatioBps,
  isValidIntegerString,
  isValidExponent,
  isValidTimestamp
} from "./decimal.js";
import type {
  OraclePricePayloadV1,
  PriceObservationWarning
} from "../../contracts/normalized-price-observation.js";

const SOL_USD_ASSETS = {
  baseMint: "So11111111111111111111111111111111111111112",
  quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  baseDecimals: 9,
  quoteDecimals: 6
} as const;

const PythHermesParsedPriceSchema = z.object({
  price: z
    .string()
    .refine(isValidIntegerString, { message: "price must be a valid integer string" }),
  confidence: z
    .string()
    .refine(isValidIntegerString, { message: "confidence must be a valid integer string" }),
  exponent: z.number().refine(isValidExponent, { message: "exponent must be a finite integer" }),
  status: z.enum(["trading", "halted", "auction", "unknown"]),
  timestamp: z
    .number()
    .refine(isValidTimestamp, { message: "timestamp must be a positive finite number" })
});

const PythHermesPriceUpdateSchema = z.object({
  id: z.string(),
  price: PythHermesParsedPriceSchema,
  slot: z.number().optional()
});

const PythHermesEnvelopeSchema = z
  .object({
    binary: z.string(),
    parsed: z.array(PythHermesPriceUpdateSchema).min(1)
  })
  .passthrough();

export type PythHermesEnvelope = z.infer<typeof PythHermesEnvelopeSchema>;
export type PythHermesPriceUpdate = z.infer<typeof PythHermesPriceUpdateSchema>;
export type PythHermesParsedPrice = z.infer<typeof PythHermesParsedPriceSchema>;

export interface AcceptPythEnvelopeResult {
  envelope: PythHermesEnvelope;
  priceUpdate: PythHermesPriceUpdate;
}

export function acceptPythEnvelope(
  envelope: unknown,
  configuredFeedId: string
): AcceptPythEnvelopeResult {
  const parsed = PythHermesEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    throw new Error(`Invalid Pyth envelope: ${parsed.error.issues[0]?.message ?? "unknown error"}`);
  }

  const priceUpdate = parsed.data.parsed[0];
  if (!priceUpdate) {
    throw new Error("No parsed price update found");
  }

  if (priceUpdate.id !== configuredFeedId) {
    throw new Error(`Feed mismatch: expected ${configuredFeedId}, got ${priceUpdate.id}`);
  }

  return {
    envelope: parsed.data,
    priceUpdate
  };
}

export interface PythSourceIdentityInput {
  readonly feedId: string;
  readonly publishTimeUnixSeconds: number;
}

export async function derivePythSourceObservationKey(
  input: PythSourceIdentityInput
): Promise<string> {
  const identityPayload = {
    identityVersion: 1,
    feedId: input.feedId,
    publishTimeUnixSeconds: input.publishTimeUnixSeconds
  };
  return canonicalHash(identityPayload);
}

export interface NormalizePythPriceResult extends OraclePricePayloadV1 {}

export function normalizePythPrice(
  envelope: PythHermesEnvelope,
  configuredFeedId: string
): NormalizePythPriceResult {
  const { priceUpdate } = acceptPythEnvelope(envelope, configuredFeedId);

  const priceAtomic = priceUpdate.price.price;
  const confidenceAtomic = priceUpdate.price.confidence;
  const exponent = priceUpdate.price.exponent;

  const priceValue = BigInt(priceAtomic);
  if (priceValue <= BigInt(0)) {
    throw new Error("Price must be positive");
  }

  const priceDecimal = atomicToDecimalString(priceAtomic, exponent);
  const confidenceDecimal = atomicToDecimalString(confidenceAtomic, exponent);
  const { lowerBound, upperBound } = computeConfidenceBounds(
    priceAtomic,
    confidenceAtomic,
    exponent
  );
  const confidenceRatio = computeConfidenceRatioBps(confidenceAtomic, priceAtomic);

  const warnings: PriceObservationWarning[] = [];

  const ratioBpsValue = (BigInt(confidenceAtomic) * BigInt(10000)) / BigInt(priceAtomic);
  if (ratioBpsValue > BigInt(100)) {
    warnings.push("oracle_confidence_wide");
  }

  const observedAtUnixMs = priceUpdate.price.timestamp * 1000;
  const fetchedAtUnixMs = Date.now();

  return {
    kind: "oracle_price",
    schemaVersion: 1,
    pair: "SOL/USDC",
    assets: SOL_USD_ASSETS,
    priceData: {
      price: priceDecimal,
      confidence: confidenceDecimal,
      status: priceUpdate.price.status === "unknown" ? "trading" : priceUpdate.price.status,
      ageMs: 0
    },
    observedSource: {
      source: "pyth-hermes",
      observedAtUnixMs,
      fetchedAtUnixMs,
      slot: priceUpdate.slot ?? 0
    },
    bounds: {
      upperBound,
      lowerBound
    },
    confidenceRatio,
    warnings
  };
}
