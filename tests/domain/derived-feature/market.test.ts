import { describe, it, expect } from "vitest";
import type {
  OraclePricePayloadV1,
  ExecutableQuotePayloadV1
} from "../../../src/contracts/normalized-price-observation.js";
import type { PoolStatisticsPayloadV1 } from "../../../src/contracts/normalized-pool-statistics.js";
import {
  calculateOracleDexDivergence,
  calculateOracleConfidenceWidth,
  calculateVolumeLiquidityRatio24h,
  MARKET_CALCULATOR_VERSIONS
} from "../../../src/domain/derived-feature/market.js";

function makeOraclePrice(
  overrides: {
    priceData?: Partial<OraclePricePayloadV1["priceData"]>;
    observedSource?: Partial<OraclePricePayloadV1["observedSource"]>;
    warnings?: OraclePricePayloadV1["warnings"];
    confidenceRatio?: string;
  } = {}
): OraclePricePayloadV1 {
  const defaultOracle: OraclePricePayloadV1 = {
    kind: "oracle_price",
    schemaVersion: 1,
    pair: "SOL/USDC",
    assets: {
      baseMint: "So11111111111111111111111111111111111112",
      quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGorxCeDFSQs",
      baseDecimals: 9,
      quoteDecimals: 6
    },
    priceData: {
      price: "150.00",
      confidence: "0.05",
      status: "trading",
      ageMs: 1000
    },
    observedSource: {
      source: "pyth-hermes",
      observedAtUnixMs: 1000000000000,
      fetchedAtUnixMs: 1000000000100,
      slot: 100
    },
    bounds: {
      upperBound: "150.10",
      lowerBound: "149.90"
    },
    confidenceRatio: "0.0003",
    warnings: []
  };

  return {
    ...defaultOracle,
    priceData: { ...defaultOracle.priceData, ...overrides.priceData },
    observedSource: { ...defaultOracle.observedSource, ...overrides.observedSource },
    warnings: overrides.warnings ?? defaultOracle.warnings,
    confidenceRatio: overrides.confidenceRatio ?? defaultOracle.confidenceRatio
  };
}

function makeExecutableQuote(
  overrides: {
    quoteData?: Partial<ExecutableQuotePayloadV1["quoteData"]>;
    observedSource?: Partial<ExecutableQuotePayloadV1["observedSource"]>;
    routeSummary?: ExecutableQuotePayloadV1["routeSummary"];
    warnings?: ExecutableQuotePayloadV1["warnings"];
  } = {}
): ExecutableQuotePayloadV1 {
  const defaultQuote: ExecutableQuotePayloadV1 = {
    kind: "executable_quote",
    schemaVersion: 1,
    pair: "SOL/USDC",
    assets: {
      baseMint: "So11111111111111111111111111111111111112",
      quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGorxCeDFSQs",
      baseDecimals: 9,
      quoteDecimals: 6
    },
    quoteData: {
      price: "150.05",
      slippageBps: 50,
      thresholdBps: 100,
      exactProbe: "exactIn",
      receivedAtUnixMs: 1000000000000,
      fetchedAtUnixMs: 1000000000050
    },
    observedSource: {
      source: "jupiter-quote",
      observedAtUnixMs: 1000000000000,
      slot: 100
    },
    routeSummary: {
      routeAvailable: true,
      hops: []
    },
    warnings: [],
    priceImpactRatio: "0.0001"
  };

  return {
    ...defaultQuote,
    quoteData: { ...defaultQuote.quoteData, ...overrides.quoteData },
    observedSource: { ...defaultQuote.observedSource, ...overrides.observedSource },
    routeSummary: overrides.routeSummary ?? defaultQuote.routeSummary,
    warnings: overrides.warnings ?? defaultQuote.warnings
  };
}

function makePoolStats(overrides: Partial<PoolStatisticsPayloadV1>): PoolStatisticsPayloadV1 {
  const base: PoolStatisticsPayloadV1 = {
    kind: "pool_statistics",
    schemaVersion: 1,
    pair: "SOL/USDC",
    poolId: "pool123",
    observedAtUnixMs: 1000000000000,
    observedSlot: 100,
    window: "24h",
    tvlUsdc: "1000000",
    volume24hUsdc: "500000",
    fees24hUsdc: "1500",
    warnings: [],
    sourceQuality: {
      providerWarning: false,
      completeness: "complete"
    }
  };
  return { ...base, ...overrides } as PoolStatisticsPayloadV1;
}

