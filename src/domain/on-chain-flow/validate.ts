import { z } from "zod";

export class OnChainFlowValidationError extends Error {
  constructor(
    public readonly field: string,
    public readonly message: string
  ) {
    super(`[${field}] ${message}`);
    this.name = "OnChainFlowValidationError";
  }
}

const DECIMAL_STRING_REGEX = /^-?[0-9]+(\.[0-9]+)?$/;

function isValidDecimalString(value: string): boolean {
  if (value === "") return false;
  if (value.startsWith("+")) return false;
  if (!DECIMAL_STRING_REGEX.test(value)) return false;
  return true;
}

function isValidNonNegativeDecimalString(value: string): boolean {
  if (value === "") return false;
  if (value.startsWith("+")) return false;
  if (!value.startsWith("-") && DECIMAL_STRING_REGEX.test(value)) return true;
  return false;
}

function isAttributionConfidence(value: unknown): boolean {
  return typeof value === "number" && value >= 0 && value <= 1 && Number.isFinite(value);
}

const addressContextSchema = z.object({
  addressType: z.enum(["wallet", "contract"]),
  address: z.string().min(1)
});

const sourceQualityHeliusSchema = z.object({
  provider: z.literal("helius-api"),
  freshness: z.enum(["realtime", "windowed"]),
  completeness: z.enum(["full", "partial"])
});

const sourceQualityBirdeyeSchema = z.object({
  provider: z.literal("birdeye-api"),
  freshness: z.literal("windowed"),
  completeness: z.enum(["full", "partial"])
});

const freshnessContextSchema = z.object({
  slot: z.number().int().nonnegative().optional(),
  blockTimestampUnixMs: z.number().int().positive()
});

const whaleSwapFlowSchema = z
  .object({
    eventKind: z.literal("whale_swap"),
    sourceEventId: z.string().min(1),
    observedAtUnixMs: z.number().int().positive(),
    amountUsdc: z.string().refine(isValidNonNegativeDecimalString, {
      message: "amountUsdc must be a non-negative decimal string without scientific notation"
    }),
    direction: z.enum(["inbound", "outbound"]),
    venue: z.literal("solana"),
    addressContext: addressContextSchema,
    sourceReferences: z.array(z.string().url()).min(1),
    sourceQuality: z.union([sourceQualityHeliusSchema, sourceQualityBirdeyeSchema]),
    freshnessContext: freshnessContextSchema,
    transactionSignature: z.string().min(1),
    eventIndex: z.number().int().nonnegative(),
    slot: z.number().int().nonnegative().optional(),
    stablecoinOperation: z.enum(["mint", "burn", "transfer"])
  })
  .strict();

const stablecoinFlowSchema = z
  .object({
    eventKind: z.literal("stablecoin_flow"),
    sourceEventId: z.string().min(1),
    observedAtUnixMs: z.number().int().positive(),
    amountUsdc: z.string().refine(isValidNonNegativeDecimalString, {
      message: "amountUsdc must be a non-negative decimal string without scientific notation"
    }),
    direction: z.enum(["inbound", "outbound"]),
    venue: z.literal("solana"),
    addressContext: addressContextSchema,
    sourceReferences: z.array(z.string().url()).min(1),
    sourceQuality: z.union([sourceQualityHeliusSchema, sourceQualityBirdeyeSchema]),
    freshnessContext: freshnessContextSchema,
    transactionSignature: z.string().min(1),
    eventIndex: z.number().int().nonnegative(),
    slot: z.number().int().nonnegative(),
    stablecoinOperation: z.enum(["mint", "burn", "transfer"])
  })
  .strict();

const dexNetFlowSchema = z
  .object({
    eventKind: z.literal("dex_net_flow"),
    sourceEventId: z.string().min(1),
    observedAtUnixMs: z.number().int().positive(),
    amountUsdc: z.string().refine(isValidNonNegativeDecimalString, {
      message: "amountUsdc must be a non-negative decimal string without scientific notation"
    }),
    direction: z.enum(["inbound", "outbound"]),
    venue: z.literal("solana"),
    addressContext: addressContextSchema,
    sourceReferences: z.array(z.string().url()).min(1),
    sourceQuality: z.union([sourceQualityHeliusSchema, sourceQualityBirdeyeSchema]),
    freshnessContext: freshnessContextSchema,
    windowStartUnixMs: z.number().int().positive(),
    windowEndUnixMs: z.number().int().positive(),
    buyVolumeUsdc: z.string().refine(isValidDecimalString, {
      message: "buyVolumeUsdc must be a valid decimal string"
    }),
    sellVolumeUsdc: z.string().refine(isValidDecimalString, {
      message: "sellVolumeUsdc must be a valid decimal string"
    }),
    netFlowUsdc: z.string().refine(isValidDecimalString, {
      message: "netFlowUsdc must be a valid decimal string"
    })
  })
  .strict()
  .refine((data) => data.windowEndUnixMs >= data.windowStartUnixMs, {
    message: "windowEndUnixMs cannot be before windowStartUnixMs",
    path: ["windowEndUnixMs"]
  });

const cexFlowProxySchema = z
  .object({
    eventKind: z.literal("cex_flow_proxy"),
    sourceEventId: z.string().min(1),
    observedAtUnixMs: z.number().int().positive(),
    amountUsdc: z.string().refine(isValidNonNegativeDecimalString, {
      message: "amountUsdc must be a non-negative decimal string"
    }),
    direction: z.enum(["inbound", "outbound"]),
    venue: z.literal("cex"),
    addressContext: addressContextSchema,
    sourceReferences: z.array(z.string().url()).min(1),
    sourceQuality: sourceQualityHeliusSchema,
    freshnessContext: freshnessContextSchema,
    quality: z.literal("proxy"),
    attributionConfidence: z.number().refine(isAttributionConfidence, {
      message: "attributionConfidence must be a number in [0, 1]"
    }),
    attributionProvider: z.literal("helius-api"),
    caveats: z.array(z.string())
  })
  .strict();

const onChainFlowSourceEventSchema = z.union([
  whaleSwapFlowSchema,
  stablecoinFlowSchema,
  dexNetFlowSchema,
  cexFlowProxySchema
]);

export type AcceptedOnChainFlowSourceEvent = z.infer<typeof onChainFlowSourceEventSchema>;

export function acceptOnChainFlowSourceEvent(input: unknown): AcceptedOnChainFlowSourceEvent {
  try {
    const result = onChainFlowSourceEventSchema.parse(input);
    return result;
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issue = err.issues[0];
      if (!issue) throw new OnChainFlowValidationError("unknown", "validation failed");
      throw new OnChainFlowValidationError(issue.path.join("."), issue.message);
    }
    throw err;
  }
}
