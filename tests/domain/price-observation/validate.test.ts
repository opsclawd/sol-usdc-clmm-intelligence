import { describe, it, expect } from "vitest";
import {
  acceptOraclePricePayload,
  acceptExecutableQuotePayload,
  acceptPriceNormalizedCandidate,
  PriceObservationValidationError
} from "../../../src/domain/price-observation/validate.js";

function makeOraclePricePayload(overrides = {}) {
  return {
    kind: "oracle_price",
    schemaVersion: 1,
    pair: "SOL/USDC",
    assets: {
      baseMint: "So11111111111111111111111111111111111112",
      quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      baseDecimals: 9,
      quoteDecimals: 6
    },
    priceData: {
      price: "175000000",
      confidence: "1500000",
      status: "trading",
      ageMs: 123
    },
    observedSource: {
      source: "pyth-hermes",
      observedAtUnixMs: 1710000000000,
      fetchedAtUnixMs: 1710000001000,
      slot: 123456789
    },
    bounds: {
      upperBound: "190000000",
      lowerBound: "160000000"
    },
    confidenceRatio: "0.014",
    warnings: [] as string[],
    ...overrides
  };
}

function makeExecutableQuotePayload(overrides = {}) {
  return {
    kind: "executable_quote",
    schemaVersion: 1,
    pair: "SOL/USDC",
    assets: {
      baseMint: "So11111111111111111111111111111111111112",
      quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      baseDecimals: 9,
      quoteDecimals: 6
    },
    quoteData: {
      price: "175000000",
      slippageBps: 50,
      thresholdBps: 100,
      exactProbe: "exactIn",
      receivedAtUnixMs: 1710000000000,
      fetchedAtUnixMs: 1710000001000
    },
    observedSource: {
      source: "jupiter-quote",
      observedAtUnixMs: 1710000000000,
      slot: 123456789
    },
    routeSummary: {
      routeAvailable: true,
      hops: [
        {
          pool: "pool-1",
          inputMint: "So11111111111111111111111111111111111112",
          outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          protocol: "orca"
        }
      ]
    },
    warnings: [] as string[],
    priceImpactRatio: "0.002",
    ...overrides
  };
}

