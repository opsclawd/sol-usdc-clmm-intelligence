import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../../../src/ports/http.js";
import { HttpRequestError } from "../../../src/ports/http.js";
import { HttpBirdeyeFlowSource } from "../../../src/adapters/node/http-birdeye-flow-source.js";
import type { OnChainFlowSourceError } from "../../../src/ports/on-chain-flow-source.js";
import { FakeRetry } from "../../fakes/fake-retry.js";

const DEFAULT_POOL = "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE";
const DEFAULT_API_KEY = "birdeye-secret-key-123";

function makeTradeItem(txHash: string, fromSymbol: string, toSymbol: string, amountUsdc: number) {
  const isFromUsdc = fromSymbol === "USDC";
  return {
    txHash,
    source: "whirlpool",
    blockUnixTime: 1785277855,
    txType: "swap",
    address: DEFAULT_POOL,
    owner: "WalletAddress123",
    from: {
      symbol: fromSymbol,
      decimals: isFromUsdc ? 6 : 9,
      address: isFromUsdc
        ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        : "So11111111111111111111111111111111111111112",
      amount: amountUsdc * (isFromUsdc ? 1e6 : 1e9),
      uiAmount: amountUsdc,
      price: isFromUsdc ? 1.0 : 100.0
    },
    to: {
      symbol: toSymbol,
      decimals: isFromUsdc ? 9 : 6,
      address: isFromUsdc
        ? "So11111111111111111111111111111111111111112"
        : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amount: amountUsdc * (isFromUsdc ? 1e9 : 1e6),
      uiAmount: amountUsdc,
      price: isFromUsdc ? 100.0 : 1.0
    }
  };
}

function makeFullPage(prefix: string, fromSymbol = "SOL", toSymbol = "USDC") {
  return Array.from({ length: 50 }, (_, index) =>
    makeTradeItem(`${prefix}-${index}`, fromSymbol, toSymbol, 100)
  );
}

