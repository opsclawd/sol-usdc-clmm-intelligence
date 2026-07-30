import { describe, it, expect } from "vitest";
import { MVP_FEATURE_KINDS } from "../../../src/contracts/derived-feature.js";
import { MVP_ACCEPTED_CALCULATOR_VERSIONS } from "../../../src/domain/derived-feature/index.js";
import { RANGE_CALCULATOR_VERSIONS } from "../../../src/domain/derived-feature/range.js";
import { MARKET_CALCULATOR_VERSIONS } from "../../../src/domain/derived-feature/market.js";
import { REALIZED_VOLATILITY_1H_VERSION } from "../../../src/domain/derived-feature/volatility.js";
import { PERP_CALCULATOR_VERSIONS } from "../../../src/domain/perp-liquidation/derive.js";

describe("MVP_ACCEPTED_CALCULATOR_VERSIONS", () => {
  it("covers every MVP feature kind exactly once with a non-empty version", () => {
    const keys = Object.keys(MVP_ACCEPTED_CALCULATOR_VERSIONS);
    expect(keys).toHaveLength(MVP_FEATURE_KINDS.length);

    for (const kind of MVP_FEATURE_KINDS) {
      const version = MVP_ACCEPTED_CALCULATOR_VERSIONS[kind];
      expect(version).toBeDefined();
      expect(typeof version).toBe("string");
      expect(version.trim().length).toBeGreaterThan(0);
    }
  });

  it("reuses the authoritative range market volatility and perp calculator versions", () => {
    expect(MVP_ACCEPTED_CALCULATOR_VERSIONS.range_location).toBe(
      RANGE_CALCULATOR_VERSIONS.range_location
    );
    expect(MVP_ACCEPTED_CALCULATOR_VERSIONS.distance_to_lower).toBe(
      RANGE_CALCULATOR_VERSIONS.distance_to_lower
    );
    expect(MVP_ACCEPTED_CALCULATOR_VERSIONS.distance_to_upper).toBe(
      RANGE_CALCULATOR_VERSIONS.distance_to_upper
    );
    expect(MVP_ACCEPTED_CALCULATOR_VERSIONS.oracle_dex_divergence).toBe(
      MARKET_CALCULATOR_VERSIONS.oracle_dex_divergence
    );
    expect(MVP_ACCEPTED_CALCULATOR_VERSIONS.oracle_confidence_width).toBe(
      MARKET_CALCULATOR_VERSIONS.oracle_confidence_width
    );
    expect(MVP_ACCEPTED_CALCULATOR_VERSIONS.volume_liquidity_ratio_24h).toBe(
      MARKET_CALCULATOR_VERSIONS.volume_liquidity_ratio_24h
    );
    expect(MVP_ACCEPTED_CALCULATOR_VERSIONS.realized_volatility_1h).toBe(
      REALIZED_VOLATILITY_1H_VERSION
    );
    expect(MVP_ACCEPTED_CALCULATOR_VERSIONS.oi_trend_4h).toBe(PERP_CALCULATOR_VERSIONS.oi_trend_4h);
    expect(MVP_ACCEPTED_CALCULATOR_VERSIONS.liquidation_cluster_1h).toBe(
      PERP_CALCULATOR_VERSIONS.liquidation_cluster_1h
    );
    expect(MVP_ACCEPTED_CALCULATOR_VERSIONS.funding_rate_annualized).toBe(
      PERP_CALCULATOR_VERSIONS.funding_rate_annualized
    );
    expect(MVP_ACCEPTED_CALCULATOR_VERSIONS.basis_spread_bps).toBe(
      PERP_CALCULATOR_VERSIONS.basis_spread_bps
    );
  });

  it("is frozen against runtime mutation", () => {
    expect(Object.isFrozen(MVP_ACCEPTED_CALCULATOR_VERSIONS)).toBe(true);
    expect(() => {
      // @ts-expect-error mutating frozen object should throw in strict mode
      MVP_ACCEPTED_CALCULATOR_VERSIONS.range_location = "mutated";
    }).toThrow();
  });
});
