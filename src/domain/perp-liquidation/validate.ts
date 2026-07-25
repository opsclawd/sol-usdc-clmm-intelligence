import { z } from "zod";
import type { PerpObservationPayloadV1 } from "../../contracts/perp-liquidation.js";

export class PerpObservationValidationError extends Error {
  constructor(
    public readonly field: string,
    public readonly message: string
  ) {
    super(`[${field}] ${message}`);
    this.name = "PerpObservationValidationError";
  }
}

function isValidDecimalString(val: string): boolean {
  if (typeof val !== "string" || val.trim() === "") return false;
  const num = Number(val);
  return !Number.isNaN(num) && Number.isFinite(num);
}

function isPositiveDecimalString(val: string): boolean {
  if (!isValidDecimalString(val)) return false;
  return Number(val) > 0;
}

const PerpVenueSchema = z.enum(["binance-fapi", "drift-api"]);

const PerpBaseSchema = z.object({
  schemaVersion: z.literal(1),
  evidenceFamily: z.literal("perp_liquidation"),
  pair: z.literal("SOL/USDC"),
  venue: PerpVenueSchema,
  instrument: z.string().min(1),
  sourceEventId: z.string().min(1),
  observedAtUnixMs: z.number().int().nonnegative()
});

const FundingRateSchema = PerpBaseSchema.extend({
  kind: z.literal("funding_rate"),
  fundingRate: z.string().refine(isValidDecimalString, { message: "Invalid decimal string" }),
  fundingIntervalHours: z.number().positive()
}).strict();

const OpenInterestSchema = PerpBaseSchema.extend({
  kind: z.literal("open_interest"),
  openInterestBase: z
    .string()
    .refine(isPositiveDecimalString, { message: "Must be positive decimal string" }),
  openInterestUsdc: z
    .string()
    .refine(isPositiveDecimalString, { message: "Must be positive decimal string" }),
  sampleWindowSeconds: z.number().positive()
}).strict();

const PerpBasisSchema = PerpBaseSchema.extend({
  kind: z.literal("perp_basis"),
  perpPriceUsdc: z
    .string()
    .refine(isPositiveDecimalString, { message: "Must be positive decimal string" }),
  spotPriceUsdc: z
    .string()
    .refine(isPositiveDecimalString, { message: "Must be positive decimal string" })
}).strict();

const LiquidationEventSchema = PerpBaseSchema.extend({
  kind: z.literal("liquidation_event"),
  side: z.enum(["long", "short"]),
  amountBase: z
    .string()
    .refine(isPositiveDecimalString, { message: "Must be positive decimal string" }),
  notionalUsdc: z
    .string()
    .refine(isPositiveDecimalString, { message: "Must be positive decimal string" })
}).strict();

const LeverageProxySchema = PerpBaseSchema.extend({
  kind: z.literal("leverage_proxy"),
  longShortRatio: z
    .string()
    .refine(isPositiveDecimalString, { message: "Must be positive decimal string" }),
  methodology: z.enum(["global_account_long_short_ratio", "market_net_position_ratio"])
}).strict();

export const StrictPerpObservationPayloadV1Schema = z.discriminatedUnion("kind", [
  FundingRateSchema,
  OpenInterestSchema,
  PerpBasisSchema,
  LiquidationEventSchema,
  LeverageProxySchema
]);

export function validatePerpObservation(payload: unknown): PerpObservationPayloadV1 {
  const result = StrictPerpObservationPayloadV1Schema.safeParse(payload);
  if (!result.success) {
    const issue = result.error.issues[0];
    if (!issue) {
      throw new PerpObservationValidationError("unknown", "validation failed");
    }
    throw new PerpObservationValidationError(issue.path.join("."), issue.message);
  }
  return result.data as PerpObservationPayloadV1;
}