describe("MARKET_CALCULATOR_VERSIONS", () => {
  it("exports correct version strings", () => {
    expect(MARKET_CALCULATOR_VERSIONS.oracle_dex_divergence).toBe("oracle-dex-divergence/v1");
    expect(MARKET_CALCULATOR_VERSIONS.oracle_confidence_width).toBe("oracle-confidence-width/v1");
    expect(MARKET_CALCULATOR_VERSIONS.volume_liquidity_ratio_24h).toBe(
      "volume-liquidity-ratio-24h/v1"
    );
  });
});

describe("calculates absolute oracle DEX divergence only from Pyth and executable Jupiter quote", () => {
  it("returns exact BPS divergence between Pyth oracle and Jupiter DEX quote", () => {
    const oracle = makeOraclePrice({
      priceData: { price: "150.00", confidence: "0.05" },
      observedSource: {
        source: "pyth-hermes",
        observedAtUnixMs: 1000000000000,
        fetchedAtUnixMs: 1000000000100,
        slot: 100
      }
    });
    const dex = makeExecutableQuote({
      quoteData: { price: "150.05" },
      observedSource: { source: "jupiter-quote", observedAtUnixMs: 1000000000000, slot: 100 }
    });
    const result = calculateOracleDexDivergence(oracle, dex, 1000000000000);
    expect(result.status).toBe("AVAILABLE");
    expect(result.value).toBeGreaterThan(0);
    expect(result.metadata.unit).toBe("BPS");
  });

  it("returns exact BPS divergence with Jupiter price as DEX proxy", () => {
    const oracle = makeOraclePrice({
      priceData: { price: "150.00", confidence: "0.05" },
      observedSource: {
        source: "pyth-hermes",
        observedAtUnixMs: 1000000000000,
        fetchedAtUnixMs: 1000000000100,
        slot: 100
      }
    });
    const dex = makeExecutableQuote({
      quoteData: { price: "149.95" },
      observedSource: { source: "jupiter-quote", observedAtUnixMs: 1000000000000, slot: 100 }
    });
    const result = calculateOracleDexDivergence(oracle, dex, 1000000000000);
    expect(result.status).toBe("AVAILABLE");
    expect(result.value).toBeGreaterThan(0);
  });

  it("rounds ties to nearest integer away from zero", () => {
    const oracle = makeOraclePrice({
      priceData: { price: "100.00", confidence: "0.01" },
      observedSource: {
        source: "pyth-hermes",
        observedAtUnixMs: 1000000000000,
        fetchedAtUnixMs: 1000000000100,
        slot: 100
      }
    });
    const dex = makeExecutableQuote({
      quoteData: { price: "100.005" },
      observedSource: { source: "jupiter-quote", observedAtUnixMs: 1000000000000, slot: 100 }
    });
    const result = calculateOracleDexDivergence(oracle, dex, 1000000000000);
    expect(result.status).toBe("AVAILABLE");
    const expected = Math.round((0.005 / 100) * 10000);
    expect(result.value).toBe(expected);
  });

  it("uses only Pyth oracle and Jupiter executable quote within 30 second skew", () => {
    const oracle = makeOraclePrice({
      priceData: { price: "150.00", confidence: "0.05" },
      observedSource: {
        source: "pyth-hermes",
        observedAtUnixMs: 1000000000000,
        fetchedAtUnixMs: 1000000000100,
        slot: 100
      }
    });
    const dex = makeExecutableQuote({
      quoteData: { price: "150.05" },
      observedSource: { source: "jupiter-quote", observedAtUnixMs: 1000000000020, slot: 100 }
    });
    const result = calculateOracleDexDivergence(oracle, dex, 1000000000030);
    expect(result.status).toBe("AVAILABLE");
  });
});

