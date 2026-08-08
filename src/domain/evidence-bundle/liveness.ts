import type {
  BundleAssessment,
  FamilyCoverage
} from "../../contracts/generated/evidence-bundle-v1.js";
import type { Source } from "../../contracts/taxonomy.js";
import { toCanonicalTimestamp } from "./timestamp.js";

/**
 * The canonical contract inlines the liveness map on `BundleAssessment` and
 * does not name it, so derive the alias rather than restating its shape — that
 * keeps it in step when the vendored schema is re-synced from regime-engine.
 */
export type FamilyLiveness = NonNullable<BundleAssessment["liveness"]>;

export type BundleFamilyId = keyof FamilyCoverage | keyof FamilyLiveness;

export const DETERMINISTIC_SUBFAMILY_IDS = [
  "market_state",
  "price_quality",
  "clmm_economics",
  "position_state",
  "liquidity",
  "risk"
] as const satisfies readonly BundleFamilyId[];

export const FAMILY_IDS: readonly BundleFamilyId[] = [
  "deterministic",
  ...DETERMINISTIC_SUBFAMILY_IDS,
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
  market_state: ["pyth-hermes", "jupiter-quote"],
  price_quality: ["pyth-hermes", "jupiter-quote"],
  clmm_economics: ["clmm-v2-bundle", "solana-rpc"],
  position_state: ["clmm-v2-bundle"],
  liquidity: ["clmm-v2-bundle", "orca-public-api"],
  risk: ["binance-fapi", "drift-api"],
  supportResistance: ["technical-analysis-api"],
  flows: ["helius-api", "birdeye-api"],
  derivatives: ["binance-fapi", "drift-api"],
  events: ["macro-calendar-api", "solana-status-api"],
  newsRegulatory: ["crypto-news-api", "regulatory-monitor-api"],
  researchBrief: []
};

const deterministicSubfamilies = new Set<BundleFamilyId>(DETERMINISTIC_SUBFAMILY_IDS);

function isFamilyConfigured(
  family: BundleFamilyId,
  configuredFamilies: ReadonlySet<BundleFamilyId>
): boolean {
  return (
    configuredFamilies.has(family) ||
    (deterministicSubfamilies.has(family) && configuredFamilies.has("deterministic"))
  );
}

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
          isConfigured: isFamilyConfigured(family, configuredFamilies),
          lastCollectedAt: latest === null ? null : toCanonicalTimestamp(latest)
        }
      ];
    })
  ) as unknown as FamilyLiveness;
}
