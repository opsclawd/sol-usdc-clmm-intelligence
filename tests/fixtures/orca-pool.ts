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
    };
  } | null;
  hasWarning?: boolean;
}

export interface OrcaPoolResponse {
  data: OrcaPoolData;
}

export const DEFAULT_WHIRLPOOL_ADDRESS = "HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw";
export const DEFAULT_SOL_MINT = "So11111111111111111111111111111111111111112";
export const DEFAULT_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export function makeOrcaPoolResponse(overrides: Partial<OrcaPoolData> = {}): OrcaPoolResponse {
  const statsOverride =
    overrides.stats === undefined
      ? {
          "24h": {
            volume: "1250000.50",
            fees: "3750.25"
          }
        }
      : overrides.stats;

  const data: OrcaPoolData = {
    address: DEFAULT_WHIRLPOOL_ADDRESS,
    tokenA: {
      address: DEFAULT_SOL_MINT
    },
    tokenB: {
      address: DEFAULT_USDC_MINT
    },
    updatedAt: "2026-07-19T06:00:00.000Z",
    updatedSlot: 1234567,
    tvlUsdc: "5000000.75",
    hasWarning: false,
    ...overrides
  };

  if (statsOverride !== undefined) {
    data.stats = statsOverride;
  }

  return { data };
}
