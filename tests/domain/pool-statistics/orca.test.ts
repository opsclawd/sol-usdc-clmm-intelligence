import { describe, it, expect } from "vitest";
import {
  makeOrcaPoolResponse,
  DEFAULT_WHIRLPOOL_ADDRESS,
  DEFAULT_SOL_MINT,
  DEFAULT_USDC_MINT
} from "../../fixtures/orca-pool.js";
import {
  acceptOrcaPoolResponse,
  deriveOrcaSourceObservationKey,
  normalizeOrcaPoolStatistics,
  OrcaPoolValidationError
} from "../../../src/domain/pool-statistics/index.js";

describe("accepts only the configured Whirlpool and SOL USDC mint pair in either token order", () => {
  it("accepts when address and token order match default configured", () => {
    const response = makeOrcaPoolResponse();
    const { accepted } = acceptOrcaPoolResponse(
      response,
      DEFAULT_WHIRLPOOL_ADDRESS,
      DEFAULT_SOL_MINT,
      DEFAULT_USDC_MINT
    );
    expect(accepted.address).toBe(DEFAULT_WHIRLPOOL_ADDRESS);
  });

  it("accepts with reversed token order", () => {
    const response = makeOrcaPoolResponse({
      tokenA: { address: DEFAULT_USDC_MINT },
      tokenB: { address: DEFAULT_SOL_MINT }
    });
    const { accepted } = acceptOrcaPoolResponse(
      response,
      DEFAULT_WHIRLPOOL_ADDRESS,
      DEFAULT_SOL_MINT,
      DEFAULT_USDC_MINT
    );
    expect(accepted.address).toBe(DEFAULT_WHIRLPOOL_ADDRESS);
  });

  it("rejects on mismatched pool address", () => {
    const response = makeOrcaPoolResponse({ address: "differentAddress" });
    expect(() =>
      acceptOrcaPoolResponse(
        response,
        DEFAULT_WHIRLPOOL_ADDRESS,
        DEFAULT_SOL_MINT,
        DEFAULT_USDC_MINT
      )
    ).toThrow(OrcaPoolValidationError);
  });

  it("rejects on mismatched mints", () => {
    const response = makeOrcaPoolResponse({
      tokenA: { address: "differentMint" }
    });
    expect(() =>
      acceptOrcaPoolResponse(
        response,
        DEFAULT_WHIRLPOOL_ADDRESS,
        DEFAULT_SOL_MINT,
        DEFAULT_USDC_MINT
      )
    ).toThrow(OrcaPoolValidationError);
  });
});

describe("rejects invalid present metrics instead of silently dropping them", () => {
  it("rejects negative tvlUsdc", () => {
    const response = makeOrcaPoolResponse({ tvlUsdc: "-100.0" });
    expect(() =>
      acceptOrcaPoolResponse(
        response,
        DEFAULT_WHIRLPOOL_ADDRESS,
        DEFAULT_SOL_MINT,
        DEFAULT_USDC_MINT
      )
    ).toThrow(OrcaPoolValidationError);
  });

  it("rejects non-numeric tvlUsdc", () => {
    const response = makeOrcaPoolResponse({ tvlUsdc: "abc" });
    expect(() =>
      acceptOrcaPoolResponse(
        response,
        DEFAULT_WHIRLPOOL_ADDRESS,
        DEFAULT_SOL_MINT,
        DEFAULT_USDC_MINT
      )
    ).toThrow(OrcaPoolValidationError);
  });

  it("rejects non-numeric volume", () => {
    const response = makeOrcaPoolResponse({
      stats: {
        "24h": {
          volume: "abc",
          fees: "10"
        }
      }
    });
    expect(() =>
      acceptOrcaPoolResponse(
        response,
        DEFAULT_WHIRLPOOL_ADDRESS,
        DEFAULT_SOL_MINT,
        DEFAULT_USDC_MINT
      )
    ).toThrow(OrcaPoolValidationError);
  });

  it("rejects negative volume", () => {
    const response = makeOrcaPoolResponse({
      stats: {
        "24h": {
          volume: "-5.0",
          fees: "10"
        }
      }
    });
    expect(() =>
      acceptOrcaPoolResponse(
        response,
        DEFAULT_WHIRLPOOL_ADDRESS,
        DEFAULT_SOL_MINT,
        DEFAULT_USDC_MINT
      )
    ).toThrow(OrcaPoolValidationError);
  });

  it("rejects non-numeric fees", () => {
    const response = makeOrcaPoolResponse({
      stats: {
        "24h": {
          volume: "100.0",
          fees: "abc"
        }
      }
    });
    expect(() =>
      acceptOrcaPoolResponse(
        response,
        DEFAULT_WHIRLPOOL_ADDRESS,
        DEFAULT_SOL_MINT,
        DEFAULT_USDC_MINT
      )
    ).toThrow(OrcaPoolValidationError);
  });

  it("rejects negative fees", () => {
    const response = makeOrcaPoolResponse({
      stats: {
        "24h": {
          volume: "100.0",
          fees: "-10.0"
        }
      }
    });
    expect(() =>
      acceptOrcaPoolResponse(
        response,
        DEFAULT_WHIRLPOOL_ADDRESS,
        DEFAULT_SOL_MINT,
        DEFAULT_USDC_MINT
      )
    ).toThrow(OrcaPoolValidationError);
  });
});

