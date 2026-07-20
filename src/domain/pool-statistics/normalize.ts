import type { OrcaPoolData } from "./orca.js";
import type {
  PoolStatisticsPayloadV1,
  PoolStatisticsWarning
} from "../../contracts/normalized-pool-statistics.js";

export interface NormalizeOrcaPoolStatisticsInput {
  accepted: OrcaPoolData;
  fetchedAtUnixMs: number;
}

export function normalizeOrcaPoolStatistics(
  input: NormalizeOrcaPoolStatisticsInput
): PoolStatisticsPayloadV1 {
  const { accepted } = input;

  const tvlUsdc = accepted.tvlUsdc ?? null;
  const volume24hUsdc = accepted.stats?.["24h"]?.volume ?? null;
  const fees24hUsdc = accepted.stats?.["24h"]?.fees ?? null;

  const warnings: PoolStatisticsWarning[] = [];

  if (tvlUsdc === null) {
    warnings.push("tvl_unavailable");
  }
  if (volume24hUsdc === null) {
    warnings.push("volume_24h_unavailable");
  }
  if (fees24hUsdc === null) {
    warnings.push("fees_24h_unavailable");
  }

  const providerWarning = accepted.hasWarning === true;
  if (providerWarning) {
    warnings.push("provider_warning");
  }

  // Sort warnings alphabetically
  warnings.sort();

  const presentCount =
    (tvlUsdc !== null ? 1 : 0) + (volume24hUsdc !== null ? 1 : 0) + (fees24hUsdc !== null ? 1 : 0);

  const completeness = presentCount === 3 ? "complete" : "partial";

  return {
    kind: "pool_statistics",
    schemaVersion: 1,
    pair: "SOL/USDC",
    poolId: accepted.address,
    observedAtUnixMs: Date.parse(accepted.updatedAt),
    observedSlot: accepted.updatedSlot,
    window: "24h",
    tvlUsdc,
    volume24hUsdc,
    fees24hUsdc,
    warnings,
    sourceQuality: {
      providerWarning,
      completeness
    }
  };
}
