import { z } from "zod";

const MAX_EXTRACT_LENGTH = 500;

export class SupportResistanceValidationError extends Error {
  constructor(
    public readonly field: string,
    public readonly message: string
  ) {
    super(`[${field}] ${message}`);
    this.name = "SupportResistanceValidationError";
  }
}

const supportResistanceRawClaimSchema = z.object({
  levelUsdcPerSol: z.number().optional(),
  zoneLowerUsdcPerSol: z.number().optional(),
  zoneUpperUsdcPerSol: z.number().optional(),
  evidenceSide: z.enum(["SUPPORT", "RESISTANCE"]).optional(),
  sourceExtract: z.string().optional(),
  thesisCodes: z.array(z.string()).optional(),
  invalidationConditions: z.array(z.string()).optional(),
  expiresAtUnixMs: finiteInteger().optional()
});

function finiteInteger(): z.ZodType<number> {
  return z
    .number()
    .refine(Number.isFinite, {
      message: "must be a finite number"
    })
    .refine(Number.isInteger, {
      message: "must be an integer"
    });
}

function reliability(): z.ZodType<number> {
  return z.number().refine((val) => val >= 0 && val <= 1, {
    message: "must be in [0, 1]"
  });
}

const supportResistanceRawSnapshotInputSchema = z.object({
  providerId: z.string().min(1, "providerId is required"),
  providerRunId: z.string().min(1, "providerRunId is required"),
  pair: z.literal("SOL/USDC", {
    errorMap: () => ({ message: "pair must be SOL/USDC" })
  }),
  asOfUnixMs: finiteInteger(),
  sourceReferences: z.array(z.string().min(1, "source reference must be a non-empty string")),
  claims: z.array(supportResistanceRawClaimSchema),
  sourceReliability: reliability().optional()
});

export interface BoundedSupportResistanceSnapshot {
  readonly providerId: string;
  readonly providerRunId: string;
  readonly pair: "SOL/USDC";
  readonly asOfUnixMs: number;
  readonly sourceReferences: readonly string[];
  readonly claims: readonly BoundedSupportResistanceClaim[];
  readonly sourceReliability: number;
}

export interface BoundedSupportResistanceClaim {
  readonly levelUsdcPerSol?: number | undefined;
  readonly zoneLowerUsdcPerSol?: number | undefined;
  readonly zoneUpperUsdcPerSol?: number | undefined;
  readonly evidenceSide: "SUPPORT" | "RESISTANCE";
  readonly sourceExtract?: string | undefined;
  readonly thesisCodes?: readonly string[] | undefined;
  readonly invalidationConditions?: readonly string[] | undefined;
  readonly expiresAtUnixMs?: number | undefined;
}

function trimExtract(extract: string | undefined): string | undefined {
  if (extract === undefined) return undefined;
  if (extract.length <= MAX_EXTRACT_LENGTH) return extract;
  return extract.slice(0, MAX_EXTRACT_LENGTH);
}

export function acceptSupportResistanceSnapshot(input: unknown): BoundedSupportResistanceSnapshot {
  const parsed = supportResistanceRawSnapshotInputSchema.parse(input);

  const claims: BoundedSupportResistanceClaim[] = parsed.claims.map((claim) => {
    return {
      levelUsdcPerSol: claim.levelUsdcPerSol,
      zoneLowerUsdcPerSol: claim.zoneLowerUsdcPerSol,
      zoneUpperUsdcPerSol: claim.zoneUpperUsdcPerSol,
      evidenceSide: claim.evidenceSide ?? "RESISTANCE",
      sourceExtract: trimExtract(claim.sourceExtract),
      thesisCodes: claim.thesisCodes,
      invalidationConditions: claim.invalidationConditions,
      expiresAtUnixMs: claim.expiresAtUnixMs
    };
  });

  return {
    providerId: parsed.providerId,
    providerRunId: parsed.providerRunId,
    pair: parsed.pair,
    asOfUnixMs: parsed.asOfUnixMs,
    sourceReferences: [...parsed.sourceReferences],
    claims,
    sourceReliability: parsed.sourceReliability ?? 1.0
  };
}