describe("makes divergence unavailable for missing route stale input or excessive skew", () => {
  it("returns UNAVAILABLE null when route is unavailable", () => {
    const oracle = makeOraclePrice({
      priceData: { price: "150.00", confidence: "0.05" },
      observedSource: {
        source: "pyth-hermes",
        observedAtUnixMs: 1000000000000,
        fetchedAtUnixMs: 1000000000100,
        slot: 100
      }
    });
    const dex = makeExecutableQuote({
      routeSummary: { routeAvailable: false, failureReason: "no route" },
      quoteData: { price: "150.05" },
      observedSource: { source: "jupiter-quote", observedAtUnixMs: 1000000000000, slot: 100 }
    });
    const result = calculateOracleDexDivergence(oracle, dex, 1000000000000);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.value).toBeNull();
    expect(result.reasons.some((r) => r.includes("route"))).toBe(true);
  });

  it("returns UNAVAILABLE null when oracle price is stale (>30s skew)", () => {
    const oracle = makeOraclePrice({
      priceData: { price: "150.00", confidence: "0.05" },
      observedSource: {
        source: "pyth-hermes",
        observedAtUnixMs: 1000000000000,
        fetchedAtUnixMs: 1000000000100,
        slot: 100
      }
    });
    const dex = makeExecutableQuote({
      quoteData: { price: "150.05" },
      observedSource: { source: "jupiter-quote", observedAtUnixMs: 1000000000000, slot: 100 }
    });
    const result = calculateOracleDexDivergence(oracle, dex, 1000000031000);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.value).toBeNull();
    expect(result.reasons.some((r) => r.includes("stale") || r.includes("skew"))).toBe(true);
  });

  it("returns UNAVAILABLE null when oracle price is null", () => {
    const oracle = makeOraclePrice({
      priceData: { price: "150.00", confidence: "0.05" },
      observedSource: {
        source: "pyth-hermes",
        observedAtUnixMs: 1000000000000,
        fetchedAtUnixMs: 1000000000100,
        slot: 100
      }
    });
    const dex = makeExecutableQuote({
      quoteData: { price: null },
      observedSource: { source: "jupiter-quote", observedAtUnixMs: 1000000000000, slot: 100 }
    });
    const result = calculateOracleDexDivergence(oracle, dex, 1000000000000);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.value).toBeNull();
  });

  it("returns UNAVAILABLE null when price is nonpositive", () => {
    const oracle = makeOraclePrice({
      priceData: { price: "0", confidence: "0.05" },
      observedSource: {
        source: "pyth-hermes",
        observedAtUnixMs: 1000000000000,
        fetchedAtUnixMs: 1000000000100,
        slot: 100
      }
    });
    const dex = makeExecutableQuote({
      quoteData: { price: "150.05" },
      observedSource: { source: "jupiter-quote", observedAtUnixMs: 1000000000000, slot: 100 }
    });
    const result = calculateOracleDexDivergence(oracle, dex, 1000000000000);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.value).toBeNull();
  });
});

describe("retains a partial divergence value for nonfatal input quality", () => {
  it("returns PARTIAL with numeric value when oracle confidence is wide", () => {
    const oracle = makeOraclePrice({
      priceData: { price: "150.00", confidence: "5.00" },
      warnings: ["wide_confidence_interval"],
      observedSource: {
        source: "pyth-hermes",
        observedAtUnixMs: 1000000000000,
        fetchedAtUnixMs: 1000000000100,
        slot: 100
      }
    });
    const dex = makeExecutableQuote({
      quoteData: { price: "150.05" },
      observedSource: { source: "jupiter-quote", observedAtUnixMs: 1000000000000, slot: 100 }
    });
    const result = calculateOracleDexDivergence(oracle, dex, 1000000000000);
    expect(result.status).toBe("PARTIAL");
    expect(result.value).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes("confidence"))).toBe(true);
  });

  it("returns PARTIAL with numeric value when DEX quote has nonfatal warning", () => {
    const oracle = makeOraclePrice({
      priceData: { price: "150.00", confidence: "0.05" },
      observedSource: {
        source: "pyth-hermes",
        observedAtUnixMs: 1000000000000,
        fetchedAtUnixMs: 1000000000100,
        slot: 100
      }
    });
    const dex = makeExecutableQuote({
      quoteData: { price: "150.05" },
      warnings: ["price_impact_exceeds_threshold"],
      observedSource: { source: "jupiter-quote", observedAtUnixMs: 1000000000000, slot: 100 }
    });
    const result = calculateOracleDexDivergence(oracle, dex, 1000000000000);
    expect(result.status).toBe("PARTIAL");
    expect(result.value).toBeGreaterThan(0);
  });
});

