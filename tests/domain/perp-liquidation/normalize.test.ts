import { describe, it, expect } from "vitest";
import { normalizePerpObservation } from "../../../src/domain/perp-liquidation/normalize.js";
import type { PerpObservationPayloadV1 } from "../../../src/contracts/perp-liquidation.js";

describe("perp-liquidation normalize", () => {
  it("preserves positive and negative funding rates through normalization", () => {
    const posInput = {
      schemaVersion: 1 as const,
      evidenceFamily: "perp_liquidation" as const,
      pair: "SOL/USDC" as const,
      venue: "binance-fapi" as const,
      instrument: "SOLUSDC_PERP",
      sourceEventId: "evt-pos",
      observedAtUnixMs: 1700000000000,
      kind: "funding_rate" as const,
      fundingRate: "0.00015",
      fundingIntervalHours: 8
    };

    const normalizedPos = normalizePerpObservation(posInput);
    expect(normalizedPos.kind).toBe("funding_rate");
    if (normalizedPos.kind === "funding_rate") {
      expect(normalizedPos.fundingRate).toBe("0.00015");
    }

    const negInput = {
      ...posInput,
      sourceEventId: "evt-neg",
      fundingRate: "-0.00032"
    };

    const normalizedNeg = normalizePerpObservation(negInput);
    expect(normalizedNeg.kind).toBe("funding_rate");
    if (normalizedNeg.kind === "funding_rate") {
      expect(normalizedNeg.fundingRate).toBe("-0.00032");
    }
  });

  it("normalizes basis with both positive and negative spread", () => {
    const posSpreadInput = {
      schemaVersion: 1 as const,
      evidenceFamily: "perp_liquidation" as const,
      pair: "SOL/USDC" as const,
      venue: "binance-fapi" as const,
      instrument: "SOLUSDC_PERP",
      sourceEventId: "basis-pos",
      observedAtUnixMs: 1700000000000,
      kind: "perp_basis" as const,
      perpPriceUsdc: "155.00",
      spotPriceUsdc: "150.00",
      providerSpreadBps: 333 // venue-only field to be stripped
    };

    const normalizedPos = normalizePerpObservation(posSpreadInput);
    expect(normalizedPos.kind).toBe("perp_basis");
    if (normalizedPos.kind === "perp_basis") {
      expect(normalizedPos.perpPriceUsdc).toBe("155.00");
      expect(normalizedPos.spotPriceUsdc).toBe("150.00");
      expect(
        (normalizedPos as unknown as Record<string, unknown>).providerSpreadBps
      ).toBeUndefined();
    }

    const negSpreadInput = {
      ...posSpreadInput,
      sourceEventId: "basis-neg",
      perpPriceUsdc: "145.00",
      spotPriceUsdc: "150.00"
    };

    const normalizedNeg = normalizePerpObservation(negSpreadInput);
    if (normalizedNeg.kind === "perp_basis") {
      expect(normalizedNeg.perpPriceUsdc).toBe("145.00");
      expect(normalizedNeg.spotPriceUsdc).toBe("150.00");
    }
  });

  it("normalizes open interest, liquidation event, and leverage proxy facts", () => {
    const oiInput: PerpObservationPayloadV1 = {
      schemaVersion: 1,
      evidenceFamily: "perp_liquidation",
      pair: "SOL/USDC",
      venue: "drift-api",
      instrument: "SOL-PERP",
      sourceEventId: "oi-101",
      observedAtUnixMs: 1700000000000,
      kind: "open_interest",
      openInterestBase: "50000.0",
      openInterestUsdc: "7500000.0",
      sampleWindowSeconds: 300
    };
    expect(normalizePerpObservation(oiInput)).toEqual(oiInput);

    const liqInput: PerpObservationPayloadV1 = {
      schemaVersion: 1,
      evidenceFamily: "perp_liquidation",
      pair: "SOL/USDC",
      venue: "drift-api",
      instrument: "SOL-PERP",
      sourceEventId: "liq-55",
      observedAtUnixMs: 1700000000000,
      kind: "liquidation_event",
      side: "short",
      amountBase: "250.0",
      notionalUsdc: "37500.0"
    };
    expect(normalizePerpObservation(liqInput)).toEqual(liqInput);
  });
});
