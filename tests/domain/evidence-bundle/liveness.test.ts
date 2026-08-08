import { describe, expect, it } from "vitest";
import type { LivenessState } from "../../../src/contracts/generated/evidence-bundle-v1.js";
import type { Source } from "../../../src/contracts/taxonomy.js";
import {
  buildFamilyLiveness,
  type BundleFamilyId
} from "../../../src/domain/evidence-bundle/liveness.js";

const ALL_FAMILY_IDS = [
  "clmm_economics",
  "derivatives",
  "deterministic",
  "events",
  "flows",
  "liquidity",
  "market_state",
  "newsRegulatory",
  "position_state",
  "price_quality",
  "researchBrief",
  "risk",
  "supportResistance"
].sort();

function build(latestReceivedAt: ReadonlyMap<Source, number>) {
  return buildFamilyLiveness(
    new Set<BundleFamilyId>(["deterministic"]),
    latestReceivedAt
  ) as unknown as Record<string, LivenessState>;
}

describe("deterministic sub-family liveness", () => {
  it("emits the aggregate and all six deterministic sub-family entries", () => {
    expect(Object.keys(build(new Map())).sort()).toEqual(ALL_FAMILY_IDS);
  });

  it("isolates each deterministic sub-family timestamp from unrelated faster collectors", () => {
    const result = build(
      new Map<Source, number>([
        ["clmm-v2-bundle", 5_000],
        ["orca-public-api", 4_000],
        ["pyth-hermes", 3_000],
        ["jupiter-quote", 2_000],
        ["solana-rpc", 1_000],
        ["binance-fapi", 100],
        ["drift-api", 200]
      ])
    );

    expect(result.risk.lastCollectedAt).toBe("1970-01-01T00:00:00.200Z");
    expect(result.market_state.lastCollectedAt).toBe("1970-01-01T00:00:03.000Z");
    expect(result.price_quality.lastCollectedAt).toBe("1970-01-01T00:00:03.000Z");
    expect(result.liquidity.lastCollectedAt).toBe("1970-01-01T00:00:05.000Z");
    expect(result.position_state.lastCollectedAt).toBe("1970-01-01T00:00:05.000Z");
    expect(result.clmm_economics.lastCollectedAt).toBe("1970-01-01T00:00:05.000Z");
    expect(result.deterministic.lastCollectedAt).toBe("1970-01-01T00:00:05.000Z");
  });

  it("reports null for a deterministic sub-family whose sources never succeeded", () => {
    const result = build(new Map<Source, number>([["clmm-v2-bundle", 5_000]]));

    expect(result.risk.lastCollectedAt).toBeNull();
    expect(result.market_state.lastCollectedAt).toBeNull();
    expect(result.deterministic.lastCollectedAt).toBe("1970-01-01T00:00:05.000Z");
  });

  it("inherits configured state from deterministic for each deterministic sub-family", () => {
    const result = build(new Map());

    for (const family of [
      "market_state",
      "price_quality",
      "clmm_economics",
      "position_state",
      "liquidity",
      "risk"
    ]) {
      expect(result[family]?.isConfigured).toBe(true);
    }
    expect(result.flows.isConfigured).toBe(false);
  });
});