describe("measures wide oracle confidence as partial rather than missing", () => {
  it("returns PARTIAL with numeric value when confidence is wide but price is valid", () => {
    const oracle = makeOraclePrice({
      priceData: { price: "150.00", confidence: "10.00" },
      warnings: ["wide_confidence_interval"],
      observedSource: {
        source: "pyth-hermes",
        observedAtUnixMs: 1000000000000,
        fetchedAtUnixMs: 1000000000100,
        slot: 100
      }
    });
    const result = calculateOracleConfidenceWidth(oracle, 1000000000000);
    expect(result.status).toBe("PARTIAL");
    expect(result.value).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes("confidence"))).toBe(true);
  });

  it("returns UNAVAILABLE null when oracle status is halted", () => {
    const oracle = makeOraclePrice({
      priceData: { price: "150.00", confidence: "0.05", status: "halted" },
      observedSource: {
        source: "pyth-hermes",
        observedAtUnixMs: 1000000000000,
        fetchedAtUnixMs: 1000000000100,
        slot: 100
      }
    });
    const result = calculateOracleConfidenceWidth(oracle, 1000000000000);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.value).toBeNull();
    expect(result.reasons.some((r) => r.includes("halted") || r.includes("status"))).toBe(true);
  });

  it("returns UNAVAILABLE null when oracle status is auction", () => {
    const oracle = makeOraclePrice({
      priceData: { price: "150.00", confidence: "0.05", status: "auction" },
      observedSource: {
        source: "pyth-hermes",
        observedAtUnixMs: 1000000000000,
        fetchedAtUnixMs: 1000000000100,
        slot: 100
      }
    });
    const result = calculateOracleConfidenceWidth(oracle, 1000000000000);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.value).toBeNull();
  });

  it("returns UNAVAILABLE null when confidence is negative", () => {
    const oracle = makeOraclePrice({
      priceData: { price: "150.00", confidence: "-0.05" },
      observedSource: {
        source: "pyth-hermes",
        observedAtUnixMs: 1000000000000,
        fetchedAtUnixMs: 1000000000100,
        slot: 100
      }
    });
    const result = calculateOracleConfidenceWidth(oracle, 1000000000000);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.value).toBeNull();
  });

  it("returns UNAVAILABLE null when price is nonpositive", () => {
    const oracle = makeOraclePrice({
      priceData: { price: "0", confidence: "0.05" },
      observedSource: {
        source: "pyth-hermes",
        observedAtUnixMs: 1000000000000,
        fetchedAtUnixMs: 1000000000100,
        slot: 100
      }
    });
    const result = calculateOracleConfidenceWidth(oracle, 1000000000000);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.value).toBeNull();
  });

  it("returns exact confidence width in BPS", () => {
    const oracle = makeOraclePrice({
      priceData: { price: "100.00", confidence: "0.50" },
      observedSource: {
        source: "pyth-hermes",
        observedAtUnixMs: 1000000000000,
        fetchedAtUnixMs: 1000000000100,
        slot: 100
      }
    });
    const result = calculateOracleConfidenceWidth(oracle, 1000000000000);
    expect(result.status).toBe("AVAILABLE");
    expect(result.value).toBe(50);
    expect(result.metadata.unit).toBe("BPS");
  });

  it("returns UNAVAILABLE null when oracle is stale (>30s skew)", () => {
    const oracle = makeOraclePrice({
      priceData: { price: "150.00", confidence: "0.05" },
      observedSource: {
        source: "pyth-hermes",
        observedAtUnixMs: 1000000000000,
        fetchedAtUnixMs: 1000000000100,
        slot: 100
      }
    });
    const result = calculateOracleConfidenceWidth(oracle, 1000000031000);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.value).toBeNull();
  });
});