describe("HttpBirdeyeFlowSource pagination and page-level recovery", () => {
  it("requests Birdeye pages with limit 50 and advances offsets by 50 until hasNext is false", async () => {
    const page1Items = makeFullPage("page1", "SOL", "USDC");
    const page2Item = makeTradeItem("tx2", "USDC", "SOL", 500);

    const getJsonMock = vi
      .fn<HttpClient["getJson"]>()
      .mockResolvedValueOnce({
        data: { items: page1Items, hasNext: true },
        success: true
      })
      .mockResolvedValueOnce({
        data: { items: [page2Item], hasNext: false },
        success: true
      });

    const mockHttp = {
      getJson: getJsonMock,
      postJsonRaw: vi.fn()
    } as unknown as HttpClient;

    const source = new HttpBirdeyeFlowSource({
      http: mockHttp,
      url: "https://public-api.birdeye.so",
      apiKey: DEFAULT_API_KEY,
      poolAddress: DEFAULT_POOL,
      whaleSwapMinUsdc: "500"
    });

    const result = await source.collect({
      pair: "SOL/USDC",
      fromUnixMs: 1785270000000,
      toUnixMs: 1785280000000
    });

    expect(getJsonMock).toHaveBeenCalledTimes(2);

    const url1 = new URL(getJsonMock.mock.calls[0]![0]);
    expect(url1.searchParams.get("offset")).toBe("0");
    expect(url1.searchParams.get("limit")).toBe("50");

    const url2 = new URL(getJsonMock.mock.calls[1]![0]);
    expect(url2.searchParams.get("offset")).toBe("50");
    expect(url2.searchParams.get("limit")).toBe("50");

    const dexNetFlow = result.events.find((e) => e.eventKind === "dex_net_flow") as {
      sellVolumeUsdc: string;
      buyVolumeUsdc: string;
      netFlowUsdc: string;
    };
    expect(dexNetFlow.sellVolumeUsdc).toBe("5000");
    expect(dexNetFlow.buyVolumeUsdc).toBe("500");
    expect(dexNetFlow.netFlowUsdc).toBe("-4500");

    const whaleSwaps = result.events.filter((e) => e.eventKind === "whale_swap");
    expect(whaleSwaps).toHaveLength(1);
  });

  it("stops after an under-filled page even when hasNext is true", async () => {
    const getJsonMock = vi.fn<HttpClient["getJson"]>().mockResolvedValueOnce({
      data: { items: [makeTradeItem("partial-0", "SOL", "USDC", 100)], hasNext: true },
      success: true
    });

    const mockHttp = {
      getJson: getJsonMock,
      postJsonRaw: vi.fn()
    } as unknown as HttpClient;

    const source = new HttpBirdeyeFlowSource({
      http: mockHttp,
      url: "https://public-api.birdeye.so",
      apiKey: DEFAULT_API_KEY,
      poolAddress: DEFAULT_POOL,
      whaleSwapMinUsdc: "500"
    });

    const result = await source.collect({
      pair: "SOL/USDC",
      fromUnixMs: 1785270000000,
      toUnixMs: 1785280000000
    });

    expect(getJsonMock).toHaveBeenCalledTimes(1);

    const dexNetFlow = result.events.find((e) => e.eventKind === "dex_net_flow") as {
      sellVolumeUsdc: string;
      buyVolumeUsdc: string;
      netFlowUsdc: string;
    };
    expect(dexNetFlow.sellVolumeUsdc).toBe("100");
    expect(dexNetFlow.buyVolumeUsdc).toBe("0");
    expect(dexNetFlow.netFlowUsdc).toBe("-100");
  });

  it("continues after a full page when hasNext is true", async () => {
    const getJsonMock = vi
      .fn<HttpClient["getJson"]>()
      .mockResolvedValueOnce({
        data: { items: makeFullPage("full-first"), hasNext: true },
        success: true
      })
      .mockResolvedValueOnce({
        data: { items: [], hasNext: false },
        success: true
      });

    const mockHttp = {
      getJson: getJsonMock,
      postJsonRaw: vi.fn()
    } as unknown as HttpClient;

    const source = new HttpBirdeyeFlowSource({
      http: mockHttp,
      url: "https://public-api.birdeye.so",
      apiKey: DEFAULT_API_KEY,
      poolAddress: DEFAULT_POOL,
      whaleSwapMinUsdc: "500"
    });

    const result = await source.collect({
      pair: "SOL/USDC",
      fromUnixMs: 1785270000000,
      toUnixMs: 1785280000000
    });

    expect(getJsonMock).toHaveBeenCalledTimes(2);
    expect(new URL(getJsonMock.mock.calls[1]![0]).searchParams.get("offset")).toBe("50");

    const dexNetFlow = result.events.find((e) => e.eventKind === "dex_net_flow") as {
      sellVolumeUsdc: string;
    };
    expect(dexNetFlow.sellVolumeUsdc).toBe("5000");
  });

  it("stops after a full page when hasNext is false", async () => {
    const getJsonMock = vi.fn<HttpClient["getJson"]>().mockResolvedValueOnce({
      data: { items: makeFullPage("full-final"), hasNext: false },
      success: true
    });

    const mockHttp = {
      getJson: getJsonMock,
      postJsonRaw: vi.fn()
    } as unknown as HttpClient;

    const source = new HttpBirdeyeFlowSource({
      http: mockHttp,
      url: "https://public-api.birdeye.so",
      apiKey: DEFAULT_API_KEY,
      poolAddress: DEFAULT_POOL,
      whaleSwapMinUsdc: "500"
    });

    const result = await source.collect({
      pair: "SOL/USDC",
      fromUnixMs: 1785270000000,
      toUnixMs: 1785280000000
    });

    expect(getJsonMock).toHaveBeenCalledTimes(1);

    const dexNetFlow = result.events.find((e) => e.eventKind === "dex_net_flow") as {
      sellVolumeUsdc: string;
    };
    expect(dexNetFlow.sellVolumeUsdc).toBe("5000");
  });

  it("retries only the failed page at the same 50-trade offset", async () => {
    const page1Items = makeFullPage("page1", "SOL", "USDC");
    const page2Item = makeTradeItem("tx2", "USDC", "SOL", 500);

    const fakeRetry = new FakeRetry([0]);

    const getJsonMock = vi
      .fn<HttpClient["getJson"]>()
      // Page 1 (offset 0) succeeds
      .mockResolvedValueOnce({
        data: { items: page1Items, hasNext: true },
        success: true
      })
      // Page 2 (offset 50) attempt 1 fails with 500 error
      .mockRejectedValueOnce(
        new HttpRequestError("http_status", "500 Internal Server Error", 500, true)
      )
      // Page 2 (offset 50) attempt 2 succeeds
      .mockResolvedValueOnce({
        data: { items: [page2Item], hasNext: false },
        success: true
      });

    const mockHttp = {
      getJson: getJsonMock,
      postJsonRaw: vi.fn()
    } as unknown as HttpClient;

    const source = new HttpBirdeyeFlowSource({
      http: mockHttp,
      url: "https://public-api.birdeye.so",
      apiKey: DEFAULT_API_KEY,
      poolAddress: DEFAULT_POOL,
      whaleSwapMinUsdc: "500",
      maxAttempts: 2,
      retryControl: fakeRetry
    });

    const result = await source.collect({
      pair: "SOL/USDC",
      fromUnixMs: 1785270000000,
      toUnixMs: 1785280000000
    });

    expect(getJsonMock).toHaveBeenCalledTimes(3);

    expect(new URL(getJsonMock.mock.calls[0]![0]).searchParams.get("offset")).toBe("0");
    expect(new URL(getJsonMock.mock.calls[1]![0]).searchParams.get("offset")).toBe("50");
    expect(new URL(getJsonMock.mock.calls[2]![0]).searchParams.get("offset")).toBe("50");

    expect(fakeRetry.delays).toEqual([25]);

    const dexNetFlow = result.events.find((e) => e.eventKind === "dex_net_flow") as {
      sellVolumeUsdc: string;
      buyVolumeUsdc: string;
    };
    expect(dexNetFlow.sellVolumeUsdc).toBe("5000");
    expect(dexNetFlow.buyVolumeUsdc).toBe("500");
  });

  it("retries timeout 429 and 5xx responses up to maxAttempts", async () => {
    const timeoutErr = new HttpRequestError("timeout", "Request timed out", null, true);
    const rateLimitErr = new HttpRequestError("http_status", "Too Many Requests", 429, true, {
      responseHeaders: { "Retry-After": "1" }
    });
    const serverErr = new HttpRequestError("http_status", "Internal Server Error", 503, true);

    const cases = [
      { error: timeoutErr, expectedKind: "timeout", expectedDelays: [25, 50] },
      { error: rateLimitErr, expectedKind: "unavailable", expectedDelays: [1000, 1000] },
      { error: serverErr, expectedKind: "unavailable", expectedDelays: [25, 50] }
    ];

    for (const c of cases) {
      const fakeRetry = new FakeRetry([0, 0]);
      const getJsonMock = vi.fn<HttpClient["getJson"]>().mockRejectedValue(c.error);

      const mockHttp = {
        getJson: getJsonMock,
        postJsonRaw: vi.fn()
      } as unknown as HttpClient;

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: DEFAULT_API_KEY,
        poolAddress: DEFAULT_POOL,
        whaleSwapMinUsdc: "500",
        maxAttempts: 3,
        retryControl: fakeRetry
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
        expect(error.kind).toBe(c.expectedKind);
        expect(getJsonMock).toHaveBeenCalledTimes(3);
        expect(fakeRetry.delays).toEqual(c.expectedDelays);
      }
    }
  });

  it("does not retry malformed JSON or non-retryable 4xx responses", async () => {
    const malformedErr = new HttpRequestError(
      "invalid_json",
      "Response success is not true",
      null,
      false
    );
    const badRequestErr = new HttpRequestError("http_status", "Bad Request", 400, false);

    for (const err of [malformedErr, badRequestErr]) {
      const fakeRetry = new FakeRetry([0, 0]);
      const getJsonMock = vi.fn<HttpClient["getJson"]>().mockRejectedValue(err);

      const mockHttp = {
        getJson: getJsonMock,
        postJsonRaw: vi.fn()
      } as unknown as HttpClient;

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        apiKey: DEFAULT_API_KEY,
        poolAddress: DEFAULT_POOL,
        whaleSwapMinUsdc: "500",
        maxAttempts: 3,
        retryControl: fakeRetry
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
        expect(error.kind).toBe(err.kind === "invalid_json" ? "malformed" : "network");
        expect(getJsonMock).toHaveBeenCalledTimes(1);
        expect(fakeRetry.delays).toEqual([]);
      }
    }
  });

  it("redacts the Birdeye API key from exhausted retry diagnostics", async () => {
    const secretApiKey = "super-secret-birdeye-key-999";
    const httpErr = new HttpRequestError(
      "http_status",
      `Failed request to https://public-api.birdeye.so?apiKey=${secretApiKey}`,
      500,
      true
    );

    const fakeRetry = new FakeRetry([0]);
    const getJsonMock = vi.fn<HttpClient["getJson"]>().mockRejectedValue(httpErr);

    const mockHttp = {
      getJson: getJsonMock,
      postJsonRaw: vi.fn()
    } as unknown as HttpClient;

    const source = new HttpBirdeyeFlowSource({
      http: mockHttp,
      url: "https://public-api.birdeye.so",
      apiKey: secretApiKey,
      poolAddress: DEFAULT_POOL,
      whaleSwapMinUsdc: "500",
      maxAttempts: 2,
      retryControl: fakeRetry
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
      expect(error.diagnostic).toBe(
        "Failed request to https://public-api.birdeye.so?apiKey=[REDACTED]"
      );
      expect(error.diagnostic).not.toContain(secretApiKey);
    }
  });

  it("preserves 10000-trade capacity and fails closed after 200 continuing full pages", async () => {
    const getJsonMock = vi.fn<HttpClient["getJson"]>();
    for (let page = 0; page < 200; page++) {
      getJsonMock.mockResolvedValueOnce({
        data: {
          items: Array.from({ length: 50 }, (_, item) =>
            makeTradeItem(`tx-${page}-${item}`, "SOL", "USDC", 100)
          ),
          hasNext: true
        },
        success: true
      });
    }

    const mockHttp = {
      getJson: getJsonMock,
      postJsonRaw: vi.fn()
    } as unknown as HttpClient;

    const source = new HttpBirdeyeFlowSource({
      http: mockHttp,
      url: "https://public-api.birdeye.so",
      apiKey: DEFAULT_API_KEY,
      poolAddress: DEFAULT_POOL,
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
      expect(error.diagnostic).toBe("Birdeye pagination exceeded 200 pages");
      expect(getJsonMock).toHaveBeenCalledTimes(200);
    }
  });

  it("sends the pair address window swap type limit and Solana headers on every page", async () => {
    const page1Items = makeFullPage("page1", "SOL", "USDC");
    const page2Item = makeTradeItem("tx2", "USDC", "SOL", 500);

    const getJsonMock = vi
      .fn<HttpClient["getJson"]>()
      .mockResolvedValueOnce({
        data: { items: page1Items, hasNext: true },
        success: true
      })
      .mockResolvedValueOnce({
        data: { items: [page2Item], hasNext: false },
        success: true
      });

    const mockHttp = {
      getJson: getJsonMock,
      postJsonRaw: vi.fn()
    } as unknown as HttpClient;

    const source = new HttpBirdeyeFlowSource({
      http: mockHttp,
      url: "https://public-api.birdeye.so",
      apiKey: DEFAULT_API_KEY,
      poolAddress: DEFAULT_POOL,
      whaleSwapMinUsdc: "500"
    });

    await source.collect({
      pair: "SOL/USDC",
      fromUnixMs: 1785270000000,
      toUnixMs: 1785280000000
    });

    expect(getJsonMock).toHaveBeenCalledTimes(2);

    for (let i = 0; i < 2; i++) {
      const call = getJsonMock.mock.calls[i]!;
      const url = new URL(call[0]);
      const opts = call[1];

      expect(url.pathname).toBe("/defi/txs/pair");
      expect(url.searchParams.get("address")).toBe(DEFAULT_POOL);
      expect(url.searchParams.get("tx_type")).toBe("swap");
      expect(url.searchParams.get("after_time")).toBe("1785270000");
      expect(url.searchParams.get("before_time")).toBe("1785280000");
      expect(url.searchParams.get("limit")).toBe("50");
      expect(url.searchParams.get("offset")).toBe(String(i * 50));

      expect(opts?.headers).toEqual({
        "x-chain": "solana",
        "X-API-Key": DEFAULT_API_KEY
      });
    }
  });

  it("retries an explicit success false envelope at the same offset", async () => {
    const fakeRetry = new FakeRetry([0]);
    const getJsonMock = vi
      .fn<HttpClient["getJson"]>()
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({
        data: { items: [], hasNext: false },
        success: true
      });

    const mockHttp = {
      getJson: getJsonMock,
      postJsonRaw: vi.fn()
    } as unknown as HttpClient;

    const source = new HttpBirdeyeFlowSource({
      http: mockHttp,
      url: "https://public-api.birdeye.so",
      apiKey: DEFAULT_API_KEY,
      poolAddress: DEFAULT_POOL,
      whaleSwapMinUsdc: "500",
      maxAttempts: 2,
      retryControl: fakeRetry
    });

    await source.collect({
      pair: "SOL/USDC",
      fromUnixMs: 1785270000000,
      toUnixMs: 1785280000000
    });

    expect(getJsonMock).toHaveBeenCalledTimes(2);
    expect(new URL(getJsonMock.mock.calls[0]![0]).searchParams.get("offset")).toBe("0");
    expect(new URL(getJsonMock.mock.calls[1]![0]).searchParams.get("offset")).toBe("0");
    expect(fakeRetry.delays).toEqual([25]);
  });

  it("maps exhausted success false envelopes to network after maxAttempts", async () => {
    const fakeRetry = new FakeRetry([0]);
    const getJsonMock = vi.fn<HttpClient["getJson"]>().mockResolvedValue({ success: false });

    const mockHttp = {
      getJson: getJsonMock,
      postJsonRaw: vi.fn()
    } as unknown as HttpClient;

    const source = new HttpBirdeyeFlowSource({
      http: mockHttp,
      url: "https://public-api.birdeye.so",
      apiKey: DEFAULT_API_KEY,
      poolAddress: DEFAULT_POOL,
      whaleSwapMinUsdc: "500",
      maxAttempts: 2,
      retryControl: fakeRetry
    });

    const request = {
      pair: "SOL/USDC" as const,
      fromUnixMs: 1785270000000,
      toUnixMs: 1785280000000
    };

    await expect(source.collect(request)).rejects.toMatchObject({
      kind: "network",
      diagnostic: "Response success is false"
    });
    expect(getJsonMock).toHaveBeenCalledTimes(2);
    expect(fakeRetry.delays).toEqual([25]);
  });
});
