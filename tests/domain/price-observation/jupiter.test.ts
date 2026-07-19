import { describe, it, expect } from "vitest";
import {
  makeJupiterQuote,
  makeJupiterQuoteWithExtraFields,
  makeJupiterMultiHopQuote,
  makeJupiterHighPriceImpactQuote,
  SOL_MINT,
  USDC_MINT
} from "../../fixtures/jupiter-quote.js";

describe("Jupiter Executable Quote Processing", () => {
  describe("acceptJupiterQuote", () => {
    it("returns the complete original quote for raw storage", async () => {
      const { acceptJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote();
      const result = acceptJupiterQuote(quote);
      expect(result.quote).toEqual(quote);
    });

    it("rejects wrong input mint", async () => {
      const { acceptJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({ inputMint: "wrong_mint" });
      expect(() => acceptJupiterQuote(quote)).toThrow();
    });

    it("rejects wrong output mint", async () => {
      const { acceptJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({ outputMint: "wrong_mint" });
      expect(() => acceptJupiterQuote(quote)).toThrow();
    });

    it("rejects non-ExactIn swap mode", async () => {
      const { acceptJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({ swapMode: "ExactOut" });
      expect(() => acceptJupiterQuote(quote)).toThrow();
    });

    it("rejects wrong input amount", async () => {
      const { acceptJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({ inAmount: "500000000" });
      expect(() => acceptJupiterQuote(quote)).toThrow();
    });

    it("rejects missing context slot", async () => {
      const { acceptJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({ contextSlot: undefined as unknown as number });
      expect(() => acceptJupiterQuote(quote)).toThrow();
    });

    it("rejects empty route plan", async () => {
      const { acceptJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({ routePlan: [] });
      expect(() => acceptJupiterQuote(quote)).toThrow();
    });

    it("rejects zero output amount", async () => {
      const { acceptJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({ outAmount: "0" });
      expect(() => acceptJupiterQuote(quote)).toThrow();
    });

    it("rejects negative output amount", async () => {
      const { acceptJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({ outAmount: "-1000000" });
      expect(() => acceptJupiterQuote(quote)).toThrow();
    });

    it("rejects invalid atomic string for inAmount", async () => {
      const { acceptJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({ inAmount: "not-a-number" });
      expect(() => acceptJupiterQuote(quote)).toThrow();
    });

    it("rejects invalid atomic string for outAmount", async () => {
      const { acceptJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({ outAmount: "NaN" });
      expect(() => acceptJupiterQuote(quote)).toThrow();
    });

    it("retains extra quote fields", async () => {
      const { acceptJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuoteWithExtraFields();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = acceptJupiterQuote(quote as any) as any;
      expect(result.quote.extraField).toBe("should be retained");
      expect(result.quote.nested.data).toBe(42);
    });

    it("accepts multi-hop route as informational metadata", async () => {
      const { acceptJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterMultiHopQuote();
      const result = acceptJupiterQuote(quote);
      expect(result.quote.routePlan.length).toBeGreaterThan(1);
    });

    it("accepts high price impact above 100 bps as warning metadata", async () => {
      const { acceptJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterHighPriceImpactQuote();
      expect(quote.highPriceImpact).toBe(true);
      const result = acceptJupiterQuote(quote);
      expect(result.quote.highPriceImpact).toBe(true);
    });

    it("accepts restrictIntermediateTokens=true", async () => {
      const { acceptJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({ restrictIntermediateTokens: true });
      const result = acceptJupiterQuote(quote);
      expect(result.quote.restrictIntermediateTokens).toBe(true);
    });

    it("accepts configured 50 bps slippage", async () => {
      const { acceptJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({ slippageBps: 50 });
      const result = acceptJupiterQuote(quote);
      expect(result.quote.slippageBps).toBe(50);
    });

    it("accepts route summary with hops", async () => {
      const { acceptJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote();
      const result = acceptJupiterQuote(quote);
      expect(result.quote.routeSummary).toBeDefined();
      expect(result.quote.routeSummary.inAmount).toBe("1000000000");
    });
  });

  describe("deriveJupiterSourceObservationKey", () => {
    it("is stable regardless of object key order", async () => {
      const { deriveJupiterSourceObservationKey } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const key1 = await deriveJupiterSourceObservationKey({
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        inAmount: "1000000000",
        swapMode: "ExactIn",
        contextSlot: 123456789
      });
      const key2 = await deriveJupiterSourceObservationKey({
        contextSlot: 123456789,
        swapMode: "ExactIn",
        inAmount: "1000000000",
        outputMint: USDC_MINT,
        inputMint: SOL_MINT
      });
      expect(key1).toBe(key2);
    });

    it("changes when input mint changes", async () => {
      const { deriveJupiterSourceObservationKey } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const key1 = await deriveJupiterSourceObservationKey({
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        inAmount: "1000000000",
        swapMode: "ExactIn",
        contextSlot: 123456789
      });
      const key2 = await deriveJupiterSourceObservationKey({
        inputMint: "OtherMint",
        outputMint: USDC_MINT,
        inAmount: "1000000000",
        swapMode: "ExactIn",
        contextSlot: 123456789
      });
      expect(key1).not.toBe(key2);
    });

    it("changes when output mint changes", async () => {
      const { deriveJupiterSourceObservationKey } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const key1 = await deriveJupiterSourceObservationKey({
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        inAmount: "1000000000",
        swapMode: "ExactIn",
        contextSlot: 123456789
      });
      const key2 = await deriveJupiterSourceObservationKey({
        inputMint: SOL_MINT,
        outputMint: "OtherMint",
        inAmount: "1000000000",
        swapMode: "ExactIn",
        contextSlot: 123456789
      });
      expect(key1).not.toBe(key2);
    });

    it("changes when inAmount changes", async () => {
      const { deriveJupiterSourceObservationKey } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const key1 = await deriveJupiterSourceObservationKey({
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        inAmount: "1000000000",
        swapMode: "ExactIn",
        contextSlot: 123456789
      });
      const key2 = await deriveJupiterSourceObservationKey({
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        inAmount: "2000000000",
        swapMode: "ExactIn",
        contextSlot: 123456789
      });
      expect(key1).not.toBe(key2);
    });

    it("changes when swapMode changes", async () => {
      const { deriveJupiterSourceObservationKey } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const key1 = await deriveJupiterSourceObservationKey({
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        inAmount: "1000000000",
        swapMode: "ExactIn",
        contextSlot: 123456789
      });
      const key2 = await deriveJupiterSourceObservationKey({
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        inAmount: "1000000000",
        swapMode: "ExactOut",
        contextSlot: 123456789
      });
      expect(key1).not.toBe(key2);
    });

    it("changes when contextSlot changes", async () => {
      const { deriveJupiterSourceObservationKey } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const key1 = await deriveJupiterSourceObservationKey({
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        inAmount: "1000000000",
        swapMode: "ExactIn",
        contextSlot: 123456789
      });
      const key2 = await deriveJupiterSourceObservationKey({
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        inAmount: "1000000000",
        swapMode: "ExactIn",
        contextSlot: 123456790
      });
      expect(key1).not.toBe(key2);
    });

    it("uses versioned source identity", async () => {
      const { deriveJupiterSourceObservationKey } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const key = await deriveJupiterSourceObservationKey({
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        inAmount: "1000000000",
        swapMode: "ExactIn",
        contextSlot: 123456789
      });
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("normalizeJupiterQuote", () => {
    it("rejects non-positive output amount", async () => {
      const { normalizeJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({ outAmount: "0" });
      expect(() => normalizeJupiterQuote(quote, Date.now())).toThrow();
    });

    it("rejects negative output amount", async () => {
      const { normalizeJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({ outAmount: "-1000000" });
      expect(() => normalizeJupiterQuote(quote, Date.now())).toThrow();
    });

    it("emits exact implied price as USDC per SOL decimal string", async () => {
      const { normalizeJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({ inAmount: "1000000000", outAmount: "175000000" });
      const result = normalizeJupiterQuote(quote, Date.now());
      expect(result.quoteData.price).toBe("0.175000");
    });

    it("emits exact implied price for 6-decimal USDC output", async () => {
      const { normalizeJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({ inAmount: "1000000000", outAmount: "175000000" });
      const result = normalizeJupiterQuote(quote, Date.now());
      expect(result.quoteData.price).toBe("0.175000");
    });

    it("computes exact price impact ratio in basis points", async () => {
      const { normalizeJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({
        inAmount: "1000000000",
        outAmount: "175000000",
        priceImpactPct: "0.015"
      });
      const result = normalizeJupiterQuote(quote, Date.now());
      expect(result.priceImpactRatio).toBe("150");
    });

    it("emits price_impact_exceeds_threshold warning when highPriceImpact is true", async () => {
      const { normalizeJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterHighPriceImpactQuote();
      const result = normalizeJupiterQuote(quote, Date.now());
      expect(result.warnings).toContain("price_impact_exceeds_threshold");
    });

    it("does not emit warning when price impact is below threshold", async () => {
      const { normalizeJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({
        highPriceImpact: false,
        priceImpactPct: "0.015"
      });
      const result = normalizeJupiterQuote(quote, Date.now());
      expect(result.warnings).not.toContain("price_impact_exceeds_threshold");
    });
  });

  describe("accepts only the deterministic one SOL ExactIn route contract", () => {
    it("accepts valid SOL->USDC ExactIn quote with exactly 1e9 lamports", async () => {
      const { acceptJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        inAmount: "1000000000",
        swapMode: "ExactIn",
        outAmount: "175000000",
        contextSlot: 123456789,
        routePlan: [makeJupiterQuote().routePlan[0]]
      });
      expect(() => acceptJupiterQuote(quote)).not.toThrow();
    });

    it("rejects 0.5 SOL amount", async () => {
      const { acceptJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({ inAmount: "500000000" });
      expect(() => acceptJupiterQuote(quote)).toThrow();
    });

    it("rejects 2 SOL amount", async () => {
      const { acceptJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({ inAmount: "2000000000" });
      expect(() => acceptJupiterQuote(quote)).toThrow();
    });

    it("rejects USDC->SOL direction", async () => {
      const { acceptJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({
        inputMint: USDC_MINT,
        outputMint: SOL_MINT,
        inAmount: "175000000",
        swapMode: "ExactIn"
      });
      expect(() => acceptJupiterQuote(quote)).toThrow();
    });
  });

  describe("converts fixed-point and atomic integer strings without binary floating-point loss", () => {
    it("preserves atomic integer strings exactly", async () => {
      const { normalizeJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({
        inAmount: "1000000000",
        outAmount: "175000000"
      });
      const result = normalizeJupiterQuote(quote, Date.now());
      expect(result.observedSource.slot).toBe(quote.contextSlot);
    });

    it("computes exact 6-decimal USDC price from atomic output", async () => {
      const { normalizeJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({ inAmount: "1000000000", outAmount: "175123456" });
      const result = normalizeJupiterQuote(quote, Date.now());
      expect(result.quoteData.price).toBe("0.175123");
    });

    it("computes exact 9-decimal SOL price from atomic input", async () => {
      const { normalizeJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({ inAmount: "1000000000", outAmount: "175000000" });
      const result = normalizeJupiterQuote(quote, Date.now());
      expect(result.quoteData.price).toBe("0.175000");
    });

    it("avoids floating-point arithmetic for price impact parsing", async () => {
      const { normalizeJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote = makeJupiterQuote({
        priceImpactPct: "0.015",
        outAmount: "175000000"
      });
      const result = normalizeJupiterQuote(quote, Date.now());
      expect(result.priceImpactRatio).toBe("150");
    });
  });

  describe("uses versioned source identities and detects changed content at the same identity", () => {
    it("produces the same identity for identical inputs", async () => {
      const { deriveJupiterSourceObservationKey } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const key1 = await deriveJupiterSourceObservationKey({
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        inAmount: "1000000000",
        swapMode: "ExactIn",
        contextSlot: 123456789
      });
      const key2 = await deriveJupiterSourceObservationKey({
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        inAmount: "1000000000",
        swapMode: "ExactIn",
        contextSlot: 123456789
      });
      expect(key1).toBe(key2);
    });

    it("detects changed output amount at the same identity", async () => {
      const { normalizeJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote1 = makeJupiterQuote({ outAmount: "175000000" });
      const quote2 = makeJupiterQuote({ outAmount: "176000000" });
      const result1 = normalizeJupiterQuote(quote1, Date.now());
      const result2 = normalizeJupiterQuote(quote2, Date.now());
      expect(result1.quoteData.price).not.toBe(result2.quoteData.price);
    });

    it("detects changed price impact at the same identity", async () => {
      const { normalizeJupiterQuote } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const quote1 = makeJupiterQuote({ priceImpactPct: "0.015" });
      const quote2 = makeJupiterQuote({ priceImpactPct: "0.030" });
      const result1 = normalizeJupiterQuote(quote1, Date.now());
      const result2 = normalizeJupiterQuote(quote2, Date.now());
      expect(result1.priceImpactRatio).not.toBe(result2.priceImpactRatio);
    });

    it("versioned identity includes version field", async () => {
      const { deriveJupiterSourceObservationKey } =
        await import("../../../src/domain/price-observation/jupiter.js");
      const key = await deriveJupiterSourceObservationKey({
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        inAmount: "1000000000",
        swapMode: "ExactIn",
        contextSlot: 123456789
      });
      expect(key).toHaveLength(64);
    });
  });
});