describe("preserves explicit zero and represents absent optional metrics as null warnings", () => {
  it("preserves explicit zero", () => {
    const response = makeOrcaPoolResponse({
      tvlUsdc: "0.00",
      stats: {
        "24h": {
          volume: "0",
          fees: "0.0"
        }
      }
    });
    const { accepted } = acceptOrcaPoolResponse(
      response,
      DEFAULT_WHIRLPOOL_ADDRESS,
      DEFAULT_SOL_MINT,
      DEFAULT_USDC_MINT
    );
    const normalized = normalizeOrcaPoolStatistics({
      accepted,
      fetchedAtUnixMs: 1700000000000
    });
    expect(normalized.tvlUsdc).toBe("0.00");
    expect(normalized.volume24hUsdc).toBe("0");
    expect(normalized.fees24hUsdc).toBe("0.0");
    expect(normalized.warnings).toEqual([]);
  });

  it("represents absent optional metrics as null with warnings", () => {
    const response = makeOrcaPoolResponse({
      tvlUsdc: null,
      stats: null
    });
    const { accepted } = acceptOrcaPoolResponse(
      response,
      DEFAULT_WHIRLPOOL_ADDRESS,
      DEFAULT_SOL_MINT,
      DEFAULT_USDC_MINT
    );
    const normalized = normalizeOrcaPoolStatistics({
      accepted,
      fetchedAtUnixMs: 1700000000000
    });
    expect(normalized.tvlUsdc).toBeNull();
    expect(normalized.volume24hUsdc).toBeNull();
    expect(normalized.fees24hUsdc).toBeNull();
    expect(normalized.warnings).toEqual([
      "fees_24h_unavailable",
      "tvl_unavailable",
      "volume_24h_unavailable"
    ]);
  });
});

describe("uses address update time and slot as the replay identity while hashing the complete wrapper", () => {
  it("derives same observation key for same address/updatedAt/updatedSlot", async () => {
    const key1 = await deriveOrcaSourceObservationKey({
      poolAddress: DEFAULT_WHIRLPOOL_ADDRESS,
      updatedAt: "2026-07-19T06:00:00.000Z",
      updatedSlot: 1234567
    });
    const key2 = await deriveOrcaSourceObservationKey({
      poolAddress: DEFAULT_WHIRLPOOL_ADDRESS,
      updatedAt: "2026-07-19T06:00:00.000Z",
      updatedSlot: 1234567
    });
    expect(key1).toBe(key2);
  });

  it("derives different keys if slot changes", async () => {
    const key1 = await deriveOrcaSourceObservationKey({
      poolAddress: DEFAULT_WHIRLPOOL_ADDRESS,
      updatedAt: "2026-07-19T06:00:00.000Z",
      updatedSlot: 1234567
    });
    const key2 = await deriveOrcaSourceObservationKey({
      poolAddress: DEFAULT_WHIRLPOOL_ADDRESS,
      updatedAt: "2026-07-19T06:00:00.000Z",
      updatedSlot: 1234568
    });
    expect(key1).not.toBe(key2);
  });
});