describe("acceptOraclePricePayload", () => {
  describe("valid payloads", () => {
    it("accepts a complete oracle price payload", () => {
      const payload = makeOraclePricePayload();
      const result = acceptOraclePricePayload(payload);
      expect(result.kind).toBe("oracle_price");
      expect(result.priceData.price).toBe("175000000");
    });

    it("accepts oracle price payload with warnings", () => {
      const payload = makeOraclePricePayload({
        warnings: ["stale_observation", "wide_confidence_interval"]
      });
      const result = acceptOraclePricePayload(payload);
      expect(result.warnings).toHaveLength(2);
    });

    it("accepts jupiter-price as observed source", () => {
      const payload = makeOraclePricePayload({
        observedSource: {
          source: "jupiter-price",
          observedAtUnixMs: 1710000000000,
          fetchedAtUnixMs: 1710000001000,
          slot: 123456789
        }
      });
      const result = acceptOraclePricePayload(payload);
      expect(result.observedSource.source).toBe("jupiter-price");
    });

    it("accepts jupiter-price-v3 as observed source", () => {
      const payload = makeOraclePricePayload({
        observedSource: {
          source: "jupiter-price-v3",
          observedAtUnixMs: 1710000000000,
          fetchedAtUnixMs: 1710000001000,
          slot: 123456789
        }
      });
      const result = acceptOraclePricePayload(payload);
      expect(result.observedSource.source).toBe("jupiter-price-v3");
    });

    it("accepts halted status", () => {
      const payload = makeOraclePricePayload({
        priceData: { price: "175000000", confidence: "1500000", status: "halted", ageMs: 123 }
      });
      const result = acceptOraclePricePayload(payload);
      expect(result.priceData.status).toBe("halted");
    });

    it("accepts auction status", () => {
      const payload = makeOraclePricePayload({
        priceData: { price: "175000000", confidence: "1500000", status: "auction", ageMs: 123 }
      });
      const result = acceptOraclePricePayload(payload);
      expect(result.priceData.status).toBe("auction");
    });
  });

  describe("validation failures", () => {
    it("rejects non-finite observedAtUnixMs", () => {
      const payload = makeOraclePricePayload({
        observedSource: {
          source: "pyth-hermes",
          observedAtUnixMs: NaN,
          fetchedAtUnixMs: 1710000001000,
          slot: 123456789
        }
      });
      expect(() => acceptOraclePricePayload(payload)).toThrow();
    });

    it("rejects Infinity in fetchedAtUnixMs", () => {
      const payload = makeOraclePricePayload({
        observedSource: {
          source: "pyth-hermes",
          observedAtUnixMs: 1710000000000,
          fetchedAtUnixMs: Infinity,
          slot: 123456789
        }
      });
      expect(() => acceptOraclePricePayload(payload)).toThrow();
    });

    it("rejects negative slot", () => {
      const payload = makeOraclePricePayload({
        observedSource: {
          source: "pyth-hermes",
          observedAtUnixMs: 1710000000000,
          fetchedAtUnixMs: 1710000001000,
          slot: -1
        }
      });
      expect(() => acceptOraclePricePayload(payload)).toThrow();
    });

    it("rejects invalid source enum", () => {
      const payload = makeOraclePricePayload({
        observedSource: {
          source: "jupiter-quote" as "pyth-hermes",
          observedAtUnixMs: 1710000000000,
          fetchedAtUnixMs: 1710000001000,
          slot: 123456789
        }
      });
      expect(() => acceptOraclePricePayload(payload)).toThrow(PriceObservationValidationError);
    });

    it("rejects wrong pair", () => {
      const payload = makeOraclePricePayload({ pair: "ETH/USDC" as "SOL/USDC" });
      expect(() => acceptOraclePricePayload(payload)).toThrow();
    });

    it("rejects wrong kind", () => {
      const payload = makeOraclePricePayload({ kind: "executable_quote" as "oracle_price" });
      expect(() => acceptOraclePricePayload(payload)).toThrow();
    });

    it("rejects non-array warnings", () => {
      const payload = makeOraclePricePayload({ warnings: "not-an-array" as unknown as [] });
      expect(() => acceptOraclePricePayload(payload)).toThrow();
    });

    it("rejects invalid warning value", () => {
      const payload = makeOraclePricePayload({ warnings: ["invalid_warning"] });
      expect(() => acceptOraclePricePayload(payload)).toThrow();
    });

    it("rejects NaN in priceData.ageMs", () => {
      const payload = makeOraclePricePayload({
        priceData: { price: "175000000", confidence: "1500000", status: "trading", ageMs: NaN }
      });
      expect(() => acceptOraclePricePayload(payload)).toThrow();
    });
  });
});

