import type {
  FamilyCoverage,
  FamilyLiveness
} from "../../contracts/generated/evidence-bundle-v1.js";
import type { Source } from "../../contracts/taxonomy.js";
import { toCanonicalTimestamp } from "./timestamp.js";

export type BundleFamilyId = keyof FamilyCoverage;

export const FAMILY_IDS: readonly BundleFamilyId[] = [
  "deterministic",
  "supportResistance",
  "flows",
  "derivatives",
  "events",
  "newsRegulatory",
  "researchBrief"
];

export const FAMILY_SOURCES: Readonly<Record<BundleFamilyId, readonly Source[]>> = {
  deterministic: [
    "clmm-v2-bundle",
    "pyth-hermes",
    "jupiter-quote",
    "orca-public-api",
    "solana-rpc"
  ],
  supportResistance: ["technical-analysis-api"],
  flows: ["helius-api", "birdeye-api"],
  derivatives: ["binance-fapi", "drift-api"],
  events: ["macro-calendar-api", "solana-status-api"],
  newsRegulatory: ["crypto-news-api", "regulatory-monitor-api"],
  researchBrief: []
};

export function buildFamilyLiveness(
  configuredFamilies: ReadonlySet<BundleFamilyId>,
  latestReceivedAt: ReadonlyMap<Source, number>
): FamilyLiveness {
  return Object.fromEntries(
    FAMILY_IDS.map((family) => {
      const timestamps = FAMILY_SOURCES[family]
        .map((source) => latestReceivedAt.get(source))
        .filter((value): value is number => value !== undefined);
      const latest = timestamps.length === 0 ? null : Math.max(...timestamps);
      return [
        family,
        {
          isConfigured: configuredFamilies.has(family),
          lastCollectedAt: latest === null ? null : toCanonicalTimestamp(latest)
        }
      ];
    })
  ) as unknown as FamilyLiveness;
}
