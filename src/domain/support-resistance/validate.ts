import { z } from "zod";
import type { SupportResistanceRawClaim } from "../../contracts/support-resistance.js";

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
  sourceExtract: z.string().optional()
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

function validateClaimLevel(claim: SupportResistanceRawClaim): void {
  const hasPoint = claim.levelUsdcPerSol !== undefined;
  const hasZone =
    claim.zoneLowerUsdcPerSol !== undefined || claim.zoneUpperUsdcPerSol !== undefined;

  if (hasPoint && hasZone) {
    throw new SupportResistanceValidationError(
      "claims",
      "cannot supply both point and zone fields in same claim"
    );
  }

  if (hasPoint) {
    const level = claim.levelUsdcPerSol;
    if (!Number.isFinite(level) || level <= 0) {
      throw new SupportResistanceValidationError(
        "claims",
        "point level must be a finite positive number"
      );
    }
  }

  if (hasZone) {
    const lower = claim.zoneLowerUsdcPerSol;
    const upper = claim.zoneUpperUsdcPerSol;

    if (lower === undefined || upper === undefined) {
      throw new SupportResistanceValidationError(
        "claims",
        "zone requires both lower and upper bounds"
      );
    }

    if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
      throw new SupportResistanceValidationError("claims", "zone bounds must be finite numbers");
    }

    if (lower <= 0 || upper <= 0) {
      throw new SupportResistanceValidationError("claims", "zone bounds must be positive");
    }

    if (lower >= upper) {
      throw new SupportResistanceValidationError(
        "claims",
        "zone lower bound must be less than upper bound"
      );
    }
  }

  if (!hasPoint && !hasZone) {
    throw new SupportResistanceValidationError(
      "claims",
      "claim must have either point or zone level"
    );
  }
}

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
  readonly levelUsdcPerSol?: number;
  readonly zoneLowerUsdcPerSol?: number;
  readonly zoneUpperUsdcPerSol?: number;
  readonly evidenceSide: "SUPPORT" | "RESISTANCE";
  readonly sourceExtract?: string;
}

function trimExtract(extract: string | undefined): string | undefined {
  if (extract === undefined) return undefined;
  if (extract.length <= MAX_EXTRACT_LENGTH) return extract;
  return extract.slice(0, MAX_EXTRACT_LENGTH);
}

export function acceptSupportResistanceSnapshot(input: unknown): BoundedSupportResistanceSnapshot {
  const parsed = supportResistanceRawSnapshotInputSchema.parse(input);

  const claims: BoundedSupportResistanceClaim[] = parsed.claims.map((claim) => {
    validateClaimLevel(claim);

    return {
      levelUsdcPerSol: claim.levelUsdcPerSol,
      zoneLowerUsdcPerSol: claim.zoneLowerUsdcPerSol,
      zoneUpperUsdcPerSol: claim.zoneUpperUsdcPerSol,
      evidenceSide: claim.evidenceSide ?? "RESISTANCE",
      sourceExtract: trimExtract(claim.sourceExtract)
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
