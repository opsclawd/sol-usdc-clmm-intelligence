export class OrcaPoolValidationError extends Error {
  constructor(
    public readonly field: string,
    public override readonly message: string
  ) {
    super(`[${field}] ${message}`);
    this.name = "OrcaPoolValidationError";
  }
}

export function isValidDecimalString(val: unknown): boolean {
  if (typeof val !== "string") return false;
  if (!/^\d+(\.\d+)?$/.test(val)) return false;
  const num = parseFloat(val);
  return Number.isFinite(num) && num >= 0;
}

export interface OrcaPoolData {
  address: string;
  tokenA: {
    address: string;
  };
  tokenB: {
    address: string;
  };
  updatedAt: string;
  updatedSlot: number;
  tvlUsdc?: string | null;
  stats?: {
    "24h"?: {
      volume?: string | null;
      fees?: string | null;
    } | null;
  } | null;
  hasWarning?: boolean;
}

export interface OrcaPoolResponse {
  data: OrcaPoolData;
}

export interface AcceptOrcaPoolResponseResult {
  wrapper: OrcaPoolResponse;
  accepted: OrcaPoolData;
}

export function acceptOrcaPoolResponse(
  response: unknown,
  configuredPoolAddress: string,
  tokenAMint: string,
  tokenBMint: string
): AcceptOrcaPoolResponseResult {
  if (!response || typeof response !== "object" || !("data" in response)) {
    throw new OrcaPoolValidationError(
      "response",
      "Response must be an object containing a data object"
    );
  }

  const wrapper = response as OrcaPoolResponse;
  const data = wrapper.data;

  if (!data || typeof data !== "object") {
    throw new OrcaPoolValidationError("data", "Response.data must be an object");
  }

  if (data.address !== configuredPoolAddress) {
    throw new OrcaPoolValidationError(
      "address",
      `Pool address mismatch: expected ${configuredPoolAddress}, got ${data.address}`
    );
  }

  if (
    !data.tokenA ||
    typeof data.tokenA !== "object" ||
    !data.tokenA.address ||
    !data.tokenB ||
    typeof data.tokenB !== "object" ||
    !data.tokenB.address
  ) {
    throw new OrcaPoolValidationError(
      "tokens",
      "Pool must have tokenA and tokenB objects with addresses"
    );
  }

  const matchNormal = data.tokenA.address === tokenAMint && data.tokenB.address === tokenBMint;
  const matchReversed = data.tokenA.address === tokenBMint && data.tokenB.address === tokenAMint;
  if (!matchNormal && !matchReversed) {
    throw new OrcaPoolValidationError(
      "tokens",
      `Pool token mints mismatch: expected ${tokenAMint} and ${tokenBMint} in either order, got ${data.tokenA.address} and ${data.tokenB.address}`
    );
  }

  if (typeof data.updatedAt !== "string" || isNaN(Date.parse(data.updatedAt))) {
    throw new OrcaPoolValidationError("updatedAt", `Invalid ISO timestamp: ${data.updatedAt}`);
  }

  if (
    typeof data.updatedSlot !== "number" ||
    !Number.isSafeInteger(data.updatedSlot) ||
    data.updatedSlot < 0
  ) {
    throw new OrcaPoolValidationError(
      "updatedSlot",
      `Invalid safe-integer slot: ${data.updatedSlot}`
    );
  }

  if (data.tvlUsdc !== undefined && data.tvlUsdc !== null) {
    if (!isValidDecimalString(data.tvlUsdc)) {
      throw new OrcaPoolValidationError(
        "tvlUsdc",
        `tvlUsdc must match non-negative finite decimal string grammar: ${data.tvlUsdc}`
      );
    }
  }

  if (data.stats !== undefined && data.stats !== null) {
    if (typeof data.stats !== "object") {
      throw new OrcaPoolValidationError("stats", "stats must be an object");
    }
    const stats24h = data.stats["24h"];
    if (stats24h !== undefined && stats24h !== null) {
      if (typeof stats24h !== "object") {
        throw new OrcaPoolValidationError("stats.24h", "stats.24h must be an object");
      }
      if (stats24h.volume !== undefined && stats24h.volume !== null) {
        if (!isValidDecimalString(stats24h.volume)) {
          throw new OrcaPoolValidationError(
            "volume",
            `volume must match non-negative finite decimal string grammar: ${stats24h.volume}`
          );
        }
      }
      if (stats24h.fees !== undefined && stats24h.fees !== null) {
        if (!isValidDecimalString(stats24h.fees)) {
          throw new OrcaPoolValidationError(
            "fees",
            `fees must match non-negative finite decimal string grammar: ${stats24h.fees}`
          );
        }
      }
    }
  }

  return {
    wrapper,
    accepted: data
  };
}
