import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../../../src/ports/http.js";
import { HttpRequestError } from "../../../src/ports/http.js";
import { HttpBirdeyeFlowSource } from "../../../src/adapters/node/http-birdeye-flow-source.js";
import type { OnChainFlowSourceError } from "../../../src/ports/on-chain-flow-source.js";

function createMockHttpClient(body: unknown): HttpClient {
  return {
    getJson: vi.fn().mockResolvedValue(body),
    postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
  } as unknown as HttpClient;
}

describe("HttpBirdeyeFlowSource", () => {
  describe("maps the captured SOL-to-USDC trade to outbound whale and sell volume", () => {
    it("maps SOL-to-USDC trade to outbound whale and sell volume", async () => {
      const mockHttp = createMockHttpClient({
        data: {
          items: [
            {
              txHash:
                "3dtFPZCpAnafa4dz5gqDBK8FAmQuNV6pVwRyZCPXiDEaXLbwQRH7rByuyFWqAwVcTNm52QAs9FGVZcpAqgowu1qj",
              source: "whirlpool",
              blockUnixTime: 1785277855,
              txType: "swap",
              address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
              owner: "GoGoGo6N99mpyB7rfzhw2R4fXmaFctURXHaHMoGCyoLD",
              from: {
                symbol: "SOL",
                decimals: 9,
                address: "So11111111111111111111111111111111111111112",
                amount: 7990631926,
                uiAmount: 7.990631926,
                price: 73.809
              },
              to: {
                symbol: "USDC",
                decimals: 6,
                address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                amount: 589920174,
                uiAmount: 589.920174,
                price: 0.99977
              }
            }
          ],
          hasNext: false
        },
        success: true
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        fromUnixMs: 1785270000000,
        toUnixMs: 1785280000000
      });

      expect(result.providerId).toBe("birdeye-pair-trades");
      expect(result.source).toBe("birdeye-api");

      const dexNetFlow = result.events.find((e) => e.eventKind === "dex_net_flow");
      expect(dexNetFlow).toBeDefined();
      expect((dexNetFlow as { eventKind: string }).eventKind).toBe("dex_net_flow");

      const dexEvent = dexNetFlow as {
        sellVolumeUsdc: string;
        buyVolumeUsdc: string;
        netFlowUsdc: string;
        direction: string;
      };
      expect(dexEvent.sellVolumeUsdc).toBe("589.920174");
      expect(dexEvent.buyVolumeUsdc).toBe("0");
      expect(dexEvent.netFlowUsdc).toBe("-589.920174");
      expect(dexEvent.direction).toBe("outbound");

      const whaleSwap = result.events.find((e) => e.eventKind === "whale_swap");
      expect(whaleSwap).toBeDefined();
      const whaleEvent = whaleSwap as {
        direction: string;
        amountUsdc: string;
        addressContext: { address: string };
      };
      expect(whaleEvent.direction).toBe("outbound");
      expect(whaleEvent.amountUsdc).toBe("589.920174");
      expect(whaleEvent.addressContext.address).toBe(
        "GoGoGo6N99mpyB7rfzhw2R4fXmaFctURXHaHMoGCyoLD"
      );
    });
  });

  describe("maps USDC-to-SOL to inbound whale and buy volume", () => {
    it("maps USDC-to-SOL trade to inbound whale and buy volume", async () => {
      const mockHttp = createMockHttpClient({
        data: {
          items: [
            {
              txHash: "inbound-fixture-tx",
              source: "whirlpool",
              blockUnixTime: 1785277900,
              txType: "swap",
              address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
              owner: "InboundFixtureWallet",
              from: {
                symbol: "USDC",
                decimals: 6,
                address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                amount: 750000000,
                uiAmount: 750,
                price: 1.0
              },
              to: {
                symbol: "SOL",
                decimals: 9,
                address: "So11111111111111111111111111111111111111112",
                amount: 10000000000,
                uiAmount: 10,
                price: 75.0
              }
            }
          ],
          hasNext: false
        },
        success: true
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        fromUnixMs: 1785270000000,
        toUnixMs: 1785280000000
      });

      const dexNetFlow = result.events.find((e) => e.eventKind === "dex_net_flow");
      expect(dexNetFlow).toBeDefined();

      const dexEvent = dexNetFlow as {
        sellVolumeUsdc: string;
        buyVolumeUsdc: string;
        netFlowUsdc: string;
        direction: string;
      };
      expect(dexEvent.buyVolumeUsdc).toBe("750");
      expect(dexEvent.sellVolumeUsdc).toBe("0");
      expect(dexEvent.netFlowUsdc).toBe("750");
      expect(dexEvent.direction).toBe("inbound");

      const whaleSwap = result.events.find((e) => e.eventKind === "whale_swap");
      expect(whaleSwap).toBeDefined();
      const whaleEvent = whaleSwap as {
        direction: string;
        amountUsdc: string;
        addressContext: { address: string };
      };
      expect(whaleEvent.direction).toBe("inbound");
      expect(whaleEvent.amountUsdc).toBe("750");
      expect(whaleEvent.addressContext.address).toBe("InboundFixtureWallet");
    });
  });

  describe("includes a trade exactly at WHALE_SWAP_MIN_USDC and excludes one below it", () => {
    it("includes a trade exactly at threshold and excludes one below", async () => {
      const mockHttp = createMockHttpClient({
        data: {
          items: [
            {
              txHash: "exact-threshold-tx",
              source: "whirlpool",
              blockUnixTime: 1785278000,
              txType: "swap",
              address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
              owner: "ExactThresholdWallet",
              from: {
                symbol: "SOL",
                decimals: 9,
                address: "So11111111111111111111111111111111111111112",
                amount: 5000000000,
                uiAmount: 5,
                price: 100
              },
              to: {
                symbol: "USDC",
                decimals: 6,
                address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                amount: 500000000,
                uiAmount: 500,
                price: 1.0
              }
            },
            {
              txHash: "below-threshold-tx",
              source: "whirlpool",
              blockUnixTime: 1785278001,
              txType: "swap",
              address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
              owner: "BelowThresholdWallet",
              from: {
                symbol: "SOL",
                decimals: 9,
                address: "So11111111111111111111111111111111111111112",
                amount: 4990000000,
                uiAmount: 4.99,
                price: 100
              },
              to: {
                symbol: "USDC",
                decimals: 6,
                address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                amount: 499000000,
                uiAmount: 499,
                price: 1.0
              }
            }
          ],
          hasNext: false
        },
        success: true
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        fromUnixMs: 1785270000000,
        toUnixMs: 1785280000000
      });

      const whaleSwaps = result.events.filter((e) => e.eventKind === "whale_swap");
      expect(whaleSwaps).toHaveLength(1);

      const whaleEvent = whaleSwaps[0] as { addressContext: { address: string } };
      expect(whaleEvent.addressContext.address).toBe("ExactThresholdWallet");

      const dexNetFlow = result.events.find((e) => e.eventKind === "dex_net_flow");
      const dexEvent = dexNetFlow as { sellVolumeUsdc: string };
      expect(dexEvent.sellVolumeUsdc).toBe("999");
    });
  });

  describe("uses exact decimal arithmetic for the aggregate net flow", () => {
    it("uses exact decimal arithmetic for the aggregate net flow", async () => {
      const mockHttp = createMockHttpClient({
        data: {
          items: [
            {
              txHash: "trade1-tx",
              source: "whirlpool",
              blockUnixTime: 1785278100,
              txType: "swap",
              address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
              owner: "Wallet1",
              from: {
                symbol: "SOL",
                decimals: 9,
                address: "So11111111111111111111111111111111111111112",
                amount: 10000000000,
                uiAmount: 10,
                price: 100
              },
              to: {
                symbol: "USDC",
                decimals: 6,
                address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                amount: 1000000000,
                uiAmount: 1000,
                price: 1.0
              }
            },
            {
              txHash: "trade2-tx",
              source: "whirlpool",
              blockUnixTime: 1785278200,
              txType: "swap",
              address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
              owner: "Wallet2",
              from: {
                symbol: "USDC",
                decimals: 6,
                address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                amount: 750000000,
                uiAmount: 750,
                price: 1.0
              },
              to: {
                symbol: "SOL",
                decimals: 9,
                address: "So11111111111111111111111111111111111111112",
                amount: 7500000000,
                uiAmount: 7.5,
                price: 100
              }
            }
          ],
          hasNext: false
        },
        success: true
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        fromUnixMs: 1785270000000,
        toUnixMs: 1785280000000
      });

      const dexNetFlow = result.events.find((e) => e.eventKind === "dex_net_flow");
      const dexEvent = dexNetFlow as {
        buyVolumeUsdc: string;
        sellVolumeUsdc: string;
        netFlowUsdc: string;
      };
      expect(dexEvent.buyVolumeUsdc).toBe("750");
      expect(dexEvent.sellVolumeUsdc).toBe("1000");
      expect(dexEvent.netFlowUsdc).toBe("-250");

      const buyDecimal = dexEvent.buyVolumeUsdc;
      const sellDecimal = dexEvent.sellVolumeUsdc;
      const netDecimal = dexEvent.netFlowUsdc;

      const buyParts = buyDecimal.split(".");
      const sellParts = sellDecimal.split(".");
      const netParts = netDecimal.split(".");

      const maxScale = Math.max(
        buyParts[1]?.length ?? 0,
        sellParts[1]?.length ?? 0,
        netParts[1]?.length ?? 0
      );

      const alignAndParse = (val: string): bigint => {
        const parts = val.split(".");
        const digits =
          (parts[0] ?? "0") + (parts[1] ?? "") + "0".repeat(maxScale - (parts[1]?.length ?? 0));
        return BigInt(digits);
      };

      const buyInt = alignAndParse(buyDecimal);
      const sellInt = alignAndParse(sellDecimal);
      const netInt = alignAndParse(netDecimal);

      expect(buyInt - sellInt).toBe(netInt);
    });
  });

  describe("deduplicates repeated txHash records", () => {
    it("deduplicates repeated txHash records", async () => {
      const mockHttp = createMockHttpClient({
        data: {
          items: [
            {
              txHash: "duplicate-tx",
              source: "whirlpool",
              blockUnixTime: 1785278300,
              txType: "swap",
              address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
              owner: "DupWallet1",
              from: {
                symbol: "SOL",
                decimals: 9,
                address: "So11111111111111111111111111111111111111112",
                amount: 10000000000,
                uiAmount: 10,
                price: 100
              },
              to: {
                symbol: "USDC",
                decimals: 6,
                address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                amount: 1000000000,
                uiAmount: 1000,
                price: 1.0
              }
            },
            {
              txHash: "duplicate-tx",
              source: "whirlpool",
              blockUnixTime: 1785278300,
              txType: "swap",
              address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
              owner: "DupWallet1",
              from: {
                symbol: "SOL",
                decimals: 9,
                address: "So11111111111111111111111111111111111111112",
                amount: 10000000000,
                uiAmount: 10,
                price: 100
              },
              to: {
                symbol: "USDC",
                decimals: 6,
                address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                amount: 1000000000,
                uiAmount: 1000,
                price: 1.0
              }
            }
          ],
          hasNext: false
        },
        success: true
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        fromUnixMs: 1785270000000,
        toUnixMs: 1785280000000
      });

      const dexNetFlow = result.events.find((e) => e.eventKind === "dex_net_flow");
      const dexEvent = dexNetFlow as { sellVolumeUsdc: string };
      expect(dexEvent.sellVolumeUsdc).toBe("1000");

      const whaleSwaps = result.events.filter((e) => e.eventKind === "whale_swap");
      expect(whaleSwaps).toHaveLength(1);
    });
  });

  describe("returns a zero-volume aggregate for an empty successful page", () => {
    it("returns a zero-volume aggregate for an empty successful page", async () => {
      const mockHttp = createMockHttpClient({
        data: {
          items: [],
          hasNext: false
        },
        success: true
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        fromUnixMs: 1785270000000,
        toUnixMs: 1785280000000
      });

      expect(result.events).toHaveLength(1);

      const dexNetFlow = result.events[0];
      expect(dexNetFlow).toBeDefined();
      if (!dexNetFlow) throw new Error("dexNetFlow is undefined");
      expect(dexNetFlow.eventKind).toBe("dex_net_flow");

      const dexEvent = dexNetFlow as {
        buyVolumeUsdc: string;
        sellVolumeUsdc: string;
        netFlowUsdc: string;
      };
      expect(dexEvent.buyVolumeUsdc).toBe("0");
      expect(dexEvent.sellVolumeUsdc).toBe("0");
      expect(dexEvent.netFlowUsdc).toBe("0");
    });
  });

  describe("rejects an item whose token sides are not SOL and USDC", () => {
    it("rejects an item whose token sides are not SOL and USDC", async () => {
      const mockHttp = createMockHttpClient({
        data: {
          items: [
            {
              txHash: "unknown-pair-tx",
              source: "whirlpool",
              blockUnixTime: 1785278400,
              txType: "swap",
              address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
              owner: "UnknownWallet",
              from: {
                symbol: "BTC",
                decimals: 8,
                address: "BTC1111111111111111111111111111111111111111",
                amount: 100000000,
                uiAmount: 1,
                price: 50000
              },
              to: {
                symbol: "ETH",
                decimals: 18,
                address: "ETH1111111111111111111111111111111111111111",
                amount: 1000000000000000000,
                uiAmount: 1,
                price: 3000
              }
            }
          ],
          hasNext: false
        },
        success: true
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1785270000000,
          toUnixMs: 1785280000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("malformed");
      }
    });
  });

  describe("Birdeye adapter maps buy sell volumes and signed net flow for the requested window", () => {
    it("maps dex_net_flow event with buy, sell, and net flow values", async () => {
      const mockHttp = createMockHttpClient({
        data: {
          items: [
            {
              txHash: "trade1-tx",
              source: "whirlpool",
              blockUnixTime: 1785278500,
              txType: "swap",
              address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
              owner: "WalletA",
              from: {
                symbol: "SOL",
                decimals: 9,
                address: "So11111111111111111111111111111111111111112",
                amount: 20000000000,
                uiAmount: 20,
                price: 50
              },
              to: {
                symbol: "USDC",
                decimals: 6,
                address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                amount: 1000000000,
                uiAmount: 1000,
                price: 1.0
              }
            },
            {
              txHash: "trade2-tx",
              source: "whirlpool",
              blockUnixTime: 1785278600,
              txType: "swap",
              address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
              owner: "WalletB",
              from: {
                symbol: "USDC",
                decimals: 6,
                address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                amount: 1500000000,
                uiAmount: 1500,
                price: 1.0
              },
              to: {
                symbol: "SOL",
                decimals: 9,
                address: "So11111111111111111111111111111111111111112",
                amount: 30000000000,
                uiAmount: 30,
                price: 50
              }
            }
          ],
          hasNext: false
        },
        success: true
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        fromUnixMs: 1785270000000,
        toUnixMs: 1785280000000
      });

      expect(result.providerId).toBe("birdeye-pair-trades");
      expect(result.source).toBe("birdeye-api");

      const dexNetFlow = result.events.find((e) => e.eventKind === "dex_net_flow");
      expect(dexNetFlow).toBeDefined();

      const dexEvent = dexNetFlow as {
        buyVolumeUsdc: string;
        sellVolumeUsdc: string;
        netFlowUsdc: string;
        direction: string;
        windowStartUnixMs: number;
        windowEndUnixMs: number;
      };
      expect(dexEvent.buyVolumeUsdc).toBe("1500");
      expect(dexEvent.sellVolumeUsdc).toBe("1000");
      expect(dexEvent.netFlowUsdc).toBe("500");
      expect(dexEvent.direction).toBe("inbound");
      expect(dexEvent.windowStartUnixMs).toBe(1785270000000);
      expect(dexEvent.windowEndUnixMs).toBe(1785280000000);
    });

    it("rejects non-SOL/USDC pair", async () => {
      const mockHttp = createMockHttpClient({
        data: { items: [], hasNext: false },
        success: true
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      try {
        await source.collect({ pair: "SOL/USDT" } as unknown as {
          pair: "SOL/USDC";
          fromUnixMs: number;
          toUnixMs: number;
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("malformed");
      }
    });
  });

  describe("adapter rejects a malformed source envelope before application persistence", () => {
    it("throws malformed when response is not an object", async () => {
      const mockHttp = createMockHttpClient(null);

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1785270000000,
          toUnixMs: 1785280000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("malformed");
      }
    });

    it("throws malformed when success is not true", async () => {
      const mockHttp = createMockHttpClient({
        data: { items: [], hasNext: false },
        success: false
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1785270000000,
          toUnixMs: 1785280000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("malformed");
      }
    });

    it("throws malformed when data.items is missing", async () => {
      const mockHttp = createMockHttpClient({
        data: {},
        success: true
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1785270000000,
          toUnixMs: 1785280000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("malformed");
      }
    });

    it("throws malformed when an item has non-finite uiAmount", async () => {
      const mockHttp = createMockHttpClient({
        data: {
          items: [
            {
              txHash: "bad-amount-tx",
              source: "whirlpool",
              blockUnixTime: 1785278700,
              txType: "swap",
              address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
              owner: "BadAmountWallet",
              from: {
                symbol: "SOL",
                decimals: 9,
                address: "So11111111111111111111111111111111111111112",
                amount: 7990631926,
                uiAmount: Infinity,
                price: 73.809
              },
              to: {
                symbol: "USDC",
                decimals: 6,
                address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                amount: 589920174,
                uiAmount: 589.920174,
                price: 0.99977
              }
            }
          ],
          hasNext: false
        },
        success: true
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1785270000000,
          toUnixMs: 1785280000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("malformed");
      }
    });

    it("throws malformed when an item has negative uiAmount", async () => {
      const mockHttp = createMockHttpClient({
        data: {
          items: [
            {
              txHash: "negative-amount-tx",
              source: "whirlpool",
              blockUnixTime: 1785278800,
              txType: "swap",
              address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
              owner: "NegativeAmountWallet",
              from: {
                symbol: "SOL",
                decimals: 9,
                address: "So11111111111111111111111111111111111111112",
                amount: -7990631926,
                uiAmount: -7.990631926,
                price: 73.809
              },
              to: {
                symbol: "USDC",
                decimals: 6,
                address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                amount: -589920174,
                uiAmount: -589.920174,
                price: 0.99977
              }
            }
          ],
          hasNext: false
        },
        success: true
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1785270000000,
          toUnixMs: 1785280000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("malformed");
      }
    });

    it("throws malformed when an item is missing owner", async () => {
      const mockHttp = createMockHttpClient({
        data: {
          items: [
            {
              txHash: "no-owner-tx",
              source: "whirlpool",
              blockUnixTime: 1785278900,
              txType: "swap",
              address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
              from: {
                symbol: "SOL",
                decimals: 9,
                address: "So11111111111111111111111111111111111111112",
                amount: 7990631926,
                uiAmount: 7.990631926,
                price: 73.809
              },
              to: {
                symbol: "USDC",
                decimals: 6,
                address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                amount: 589920174,
                uiAmount: 589.920174,
                price: 0.99977
              }
            }
          ],
          hasNext: false
        },
        success: true
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1785270000000,
          toUnixMs: 1785280000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("malformed");
      }
    });

    it("throws malformed when an item is missing txHash", async () => {
      const mockHttp = createMockHttpClient({
        data: {
          items: [
            {
              source: "whirlpool",
              blockUnixTime: 1785279000,
              txType: "swap",
              address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
              owner: "NoHashWallet",
              from: {
                symbol: "SOL",
                decimals: 9,
                address: "So11111111111111111111111111111111111111112",
                amount: 7990631926,
                uiAmount: 7.990631926,
                price: 73.809
              },
              to: {
                symbol: "USDC",
                decimals: 6,
                address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                amount: 589920174,
                uiAmount: 589.920174,
                price: 0.99977
              }
            }
          ],
          hasNext: false
        },
        success: true
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1785270000000,
          toUnixMs: 1785280000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("malformed");
      }
    });

    it("throws malformed when an item is missing blockUnixTime", async () => {
      const mockHttp = createMockHttpClient({
        data: {
          items: [
            {
              txHash: "no-time-tx",
              source: "whirlpool",
              txType: "swap",
              address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
              owner: "NoTimeWallet",
              from: {
                symbol: "SOL",
                decimals: 9,
                address: "So11111111111111111111111111111111111111112",
                amount: 7990631926,
                uiAmount: 7.990631926,
                price: 73.809
              },
              to: {
                symbol: "USDC",
                decimals: 6,
                address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                amount: 589920174,
                uiAmount: 589.920174,
                price: 0.99977
              }
            }
          ],
          hasNext: false
        },
        success: true
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1785270000000,
          toUnixMs: 1785280000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("malformed");
      }
    });
  });

  describe("adapter retries retryable failures up to maxAttempts", () => {
    it("retries timeout errors up to maxAttempts", async () => {
      const mockHttp = {
        getJson: vi.fn().mockImplementation(async () => {
          throw new DOMException("Aborted", "AbortError");
        }),
        postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
      } as unknown as HttpClient;

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500",
        maxAttempts: 3
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1785270000000,
          toUnixMs: 1785280000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("timeout");
        expect(mockHttp.getJson).toHaveBeenCalledTimes(3);
      }
    });

    it("retries 429 rate limit errors up to maxAttempts", async () => {
      const mockHttp = {
        getJson: vi.fn().mockImplementation(async () => {
          throw new HttpRequestError("http_status", "Rate limited", 429, true);
        }),
        postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
      } as unknown as HttpClient;

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500",
        maxAttempts: 3
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1785270000000,
          toUnixMs: 1785280000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("unavailable");
        expect(mockHttp.getJson).toHaveBeenCalledTimes(3);
      }
    });

    it("retries 5xx server errors up to maxAttempts", async () => {
      const mockHttp = {
        getJson: vi.fn().mockImplementation(async () => {
          throw new HttpRequestError("http_status", "Server error", 500, true);
        }),
        postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
      } as unknown as HttpClient;

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500",
        maxAttempts: 3
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1785270000000,
          toUnixMs: 1785280000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("unavailable");
        expect(mockHttp.getJson).toHaveBeenCalledTimes(3);
      }
    });

    it("does not retry invalid JSON errors", async () => {
      const mockHttp = {
        getJson: vi.fn().mockImplementation(async () => {
          throw new HttpRequestError("invalid_json", "Unexpected end of JSON input", null, false);
        }),
        postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
      } as unknown as HttpClient;

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500",
        maxAttempts: 3
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1785270000000,
          toUnixMs: 1785280000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("malformed");
        expect(mockHttp.getJson).toHaveBeenCalledTimes(1);
      }
    });

    it("does not retry non-retryable 4xx errors", async () => {
      const mockHttp = {
        getJson: vi.fn().mockImplementation(async () => {
          throw new HttpRequestError("http_status", "Bad request", 400, false);
        }),
        postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
      } as unknown as HttpClient;

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500",
        maxAttempts: 3
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1785270000000,
          toUnixMs: 1785280000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("network");
        expect(mockHttp.getJson).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe("adapter redacts configured API keys from diagnostics", () => {
    it("redacts API key from timeout error diagnostic", async () => {
      const secretKey = "birdeye-super-secret-key-12345";
      const mockHttp = {
        getJson: vi.fn().mockImplementation(async () => {
          throw new DOMException("Aborted", "AbortError");
        }),
        postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
      } as unknown as HttpClient;

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: secretKey,
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1785270000000,
          toUnixMs: 1785280000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("timeout");
        expect(error.diagnostic).not.toContain(secretKey);
      }
    });

    it("redacts API key from network error diagnostic", async () => {
      const secretKey = "birdeye-super-secret-key-12345";
      const mockHttp = {
        getJson: vi.fn().mockImplementation(async () => {
          throw new TypeError("network error");
        }),
        postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
      } as unknown as HttpClient;

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: secretKey,
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1785270000000,
          toUnixMs: 1785280000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("network");
        expect(error.diagnostic).not.toContain(secretKey);
      }
    });

    it("redacts API key from 503 error diagnostic", async () => {
      const secretKey = "birdeye-super-secret-key-12345";
      const mockHttp = {
        getJson: vi.fn().mockImplementation(async () => {
          throw new HttpRequestError("http_status", "Service unavailable", 503, true);
        }),
        postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
      } as unknown as HttpClient;

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: secretKey,
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1785270000000,
          toUnixMs: 1785280000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("unavailable");
        expect(error.diagnostic).not.toContain(secretKey);
      }
    });
  });

  describe("adapter sends correct request headers and URL", () => {
    it("sends X-API-Key and x-chain headers", async () => {
      const mockHttp = createMockHttpClient({
        data: { items: [], hasNext: false },
        success: true
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret-key",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      await source.collect({
        pair: "SOL/USDC",
        fromUnixMs: 1785270000000,
        toUnixMs: 1785280000000
      });

      expect(mockHttp.getJson).toHaveBeenCalledWith(
        expect.stringContaining("https://public-api.birdeye.so/defi/txs/pair"),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-API-Key": "birdeye-secret-key",
            "x-chain": "solana"
          })
        })
      );
    });

    it("sends correct query parameters", async () => {
      const mockHttp = createMockHttpClient({
        data: { items: [], hasNext: false },
        success: true
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret-key",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      await source.collect({
        pair: "SOL/USDC",
        fromUnixMs: 1785270000000,
        toUnixMs: 1785280000000
      });

      expect(mockHttp.getJson).toHaveBeenCalledWith(
        expect.stringContaining("address=Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE"),
        expect.anything()
      );
      expect(mockHttp.getJson).toHaveBeenCalledWith(
        expect.stringContaining("tx_type=swap"),
        expect.anything()
      );
      expect(mockHttp.getJson).toHaveBeenCalledWith(
        expect.stringContaining("offset=0"),
        expect.anything()
      );
      expect(mockHttp.getJson).toHaveBeenCalledWith(
        expect.stringContaining("limit=50"),
        expect.anything()
      );
      expect(mockHttp.getJson).toHaveBeenCalledWith(
        expect.stringContaining("after_time=1785270"),
        expect.anything()
      );
      expect(mockHttp.getJson).toHaveBeenCalledWith(
        expect.stringContaining("before_time=1785280"),
        expect.anything()
      );
    });

    it("sends no X-API-Key header when apiKey is not provided", async () => {
      const mockHttp = createMockHttpClient({
        data: { items: [], hasNext: false },
        success: true
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      await source.collect({
        pair: "SOL/USDC",
        fromUnixMs: 1785270000000,
        toUnixMs: 1785280000000
      });

      expect(mockHttp.getJson).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: expect.not.objectContaining({
            "X-API-Key": expect.anything()
          })
        })
      );
    });

    it("handles uiAmount with precision beyond targetScale by truncating without RangeError", async () => {
      const mockHttp = createMockHttpClient({
        data: {
          items: [
            {
              txHash: "over-precision-tx",
              source: "whirlpool",
              blockUnixTime: 1785278800,
              txType: "swap",
              address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
              owner: "OverPrecisionWallet",
              from: {
                symbol: "SOL",
                decimals: 9,
                address: "So11111111111111111111111111111111111111112",
                amount: 7990631926,
                uiAmount: 7.990631926,
                price: 73.809
              },
              to: {
                symbol: "USDC",
                decimals: 6,
                address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                amount: 589920174,
                uiAmount: 589.920174123456,
                price: 0.99977
              }
            }
          ],
          hasNext: false
        },
        success: true
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        fromUnixMs: 1785270000000,
        toUnixMs: 1785280000000
      });

      const dexNetFlow = result.events.find((e) => e.eventKind === "dex_net_flow") as {
        sellVolumeUsdc: string;
      };
      expect(dexNetFlow.sellVolumeUsdc).toBe("589.920174");

      const whaleSwap = result.events.find((e) => e.eventKind === "whale_swap") as {
        amountUsdc: string;
      };
      expect(whaleSwap.amountUsdc).toBe("589.920174");
    });

    it("formats whale swap amounts using normalized BigInt decimal arithmetic to prevent floating-point artifacts", async () => {
      const mockHttp = createMockHttpClient({
        data: {
          items: [
            {
              txHash: "float-artifact-tx",
              source: "whirlpool",
              blockUnixTime: 1785278900,
              txType: "swap",
              address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
              owner: "FloatArtifactWallet",
              from: {
                symbol: "SOL",
                decimals: 9,
                address: "So11111111111111111111111111111111111111112",
                amount: 7990631926,
                uiAmount: 7.990631926,
                price: 73.809
              },
              to: {
                symbol: "USDC",
                decimals: 6,
                address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                amount: 589920174,
                uiAmount: 589.9201740000001,
                price: 0.99977
              }
            }
          ],
          hasNext: false
        },
        success: true
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        fromUnixMs: 1785270000000,
        toUnixMs: 1785280000000
      });

      const whaleSwap = result.events.find((e) => e.eventKind === "whale_swap") as {
        amountUsdc: string;
      };
      expect(whaleSwap.amountUsdc).toBe("589.920174");
    });
  });

  describe("paginates trades using offset and hasNext", () => {
    it("fetches multiple pages incrementing offset by limit until hasNext is false", async () => {
      const page1Items = Array.from({ length: 100 }, (_, i) => ({
        txHash: `hash-${i}`,
        source: "whirlpool",
        blockUnixTime: 1785278000 + i,
        txType: "swap",
        address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        owner: `Wallet-${i}`,
        from: {
          symbol: "SOL",
          decimals: 9,
          address: "So11111111111111111111111111111111111111112",
          amount: 1000000000,
          uiAmount: 1,
          price: 100
        },
        to: {
          symbol: "USDC",
          decimals: 6,
          address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          amount: 100000000,
          uiAmount: 100,
          price: 1.0
        }
      }));

      const page2Items = [
        {
          txHash: "hash-page2",
          source: "whirlpool",
          blockUnixTime: 1785278200,
          txType: "swap",
          address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
          owner: "Wallet-Page2",
          from: {
            symbol: "USDC",
            decimals: 6,
            address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            amount: 200000000,
            uiAmount: 200,
            price: 1.0
          },
          to: {
            symbol: "SOL",
            decimals: 9,
            address: "So11111111111111111111111111111111111111112",
            amount: 2000000000,
            uiAmount: 2,
            price: 100
          }
        }
      ];

      const getJson = vi
        .fn()
        .mockResolvedValueOnce({
          data: { items: page1Items, hasNext: true },
          success: true
        })
        .mockResolvedValueOnce({
          data: { items: page2Items, hasNext: false },
          success: true
        });

      const mockHttp = {
        getJson,
        postJsonRaw: vi.fn()
      } as unknown as HttpClient;

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: "birdeye-secret",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500"
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        fromUnixMs: 1785270000000,
        toUnixMs: 1785280000000
      });

      expect(getJson).toHaveBeenCalledTimes(2);
      expect(getJson).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("offset=0"),
        expect.anything()
      );
      expect(getJson).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("offset=50"),
        expect.anything()
      );

      const dexNetFlow = result.events.find((e) => e.eventKind === "dex_net_flow") as {
        sellVolumeUsdc: string;
        buyVolumeUsdc: string;
        netFlowUsdc: string;
      };

      // 100 trades selling 100 USDC = 10,000 sell volume
      expect(dexNetFlow.sellVolumeUsdc).toBe("10000");
      // 1 trade buying 200 USDC = 200 buy volume
      expect(dexNetFlow.buyVolumeUsdc).toBe("200");
      expect(dexNetFlow.netFlowUsdc).toBe("-9800");
    });
  });
});
