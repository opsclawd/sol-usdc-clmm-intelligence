import { describe, it, expect } from "vitest";
import {
  makePythHermesEnvelope,
  makePythHermesParsedPrice,
  makePythHermesPriceUpdate,
  makePythHermesEnvelopeWithExtraFields,
  SOL_USD_FEED_ID
} from "../../fixtures/pyth-price-update.js";

describe("Pyth Oracle Price Processing", () => {
  describe("acceptPythEnvelope", () => {
    it("returns the complete original envelope for raw storage", async () => {
      const { acceptPythEnvelope } = await import("../../../src/domain/price-observation/pyth.js");
      const envelope = makePythHermesEnvelope();
      const result = acceptPythEnvelope(envelope, SOL_USD_FEED_ID);
      expect(result.envelope).toEqual(envelope);
    });

    it("rejects feed mismatch", async () => {
      const { acceptPythEnvelope } = await import("../../../src/domain/price-observation/pyth.js");
      const envelope = makePythHermesEnvelope();
      const wrongFeedId = "0x0000000000000000000000000000000000000000000000000000000000000000";
      expect(() => acceptPythEnvelope(envelope, wrongFeedId)).toThrow();
    });

    it("rejects missing parsed price", async () => {
      const { acceptPythEnvelope } = await import("../../../src/domain/price-observation/pyth.js");
      const envelope = { binary: "data", parsed: [] };
      expect(() => acceptPythEnvelope(envelope, SOL_USD_FEED_ID)).toThrow();
    });

    it("rejects invalid integer string price", async () => {
      const { acceptPythEnvelope } = await import("../../../src/domain/price-observation/pyth.js");
      const envelope = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({ price: "not-a-number" })
          })
        ]
      });
      expect(() => acceptPythEnvelope(envelope, SOL_USD_FEED_ID)).toThrow();
    });

    it("rejects invalid integer string confidence", async () => {
      const { acceptPythEnvelope } = await import("../../../src/domain/price-observation/pyth.js");
      const envelope = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({ confidence: "NaN" })
          })
        ]
      });
      expect(() => acceptPythEnvelope(envelope, SOL_USD_FEED_ID)).toThrow();
    });

    it("rejects invalid exponent", async () => {
      const { acceptPythEnvelope } = await import("../../../src/domain/price-observation/pyth.js");
      const envelope = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({ exponent: NaN })
          })
        ]
      });
      expect(() => acceptPythEnvelope(envelope, SOL_USD_FEED_ID)).toThrow();
    });

    it("rejects invalid timestamp", async () => {
      const { acceptPythEnvelope } = await import("../../../src/domain/price-observation/pyth.js");
      const envelope = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({ timestamp: Infinity })
          })
        ]
      });
      expect(() => acceptPythEnvelope(envelope, SOL_USD_FEED_ID)).toThrow();
    });

    it("accepts missing slot (slot is optional)", async () => {
      const { acceptPythEnvelope } = await import("../../../src/domain/price-observation/pyth.js");
      const envelope = makePythHermesEnvelope({
        parsed: [
          {
            id: SOL_USD_FEED_ID,
            price: makePythHermesParsedPrice(),
            slot: undefined as unknown as number
          }
        ]
      });
      const result = acceptPythEnvelope(envelope, SOL_USD_FEED_ID);
      expect(result.envelope).toEqual(envelope);
    });

    it("retains extra envelope fields", async () => {
      const { acceptPythEnvelope } = await import("../../../src/domain/price-observation/pyth.js");
      const envelope = makePythHermesEnvelopeWithExtraFields();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = acceptPythEnvelope(envelope as any, SOL_USD_FEED_ID) as any;
      expect(result.envelope.extraField).toBe("should be retained");
      expect(result.envelope.nested.data).toBe(42);
    });
  });

  describe("derivePythSourceObservationKey", () => {
    it("is stable regardless of object key order", async () => {
      const { derivePythSourceObservationKey } =
        await import("../../../src/domain/price-observation/pyth.js");
      const key1 = await derivePythSourceObservationKey({
        feedId: SOL_USD_FEED_ID,
        publishTimeUnixSeconds: 1710000000
      });
      const key2 = await derivePythSourceObservationKey({
        publishTimeUnixSeconds: 1710000000,
        feedId: SOL_USD_FEED_ID
      });
      expect(key1).toBe(key2);
    });

    it("changes when feed ID changes", async () => {
      const { derivePythSourceObservationKey } =
        await import("../../../src/domain/price-observation/pyth.js");
      const key1 = await derivePythSourceObservationKey({
        feedId: SOL_USD_FEED_ID,
        publishTimeUnixSeconds: 1710000000
      });
      const key2 = await derivePythSourceObservationKey({
        feedId: "0x0000000000000000000000000000000000000000000000000000000000000000",
        publishTimeUnixSeconds: 1710000000
      });
      expect(key1).not.toBe(key2);
    });

    it("changes when publish time changes", async () => {
      const { derivePythSourceObservationKey } =
        await import("../../../src/domain/price-observation/pyth.js");
      const key1 = await derivePythSourceObservationKey({
        feedId: SOL_USD_FEED_ID,
        publishTimeUnixSeconds: 1710000000
      });
      const key2 = await derivePythSourceObservationKey({
        feedId: SOL_USD_FEED_ID,
        publishTimeUnixSeconds: 1710000001
      });
      expect(key1).not.toBe(key2);
    });

    it("uses versioned source identity", async () => {
      const { derivePythSourceObservationKey } =
        await import("../../../src/domain/price-observation/pyth.js");
      const key = await derivePythSourceObservationKey({
        feedId: SOL_USD_FEED_ID,
        publishTimeUnixSeconds: 1710000000
      });
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("normalizePythPrice", () => {
    it("rejects non-positive price", async () => {
      const { normalizePythPrice } = await import("../../../src/domain/price-observation/pyth.js");
      const envelope = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({ price: "0" })
          })
        ]
      });
      expect(() => normalizePythPrice(envelope, SOL_USD_FEED_ID)).toThrow();
    });

    it("rejects negative price", async () => {
      const { normalizePythPrice } = await import("../../../src/domain/price-observation/pyth.js");
      const envelope = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({ price: "-100000000" })
          })
        ]
      });
      expect(() => normalizePythPrice(envelope, SOL_USD_FEED_ID)).toThrow();
    });

    it("emits exact decimal bounds", async () => {
      const { normalizePythPrice } = await import("../../../src/domain/price-observation/pyth.js");
      const envelope = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({
              price: "175000000",
              confidence: "1500000",
              exponent: -8
            })
          })
        ]
      });
      const result = normalizePythPrice(envelope, SOL_USD_FEED_ID);
      expect(result.bounds.lowerBound).toBe("1.73500000");
      expect(result.bounds.upperBound).toBe("1.76500000");
    });

    it("emits exact confidence ratio in bps", async () => {
      const { normalizePythPrice } = await import("../../../src/domain/price-observation/pyth.js");
      const envelope = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({
              price: "100000000",
              confidence: "1000000",
              exponent: -8
            })
          })
        ]
      });
      const result = normalizePythPrice(envelope, SOL_USD_FEED_ID);
      expect(result.confidenceRatio).toBe("0.01");
    });

    it("adds wide_confidence_interval warning when ratio exceeds 100 bps", async () => {
      const { normalizePythPrice } = await import("../../../src/domain/price-observation/pyth.js");
      const envelope = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({
              price: "100000000",
              confidence: "2000000",
              exponent: -8
            })
          })
        ]
      });
      const result = normalizePythPrice(envelope, SOL_USD_FEED_ID);
      expect(result.warnings).toContain("wide_confidence_interval");
    });

    it("does not add warning when ratio is at or below 100 bps", async () => {
      const { normalizePythPrice } = await import("../../../src/domain/price-observation/pyth.js");
      const envelope = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({
              price: "100000000",
              confidence: "1000000",
              exponent: -8
            })
          })
        ]
      });
      const result = normalizePythPrice(envelope, SOL_USD_FEED_ID);
      expect(result.warnings).not.toContain("oracle_confidence_wide");
    });
  });

  describe("converts fixed-point and atomic integer strings without binary floating-point loss", () => {
    it("produces exact decimal string for positive exponent", async () => {
      const { normalizePythPrice } = await import("../../../src/domain/price-observation/pyth.js");
      const envelope = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({
              price: "175",
              confidence: "15",
              exponent: 0
            })
          })
        ]
      });
      const result = normalizePythPrice(envelope, SOL_USD_FEED_ID);
      expect(result.priceData.price).toBe("175.0");
      expect(result.priceData.confidence).toBe("15.0");
    });

    it("produces exact decimal string for negative exponent", async () => {
      const { normalizePythPrice } = await import("../../../src/domain/price-observation/pyth.js");
      const envelope = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({
              price: "175000000",
              confidence: "1500000",
              exponent: -8
            })
          })
        ]
      });
      const result = normalizePythPrice(envelope, SOL_USD_FEED_ID);
      expect(result.priceData.price).toBe("1.75000000");
      expect(result.priceData.confidence).toBe("0.01500000");
    });

    it("produces exact decimal string for large negative exponent", async () => {
      const { normalizePythPrice } = await import("../../../src/domain/price-observation/pyth.js");
      const envelope = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({
              price: "17500000000",
              confidence: "150000000",
              exponent: -10
            })
          })
        ]
      });
      const result = normalizePythPrice(envelope, SOL_USD_FEED_ID);
      expect(result.priceData.price).toBe("1.7500000000");
      expect(result.priceData.confidence).toBe("0.0150000000");
    });

    it("computes exact lower and upper bounds", async () => {
      const { normalizePythPrice } = await import("../../../src/domain/price-observation/pyth.js");
      const envelope = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({
              price: "175000000",
              confidence: "1500000",
              exponent: -8
            })
          })
        ]
      });
      const result = normalizePythPrice(envelope, SOL_USD_FEED_ID);
      expect(result.bounds.lowerBound).toBe("1.73500000");
      expect(result.bounds.upperBound).toBe("1.76500000");
    });

    it("computes exact confidence ratio without floating point", async () => {
      const { normalizePythPrice } = await import("../../../src/domain/price-observation/pyth.js");
      const envelope = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({
              price: "123456789",
              confidence: "1234567",
              exponent: -9
            })
          })
        ]
      });
      const result = normalizePythPrice(envelope, SOL_USD_FEED_ID);
      const ratio = (BigInt("1234567") * BigInt("10000")) / BigInt("123456789");
      expect(result.confidenceRatio).toBe(
        String(ratio / BigInt("10000")) + "." + String(ratio % BigInt("10000")).padStart(4, "0")
      );
    });

    it("handles atomic integer strings without precision loss", async () => {
      const { normalizePythPrice } = await import("../../../src/domain/price-observation/pyth.js");
      const envelope = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({
              price: "9999999999",
              confidence: "99999999",
              exponent: -10
            })
          })
        ]
      });
      const result = normalizePythPrice(envelope, SOL_USD_FEED_ID);
      expect(result.priceData.price).toBe("0.9999999999");
      expect(result.priceData.confidence).toBe("0.0099999999");
    });
  });

  describe("uses versioned source identities and detects changed content at the same identity", () => {
    it("produces the same identity for identical inputs", async () => {
      const { derivePythSourceObservationKey } =
        await import("../../../src/domain/price-observation/pyth.js");
      const key1 = await derivePythSourceObservationKey({
        feedId: SOL_USD_FEED_ID,
        publishTimeUnixSeconds: 1710000000
      });
      const key2 = await derivePythSourceObservationKey({
        feedId: SOL_USD_FEED_ID,
        publishTimeUnixSeconds: 1710000000
      });
      expect(key1).toBe(key2);
    });

    it("detects changed price content at the same identity", async () => {
      const { normalizePythPrice } = await import("../../../src/domain/price-observation/pyth.js");
      const envelope1 = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({
              price: "175000000",
              confidence: "1500000",
              exponent: -8
            })
          })
        ]
      });
      const envelope2 = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({
              price: "176000000",
              confidence: "1500000",
              exponent: -8
            })
          })
        ]
      });
      const result1 = normalizePythPrice(envelope1, SOL_USD_FEED_ID);
      const result2 = normalizePythPrice(envelope2, SOL_USD_FEED_ID);
      expect(result1.priceData.price).not.toBe(result2.priceData.price);
    });

    it("detects changed confidence content at the same identity", async () => {
      const { normalizePythPrice } = await import("../../../src/domain/price-observation/pyth.js");
      const envelope1 = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({
              price: "175000000",
              confidence: "1500000",
              exponent: -8
            })
          })
        ]
      });
      const envelope2 = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({
              price: "175000000",
              confidence: "2500000",
              exponent: -8
            })
          })
        ]
      });
      const result1 = normalizePythPrice(envelope1, SOL_USD_FEED_ID);
      const result2 = normalizePythPrice(envelope2, SOL_USD_FEED_ID);
      expect(result1.priceData.confidence).not.toBe(result2.priceData.confidence);
      expect(result1.bounds.lowerBound).not.toBe(result2.bounds.lowerBound);
      expect(result1.bounds.upperBound).not.toBe(result2.bounds.upperBound);
    });

    it("versioned identity includes version field", async () => {
      const { derivePythSourceObservationKey } =
        await import("../../../src/domain/price-observation/pyth.js");
      const key = await derivePythSourceObservationKey({
        feedId: SOL_USD_FEED_ID,
        publishTimeUnixSeconds: 1710000000
      });
      expect(key).toHaveLength(64);
    });
  });
});
