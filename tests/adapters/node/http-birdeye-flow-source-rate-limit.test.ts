import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../../../src/ports/http.js";
import { HttpRequestError } from "../../../src/ports/http.js";
import { HttpBirdeyeFlowSource } from "../../../src/adapters/node/http-birdeye-flow-source.js";
import { FakeRetry } from "../../fakes/fake-retry.js";

function rateLimitError(responseHeaders?: Readonly<Record<string, string>>): HttpRequestError {
  return new HttpRequestError(
    "http_status",
    "Rate limited",
    429,
    true,
    responseHeaders !== undefined ? { responseHeaders } : undefined
  );
}

describe("HttpBirdeyeFlowSource rate limiting", () => {
  const request = {
    pair: "SOL/USDC" as const,
    fromUnixMs: 1785270000000,
    toUnixMs: 1785280000000
  };

  const emptySuccessEnvelope = {
    data: {
      items: [],
      hasNext: false
    },
    success: true
  };

  it("retries a 429 after Retry-After delta seconds", async () => {
    const mockHttp = {
      getJson: vi
        .fn()
        .mockRejectedValueOnce(rateLimitError({ "Retry-After": "12" }))
        .mockResolvedValueOnce(emptySuccessEnvelope),
      postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
    } as unknown as HttpClient;

    const fakeRetry = new FakeRetry();
    const source = new HttpBirdeyeFlowSource({
      http: mockHttp,
      url: "https://public-api.birdeye.so",
      poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
      whaleSwapMinUsdc: "500",
      maxAttempts: 2,
      retryControl: fakeRetry
    });

    const result = await source.collect(request);

    expect(result.providerId).toBe("birdeye-pair-trades");
    expect(mockHttp.getJson).toHaveBeenCalledTimes(2);
    expect(fakeRetry.delays).toEqual([12_000]);
  });

  it("retries a 429 after Retry-After HTTP-date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
    try {
      const mockHttp = {
        getJson: vi
          .fn()
          .mockRejectedValueOnce(rateLimitError({ "Retry-After": "Wed, 29 Jul 2026 12:00:30 GMT" }))
          .mockResolvedValueOnce(emptySuccessEnvelope),
        postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
      } as unknown as HttpClient;

      const fakeRetry = new FakeRetry();
      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500",
        maxAttempts: 2,
        retryControl: fakeRetry
      });

      const result = await source.collect(request);

      expect(result.providerId).toBe("birdeye-pair-trades");
      expect(mockHttp.getJson).toHaveBeenCalledTimes(2);
      expect(fakeRetry.delays).toEqual([30_000]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses X-RateLimit-Reset when Retry-After is absent", async () => {
    vi.useFakeTimers();
    const nowSec = 1_785_326_400;
    vi.setSystemTime(nowSec * 1000);
    try {
      const mockHttp = {
        getJson: vi
          .fn()
          .mockRejectedValueOnce(rateLimitError({ "X-RateLimit-Reset": String(nowSec + 45) }))
          .mockResolvedValueOnce(emptySuccessEnvelope),
        postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
      } as unknown as HttpClient;

      const fakeRetry = new FakeRetry();
      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500",
        maxAttempts: 2,
        retryControl: fakeRetry
      });

      const result = await source.collect(request);

      expect(result.providerId).toBe("birdeye-pair-trades");
      expect(mockHttp.getJson).toHaveBeenCalledTimes(2);
      expect(fakeRetry.delays).toEqual([45_000]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("prefers Retry-After when both rate-limit headers are present", async () => {
    vi.useFakeTimers();
    const nowSec = 1_785_326_400;
    vi.setSystemTime(nowSec * 1000);
    try {
      const mockHttp = {
        getJson: vi
          .fn()
          .mockRejectedValueOnce(
            rateLimitError({
              "Retry-After": "2",
              "X-RateLimit-Reset": String(nowSec + 45)
            })
          )
          .mockResolvedValueOnce(emptySuccessEnvelope),
        postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
      } as unknown as HttpClient;

      const fakeRetry = new FakeRetry();
      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so",
        poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        whaleSwapMinUsdc: "500",
        maxAttempts: 2,
        retryControl: fakeRetry
      });

      const result = await source.collect(request);

      expect(result.providerId).toBe("birdeye-pair-trades");
      expect(mockHttp.getJson).toHaveBeenCalledTimes(2);
      expect(fakeRetry.delays).toEqual([2_000]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("matches rate-limit response headers case-insensitively", async () => {
    const mockHttp = {
      getJson: vi
        .fn()
        .mockRejectedValueOnce(rateLimitError({ "ReTrY-AfTeR": "3" }))
        .mockResolvedValueOnce(emptySuccessEnvelope),
      postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
    } as unknown as HttpClient;

    const fakeRetry = new FakeRetry();
    const source = new HttpBirdeyeFlowSource({
      http: mockHttp,
      url: "https://public-api.birdeye.so",
      poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
      whaleSwapMinUsdc: "500",
      maxAttempts: 2,
      retryControl: fakeRetry
    });

    const result = await source.collect(request);

    expect(result.providerId).toBe("birdeye-pair-trades");
    expect(mockHttp.getJson).toHaveBeenCalledTimes(1 + 1);
    expect(fakeRetry.delays).toEqual([3_000]);
  });

  it.each([
    { description: "undefined responseHeaders", error: rateLimitError(undefined) },
    { description: "invalid Retry-After", error: rateLimitError({ "Retry-After": "later" }) },
    { description: "Retry-After over 60s cap", error: rateLimitError({ "Retry-After": "61" }) },
    {
      description: "X-RateLimit-Reset over 60s cap",
      setupFakeTime: true,
      error: rateLimitError({ "X-RateLimit-Reset": String(1_785_326_400 + 61) })
    }
  ])(
    "aborts a 429 when rate-limit guidance is missing invalid or over the cap ($description)",
    async ({ setupFakeTime, error }) => {
      if (setupFakeTime) {
        vi.useFakeTimers();
        vi.setSystemTime(1_785_326_400 * 1000);
      }
      try {
        const mockHttp = {
          getJson: vi.fn().mockRejectedValue(error),
          postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
        } as unknown as HttpClient;

        const fakeRetry = new FakeRetry();
        const source = new HttpBirdeyeFlowSource({
          http: mockHttp,
          url: "https://public-api.birdeye.so",
          poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
          whaleSwapMinUsdc: "500",
          maxAttempts: 2,
          retryControl: fakeRetry
        });

        await expect(source.collect(request)).rejects.toMatchObject({
          kind: "unavailable"
        });

        expect(mockHttp.getJson).toHaveBeenCalledTimes(1);
        expect(fakeRetry.delays).toEqual([]);
      } finally {
        if (setupFakeTime) {
          vi.useRealTimers();
        }
      }
    }
  );

  it("does not sleep after the final 429 attempt", async () => {
    const mockHttp = {
      getJson: vi.fn().mockRejectedValue(rateLimitError({ "Retry-After": "1" })),
      postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
    } as unknown as HttpClient;

    const fakeRetry = new FakeRetry();
    const source = new HttpBirdeyeFlowSource({
      http: mockHttp,
      url: "https://public-api.birdeye.so",
      poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
      whaleSwapMinUsdc: "500",
      maxAttempts: 2,
      retryControl: fakeRetry
    });

    await expect(source.collect(request)).rejects.toMatchObject({
      kind: "unavailable"
    });

    expect(mockHttp.getJson).toHaveBeenCalledTimes(2);
    expect(fakeRetry.delays).toEqual([1_000]);
  });

  it("keeps generic backoff for retryable non-429 failures", async () => {
    const mockHttp = {
      getJson: vi
        .fn()
        .mockRejectedValueOnce(
          new HttpRequestError("http_status", "Service Unavailable", 503, true)
        )
        .mockResolvedValueOnce(emptySuccessEnvelope),
      postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
    } as unknown as HttpClient;

    const fakeRetry = new FakeRetry([0]);
    const source = new HttpBirdeyeFlowSource({
      http: mockHttp,
      url: "https://public-api.birdeye.so",
      poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
      whaleSwapMinUsdc: "500",
      maxAttempts: 2,
      retryControl: fakeRetry
    });

    const result = await source.collect(request);

    expect(result.providerId).toBe("birdeye-pair-trades");
    expect(mockHttp.getJson).toHaveBeenCalledTimes(2);
    expect(fakeRetry.delays).toEqual([25]);
  });

  it("retries only the failed Birdeye page after a bounded 429 delay", async () => {
    const item1 = {
      txHash: "tx-page-1",
      source: "whirlpool",
      blockUnixTime: 1785278000,
      txType: "swap",
      address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
      owner: "Wallet1",
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
    };

    const item2 = {
      txHash: "tx-page-2",
      source: "whirlpool",
      blockUnixTime: 1785278100,
      txType: "swap",
      address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
      owner: "Wallet2",
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
    };

    const page1Items = Array.from({ length: 50 }, (_, i) => ({
      ...item1,
      txHash: `tx-page-1-${i}`,
      from: { ...item1.from, uiAmount: i === 0 ? 100 : 0 },
      to: { ...item1.to, uiAmount: i === 0 ? 100 : 0 }
    }));

    const mockHttp = {
      getJson: vi
        .fn()
        .mockResolvedValueOnce({
          data: { items: page1Items, hasNext: true },
          success: true
        })
        .mockRejectedValueOnce(rateLimitError({ "Retry-After": "2" }))
        .mockResolvedValueOnce({
          data: { items: [item2], hasNext: false },
          success: true
        }),
      postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
    } as unknown as HttpClient;

    const fakeRetry = new FakeRetry();
    const source = new HttpBirdeyeFlowSource({
      http: mockHttp,
      url: "https://public-api.birdeye.so",
      poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
      whaleSwapMinUsdc: "500",
      maxAttempts: 2,
      retryControl: fakeRetry
    });

    const result = await source.collect(request);

    expect(mockHttp.getJson).toHaveBeenCalledTimes(3);
    expect(mockHttp.getJson).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("offset=0"),
      expect.anything()
    );
    expect(mockHttp.getJson).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("offset=50"),
      expect.anything()
    );
    expect(mockHttp.getJson).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("offset=50"),
      expect.anything()
    );
    expect(fakeRetry.delays).toEqual([2_000]);

    const dexNetFlow = result.events.find((e) => e.eventKind === "dex_net_flow") as {
      sellVolumeUsdc: string;
      buyVolumeUsdc: string;
      netFlowUsdc: string;
    };
    expect(dexNetFlow.sellVolumeUsdc).toBe("100");
    expect(dexNetFlow.buyVolumeUsdc).toBe("200");
    expect(dexNetFlow.netFlowUsdc).toBe("100");
  });
});
