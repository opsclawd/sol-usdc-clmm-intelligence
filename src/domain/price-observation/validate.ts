import { z } from "zod";
import type {
  OraclePricePayloadV1,
  ExecutableQuotePayloadV1
} from "../../contracts/normalized-price-observation.js";

function finiteNumber(): z.ZodType<number> {
  return z.number().refine(Number.isFinite, {
    message: "must be a finite number"
  });
}

function positiveFiniteNumber(): z.ZodType<number> {
  return z.number().refine((n) => Number.isFinite(n) && n >= 0, {
    message: "must be a non-negative finite number"
  });
}

export const priceObservationWarningSchema = z.enum([
  "stale_observation",
  "wide_confidence_interval",
  "price_impact_exceeds_threshold",
  "oracle_divergence_suspect",
  "route_unavailable"
]);

const assetsSchema = z.object({
  baseMint: z.string(),
  quoteMint: z.string(),
  baseDecimals: z.number().int().nonnegative(),
  quoteDecimals: z.number().int().nonnegative()
});

const observedSourceOracleSchema = z.object({
  source: z.enum(["pyth-hermes", "jupiter-price", "jupiter-price-v3"]),
  observedAtUnixMs: finiteNumber(),
  fetchedAtUnixMs: finiteNumber(),
  slot: positiveFiniteNumber()
});

const observedSourceQuoteSchema = z.object({
  source: z.literal("jupiter-quote"),
  observedAtUnixMs: finiteNumber(),
  slot: positiveFiniteNumber()
});

const boundsSchema = z.object({
  upperBound: z.string(),
  lowerBound: z.string()
});

const priceDataSchema = z.object({
  price: z.string(),
  confidence: z.string(),
  status: z.enum(["trading", "halted", "auction"]),
  ageMs: finiteNumber()
});

const hopSchema = z.object({
  pool: z.string(),
  inputMint: z.string(),
  outputMint: z.string(),
  protocol: z.string()
});

const routeSummaryAvailableSchema = z.object({
  routeAvailable: z.literal(true),
  hops: z.array(hopSchema).min(1)
});

const routeSummaryUnavailableSchema = z.object({
  routeAvailable: z.literal(false),
  failureReason: z.string().optional()
});

const routeSummarySchema = z.union([routeSummaryAvailableSchema, routeSummaryUnavailableSchema]);

const quoteDataSchema = z.object({
  price: z.string().nullable(),
  slippageBps: finiteNumber(),
  thresholdBps: finiteNumber(),
  exactProbe: z.enum(["exactIn", "exactOut"]),
  receivedAtUnixMs: finiteNumber(),
  fetchedAtUnixMs: finiteNumber()
});

export const oraclePricePayloadV1Schema = z.object({
  kind: z.literal("oracle_price"),
  schemaVersion: z.literal(1),
  pair: z.literal("SOL/USDC"),
  assets: assetsSchema,
  priceData: priceDataSchema,
  observedSource: observedSourceOracleSchema,
  bounds: boundsSchema,
  confidenceRatio: z.string(),
  warnings: z.array(priceObservationWarningSchema)
});

export const executableQuotePayloadV1Schema = z.object({
  kind: z.literal("executable_quote"),
  schemaVersion: z.literal(1),
  pair: z.literal("SOL/USDC"),
  assets: assetsSchema,
  quoteData: quoteDataSchema,
  observedSource: observedSourceQuoteSchema,
  routeSummary: routeSummarySchema,
  warnings: z.array(priceObservationWarningSchema),
  priceImpactRatio: z.string()
});

export const priceNormalizedCandidateSchema = z.union([
  oraclePricePayloadV1Schema,
  executableQuotePayloadV1Schema
]);

export class PriceObservationValidationError extends Error {
  constructor(
    public readonly field: string,
    public readonly message: string
  ) {
    super(`[${field}] ${message}`);
    this.name = "PriceObservationValidationError";
  }
}

export function acceptOraclePricePayload(payload: unknown): OraclePricePayloadV1 {
  const result = oraclePricePayloadV1Schema.safeParse(payload);
  if (!result.success) {
    const issue = result.error.issues[0];
    if (!issue) throw new PriceObservationValidationError("unknown", "validation failed");
    throw new PriceObservationValidationError(issue.path.join("."), issue.message);
  }
  return result.data;
}

export function acceptExecutableQuotePayload(payload: unknown): ExecutableQuotePayloadV1 {
  const result = executableQuotePayloadV1Schema.safeParse(payload);
  if (!result.success) {
    const issue = result.error.issues[0];
    if (!issue) throw new PriceObservationValidationError("unknown", "validation failed");
    throw new PriceObservationValidationError(issue.path.join("."), issue.message);
  }
  return result.data as ExecutableQuotePayloadV1;
}

export function acceptPriceNormalizedCandidate(
  payload: unknown
): OraclePricePayloadV1 | ExecutableQuotePayloadV1 {
  const result = priceNormalizedCandidateSchema.safeParse(payload);
  if (!result.success) {
    const issue = result.error.issues[0];
    if (!issue) throw new PriceObservationValidationError("unknown", "validation failed");
    throw new PriceObservationValidationError(issue.path.join("."), issue.message);
  }
  return result.data as OraclePricePayloadV1 | ExecutableQuotePayloadV1;
}
