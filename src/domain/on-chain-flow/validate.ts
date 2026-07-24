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
const NO_LEADING_PLUS_REGEX = /^[a-zA-Z0-9_-]+$/;

function isValidDecimalString(value: string): boolean {
  if (value === "") return false;
  if (value.startsWith("+")) return false;
  if (!DECIMAL_STRING_REGEX.test(value)) return false;
  return true;
}

function isSafeInteger(value: number): boolean {
  return Number.isInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
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
  freshness: z.literal("realtime"),
  completeness: z.enum(["full", "partial"])
});

const sourceQualityBirdeyeSchema = z.object({
  provider: z.literal("birdeye-api"),
  freshness: z.literal("windowed"),
  completeness: z.enum(["full", "partial"])
});

const freshnessContextSchema = z.object({
  slot: z.number().int().nonnegative(),
  blockTimestampUnixMs: z.number().int().positive()
});

const heliusTransactionFlowSchema = z
  .object({
    eventKind: z.literal("helius_transaction"),
    transactionHash: z
      .string()
      .regex(NO_LEADING_PLUS_REGEX, "transactionHash must not have + prefix"),
    slot: z.number().int().nonnegative(),
    timestampUnixMs: z.number().int().positive(),
    flowSide: z.enum(["buy", "sell"]),
    nativeAmount: z.union([z.number().int().nonnegative(), z.string()]).refine(
      (val) => {
        if (typeof val === "number") {
          return isFiniteNonNegative(val) && isSafeInteger(val);
        }
        if (typeof val === "string") {
          return isValidDecimalString(val) && !val.includes(".");
        }
        return false;
      },
      {
        message:
          "nativeAmount must be a non-negative finite integer or decimal string without scientific notation"
      }
    ),
    sourceReferences: z.array(z.string().url()).min(1, "sourceReferences cannot be empty")
  })
  .strict();

const birdeyeNetFlowSchema = z
  .object({
    eventKind: z.literal("birdeye_net_flow"),
    timestampUnixMs: z.number().int().positive(),
    buyVolume: z.union([z.number().int().nonnegative(), z.string()]).refine(
      (val) => {
        if (typeof val === "number") return isFiniteNonNegative(val) && isSafeInteger(val);
        if (typeof val === "string") return isValidDecimalString(val);
        return false;
      },
      { message: "buyVolume must be a non-negative finite number or valid decimal string" }
    ),
    sellVolume: z.union([z.number().int().nonnegative(), z.string()]).refine(
      (val) => {
        if (typeof val === "number") return isFiniteNonNegative(val) && isSafeInteger(val);
        if (typeof val === "string") return isValidDecimalString(val);
        return false;
      },
      { message: "sellVolume must be a non-negative finite number or valid decimal string" }
    ),
    netFlow: z.union([z.number().int(), z.string()]).refine(
      (val) => {
        if (typeof val === "number") return Number.isFinite(val) && isSafeInteger(val);
        if (typeof val === "string") return isValidDecimalString(val);
        return false;
      },
      { message: "netFlow must be a finite number or valid decimal string" }
    ),
    sourceReferences: z.array(z.string().url()).min(1, "sourceReferences cannot be empty"),
    windowStartUnixMs: z.number().int().positive().optional(),
    windowEndUnixMs: z.number().int().positive().optional()
  })
  .strict()
  .refine(
    (data) => {
      if (data.windowStartUnixMs !== undefined && data.windowEndUnixMs !== undefined) {
        return data.windowEndUnixMs >= data.windowStartUnixMs;
      }
      return true;
    },
    { message: "windowEndUnixMs cannot be before windowStartUnixMs", path: ["windowEndUnixMs"] }
  );

const whaleTransferFlowSchema = z
  .object({
    eventKind: z.literal("whale_transfer"),
    sourceEventId: z.string().min(1),
    observedAtUnixMs: z.number().int().positive(),
    amountUsdc: z.string().refine(isValidDecimalString, {
      message: "amountUsdc must be a valid decimal string without scientific notation"
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

const whaleSwapFlowSchema = z
  .object({
    eventKind: z.literal("whale_swap"),
    sourceEventId: z.string().min(1),
    observedAtUnixMs: z.number().int().positive(),
    amountUsdc: z.string().refine(isValidDecimalString, {
      message: "amountUsdc must be a valid decimal string without scientific notation"
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
    stablecoinOperation: z.enum(["mint", "burn", "transfer"]),
    solDelta: z.number().int().optional(),
    usdcDelta: z.number().int().optional()
  })
  .strict();

const stablecoinFlowSchema = z
  .object({
    eventKind: z.literal("stablecoin_flow"),
    sourceEventId: z.string().min(1),
    observedAtUnixMs: z.number().int().positive(),
    amountUsdc: z.string().refine(isValidDecimalString, {
      message: "amountUsdc must be a valid decimal string without scientific notation"
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
    amountUsdc: z.string().refine(isValidDecimalString, {
      message: "amountUsdc must be a valid decimal string without scientific notation"
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
    amountUsdc: z.string().refine(isValidDecimalString, {
      message: "amountUsdc must be a valid decimal string"
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
  heliusTransactionFlowSchema,
  birdeyeNetFlowSchema,
  whaleTransferFlowSchema,
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