describe("acceptExecutableQuotePayload", () => {
  describe("valid payloads", () => {
    it("accepts a complete executable quote payload with route available", () => {
      const payload = makeExecutableQuotePayload();
      const result = acceptExecutableQuotePayload(payload);
      expect(result.kind).toBe("executable_quote");
      expect(result.routeSummary.routeAvailable).toBe(true);
    });

    it("accepts executable quote payload with null price", () => {
      const payload = makeExecutableQuotePayload({
        quoteData: {
          price: null,
          slippageBps: 50,
          thresholdBps: 100,
          exactProbe: "exactIn",
          receivedAtUnixMs: 1710000000000,
          fetchedAtUnixMs: 1710000001000
        }
      });
      const result = acceptExecutableQuotePayload(payload);
      expect(result.quoteData.price).toBeNull();
    });

    it("accepts executable quote payload with route unavailable and no failureReason", () => {
      const payload = makeExecutableQuotePayload({
        routeSummary: { routeAvailable: false }
      });
      const result = acceptExecutableQuotePayload(payload);
      expect(result.routeSummary.routeAvailable).toBe(false);
      expect((result.routeSummary as { failureReason?: string }).failureReason).toBeUndefined();
    });

    it("accepts executable quote payload with route unavailable and failureReason", () => {
      const payload = makeExecutableQuotePayload({
        routeSummary: { routeAvailable: false, failureReason: "insufficient liquidity" }
      });
      const result = acceptExecutableQuotePayload(payload);
      expect(result.routeSummary.routeAvailable).toBe(false);
      expect((result.routeSummary as { failureReason?: string }).failureReason).toBe(
        "insufficient liquidity"
      );
    });

    it("accepts exactOut probe", () => {
      const payload = makeExecutableQuotePayload({
        quoteData: {
          price: "175000000",
          slippageBps: 50,
          thresholdBps: 100,
          exactProbe: "exactOut",
          receivedAtUnixMs: 1710000000000,
          fetchedAtUnixMs: 1710000001000
        }
      });
      const result = acceptExecutableQuotePayload(payload);
      expect(result.quoteData.exactProbe).toBe("exactOut");
    });

    it("accepts executable quote with warnings", () => {
      const payload = makeExecutableQuotePayload({
        warnings: ["route_unavailable", "price_impact_exceeds_threshold"]
      });
      const result = acceptExecutableQuotePayload(payload);
      expect(result.warnings).toHaveLength(2);
    });
  });

  describe("validation failures", () => {
    it("rejects non-finite observedAtUnixMs", () => {
      const payload = makeExecutableQuotePayload({
        observedSource: { source: "jupiter-quote", observedAtUnixMs: NaN, slot: 123456789 }
      });
      expect(() => acceptExecutableQuotePayload(payload)).toThrow();
    });

    it("rejects Infinity in slot", () => {
      const payload = makeExecutableQuotePayload({
        observedSource: { source: "jupiter-quote", observedAtUnixMs: 1710000000000, slot: Infinity }
      });
      expect(() => acceptExecutableQuotePayload(payload)).toThrow();
    });

    it("rejects nonfinite slippageBps", () => {
      const payload = makeExecutableQuotePayload({
        quoteData: {
          price: "175000000",
          slippageBps: NaN,
          thresholdBps: 100,
          exactProbe: "exactIn",
          receivedAtUnixMs: 1710000000000,
          fetchedAtUnixMs: 1710000001000
        }
      });
      expect(() => acceptExecutableQuotePayload(payload)).toThrow();
    });

    it("rejects invalid source", () => {
      const payload = makeExecutableQuotePayload({
        observedSource: {
          source: "pyth-hermes" as "jupiter-quote",
          observedAtUnixMs: 1710000000000,
          slot: 123456789
        }
      });
      expect(() => acceptExecutableQuotePayload(payload)).toThrow(PriceObservationValidationError);
    });

    it("rejects wrong kind", () => {
      const payload = makeExecutableQuotePayload({ kind: "oracle_price" as "executable_quote" });
      expect(() => acceptExecutableQuotePayload(payload)).toThrow();
    });

    it("rejects wrong pair", () => {
      const payload = makeExecutableQuotePayload({ pair: "ETH/USDC" as "SOL/USDC" });
      expect(() => acceptExecutableQuotePayload(payload)).toThrow();
    });

    it("rejects invalid routeSummary type", () => {
      const payload = makeExecutableQuotePayload({
        routeSummary: { routeAvailable: "yes" as unknown as true }
      });
      expect(() => acceptExecutableQuotePayload(payload)).toThrow();
    });
  });
});

describe("acceptPriceNormalizedCandidate", () => {
  it("accepts oracle price payload", () => {
    const payload = makeOraclePricePayload();
    const result = acceptPriceNormalizedCandidate(payload);
    expect(result.kind).toBe("oracle_price");
  });

  it("accepts executable quote payload", () => {
    const payload = makeExecutableQuotePayload();
    const result = acceptPriceNormalizedCandidate(payload);
    expect(result.kind).toBe("executable_quote");
  });

  it("rejects invalid payload", () => {
    expect(() => acceptPriceNormalizedCandidate(null)).toThrow();
    expect(() => acceptPriceNormalizedCandidate("string")).toThrow();
    expect(() => acceptPriceNormalizedCandidate(123)).toThrow();
  });
});