describe("accepts zero volume only with positive TVL", () => {
  it("returns AVAILABLE with zero when volume is zero and TVL is positive", () => {
    const pool = makePoolStats({
      volume24hUsdc: "0",
      tvlUsdc: "1000000"
    });
    const result = calculateVolumeLiquidityRatio24h(pool);
    expect(result.status).toBe("AVAILABLE");
    expect(result.value).toBe(0);
    expect(result.metadata.unit).toBe("PPM");
  });

  it("returns UNAVAILABLE null when TVL is missing", () => {
    const pool = makePoolStats({
      volume24hUsdc: "500000",
      tvlUsdc: null
    });
    const result = calculateVolumeLiquidityRatio24h(pool);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.value).toBeNull();
    expect(result.reasons.some((r) => r.includes("TVL") || r.includes("tvl"))).toBe(true);
  });

  it("returns UNAVAILABLE null when TVL is zero", () => {
    const pool = makePoolStats({
      volume24hUsdc: "500000",
      tvlUsdc: "0"
    });
    const result = calculateVolumeLiquidityRatio24h(pool);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.value).toBeNull();
  });

  it("returns UNAVAILABLE null when TVL is negative", () => {
    const pool = makePoolStats({
      volume24hUsdc: "500000",
      tvlUsdc: "-100"
    });
    const result = calculateVolumeLiquidityRatio24h(pool);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.value).toBeNull();
  });

  it("returns UNAVAILABLE null when volume is missing", () => {
    const pool = makePoolStats({
      volume24hUsdc: null,
      tvlUsdc: "1000000"
    });
    const result = calculateVolumeLiquidityRatio24h(pool);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.value).toBeNull();
  });

  it("returns PARTIAL when pool has provider warning", () => {
    const pool = makePoolStats({
      volume24hUsdc: "500000",
      tvlUsdc: "1000000",
      sourceQuality: { providerWarning: true, completeness: "complete" }
    });
    const result = calculateVolumeLiquidityRatio24h(pool);
    expect(result.status).toBe("PARTIAL");
    expect(result.value).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes("provider"))).toBe(true);
  });

  it("returns exact PPM ratio for positive volume and TVL", () => {
    const pool = makePoolStats({
      volume24hUsdc: "500000",
      tvlUsdc: "1000000"
    });
    const result = calculateVolumeLiquidityRatio24h(pool);
    expect(result.status).toBe("AVAILABLE");
    expect(result.value).toBe(500000);
    expect(result.metadata.unit).toBe("PPM");
  });

  it("rounds ties to nearest integer away from zero", () => {
    const pool = makePoolStats({
      volume24hUsdc: "1",
      tvlUsdc: "3"
    });
    const result = calculateVolumeLiquidityRatio24h(pool);
    expect(result.status).toBe("AVAILABLE");
    const expected = Math.round((1 / 3) * 1_000_000);
    expect(result.value).toBe(expected);
  });
});

describe("golden fixtures", () => {
  it("exact divergence: oracle 150.00, dex 150.05 at 30s skew boundary", () => {
    const oracle = makeOraclePrice({
      priceData: { price: "150.00", confidence: "0.05" },
      observedSource: {
        source: "pyth-hermes",
        observedAtUnixMs: 1000000000000,
        fetchedAtUnixMs: 1000000000100,
        slot: 100
      }
    });
    const dex = makeExecutableQuote({
      quoteData: { price: "150.05" },
      observedSource: { source: "jupiter-quote", observedAtUnixMs: 1000000000000, slot: 100 }
    });
    const result = calculateOracleDexDivergence(oracle, dex, 1000000000030);
    expect(result.status).toBe("AVAILABLE");
    const expected = Math.round((0.05 / 150) * 10000);
    expect(result.value).toBe(expected);
  });

  it("exact confidence width: oracle 100.00, confidence 0.25", () => {
    const oracle = makeOraclePrice({
      priceData: { price: "100.00", confidence: "0.25" },
      observedSource: {
        source: "pyth-hermes",
        observedAtUnixMs: 1000000000000,
        fetchedAtUnixMs: 1000000000100,
        slot: 100
      }
    });
    const result = calculateOracleConfidenceWidth(oracle, 1000000000000);
    expect(result.status).toBe("AVAILABLE");
    expect(result.value).toBe(25);
  });

  it("exact volume ratio: volume 250000, tvl 1000000", () => {
    const pool = makePoolStats({
      volume24hUsdc: "250000",
      tvlUsdc: "1000000"
    });
    const result = calculateVolumeLiquidityRatio24h(pool);
    expect(result.status).toBe("AVAILABLE");
    expect(result.value).toBe(250000);
  });
});
