import { z } from "zod";

export type PerpVenue = "binance-fapi" | "drift-api";

export type PerpObservationKind =
  | "funding_rate"
  | "open_interest"
  | "perp_basis"
  | "liquidation_event"
  | "leverage_proxy";

export type PerpFeatureKind =
  | "oi_trend_4h"
  | "funding_rate_annualized"
  | "liquidation_cluster_1h"
  | "basis_spread_bps";

export interface PerpObservationBaseV1 {
  readonly schemaVersion: 1;
  readonly evidenceFamily: "perp_liquidation";
  readonly pair: "SOL/USDC";
  readonly venue: PerpVenue;
  readonly instrument: string;
  readonly sourceEventId: string;
  readonly observedAtUnixMs: number;
}

export interface FundingRatePayloadV1 extends PerpObservationBaseV1 {
  readonly kind: "funding_rate";
  readonly fundingRate: string;
  readonly fundingIntervalHours: number;
}

export interface OpenInterestPayloadV1 extends PerpObservationBaseV1 {
  readonly kind: "open_interest";
  readonly openInterestBase: string;
  readonly openInterestUsdc: string;
  readonly sampleWindowSeconds: number;
}

export interface PerpBasisPayloadV1 extends PerpObservationBaseV1 {
  readonly kind: "perp_basis";
  readonly perpPriceUsdc: string;
  readonly spotPriceUsdc: string;
}

export interface LiquidationEventPayloadV1 extends PerpObservationBaseV1 {
  readonly kind: "liquidation_event";
  readonly side: "long" | "short";
  readonly amountBase: string;
  readonly notionalUsdc: string;
}

export interface LeverageProxyPayloadV1 extends PerpObservationBaseV1 {
  readonly kind: "leverage_proxy";
  readonly longShortRatio: string;
  readonly methodology: "global_account_long_short_ratio" | "market_net_position_ratio";
}

export type PerpObservationPayloadV1 =
  | FundingRatePayloadV1
  | OpenInterestPayloadV1
  | PerpBasisPayloadV1
  | LiquidationEventPayloadV1
  | LeverageProxyPayloadV1;

export interface PerpCoverageRecordV1 {
  readonly kind: PerpObservationKind;
  readonly status: "available" | "unavailable" | "malformed";
  readonly diagnostic?: string;
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
});

const OpenInterestSchema = PerpBaseSchema.extend({
  kind: z.literal("open_interest"),
  openInterestBase: z
    .string()
    .refine(isPositiveDecimalString, { message: "Must be positive decimal string" }),
  openInterestUsdc: z
    .string()
    .refine(isPositiveDecimalString, { message: "Must be positive decimal string" }),
  sampleWindowSeconds: z.number().positive()
});

const PerpBasisSchema = PerpBaseSchema.extend({
  kind: z.literal("perp_basis"),
  perpPriceUsdc: z
    .string()
    .refine(isPositiveDecimalString, { message: "Must be positive decimal string" }),
  spotPriceUsdc: z
    .string()
    .refine(isPositiveDecimalString, { message: "Must be positive decimal string" })
});

const LiquidationEventSchema = PerpBaseSchema.extend({
  kind: z.literal("liquidation_event"),
  side: z.enum(["long", "short"]),
  amountBase: z
    .string()
    .refine(isPositiveDecimalString, { message: "Must be positive decimal string" }),
  notionalUsdc: z
    .string()
    .refine(isPositiveDecimalString, { message: "Must be positive decimal string" })
});

const LeverageProxySchema = PerpBaseSchema.extend({
  kind: z.literal("leverage_proxy"),
  longShortRatio: z
    .string()
    .refine(isPositiveDecimalString, { message: "Must be positive decimal string" }),
  methodology: z.enum(["global_account_long_short_ratio", "market_net_position_ratio"])
});

export const PerpObservationPayloadV1Schema = z.discriminatedUnion("kind", [
  FundingRateSchema,
  OpenInterestSchema,
  PerpBasisSchema,
  LiquidationEventSchema,
  LeverageProxySchema
]);

export const PerpCoverageRecordV1Schema = z
  .object({
    kind: z.enum([
      "funding_rate",
      "open_interest",
      "perp_basis",
      "liquidation_event",
      "leverage_proxy"
    ]),
    status: z.enum(["available", "unavailable", "malformed"]),
    diagnostic: z.string().optional()
  })
  .superRefine((data, ctx) => {
    if ((data.status === "unavailable" || data.status === "malformed") && !data.diagnostic) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Diagnostic required when status is ${data.status}`
      });
    }
  });

export function parsePerpObservationPayloadV1(val: unknown): PerpObservationPayloadV1 {
  return PerpObservationPayloadV1Schema.parse(val) as PerpObservationPayloadV1;
}

export function parsePerpCoverageRecordV1(val: unknown): PerpCoverageRecordV1 {
  return PerpCoverageRecordV1Schema.parse(val) as PerpCoverageRecordV1;
}
