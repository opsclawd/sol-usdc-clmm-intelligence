import { describe, expect, it } from "vitest";
import { HttpBinanceFapiSource } from "../../../src/adapters/node/http-binance-fapi-source.js";
import { FakeHttp, FakeRetry } from "../../fakes/index.js";

describe("HttpBinanceFapiSource", () => {
  it("keeps venue response fields inside adapters and emits only canonical source facts", async () => {
    const fakeHttp = new FakeHttp();
    const fakeRetry = new FakeRetry();
    const adapter = new HttpBinanceFapiSource({
      baseUrl: "https://fapi.binance.com",
      symbol: "SOLUSDT",
      http: fakeHttp,
      retry: fakeRetry
    });

    fakeHttp.setResponse("https://fapi.binance.com/fapi/v1/fundingRate?symbol=SOLUSDT&limit=10", {
      body: [{ symbol: "SOLUSDT", fundingTime: 1700000000000, fundingRate: "0.0001" }]
    });
    fakeHttp.setResponse(
      "https://fapi.binance.com/futures/data/openInterestHist?symbol=SOLUSDT&period=5m&limit=48",
      {
        body: [
          {
            symbol: "SOLUSDT",
            sumOpenInterest: "1000.50",
            sumOpenInterestValue: "150000.75",
            timestamp: 1700000000000
          }
        ]
      }
    );
    fakeHttp.setResponse("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=SOLUSDT", {
      body: {
        symbol: "SOLUSDT",
        markPrice: "150.25",
        indexPrice: "150.00",
        time: 1700000000000
      }
    });
    fakeHttp.setResponse(
      "https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=SOLUSDT&period=5m&limit=1",
      {
        body: [{ symbol: "SOLUSDT", longShortRatio: "1.25", timestamp: 1700000000000 }]
      }
    );

    const snapshot = await adapter.collect({
      pair: "SOL/USDC",
      fromUnixMs: 1699999000000,
      toUnixMs: 1700000000000
    });

    expect(snapshot.source).toBe("binance-fapi");
    expect(snapshot.coverage.liquidation_event.status).toBe("unavailable");
    expect(snapshot.facts.length).toBeGreaterThan(0);

    for (const fact of snapshot.facts) {
      expect(fact.venue).toBe("binance-fapi");
      const payload = fact.payload as unknown as Record<string, unknown>;
      expect(payload).not.toHaveProperty("sumOpenInterest");
      expect(payload).not.toHaveProperty("sumOpenInterestValue");
      expect(payload).not.toHaveProperty("markPrice");
      expect(payload).not.toHaveProperty("indexPrice");
      expect(payload.schemaVersion).toBe(1);
      expect(payload.pair).toBe("SOL/USDC");
    }
  });

  it("retries retryable source failures and never retries malformed responses", async () => {
    const fakeHttp = new FakeHttp();
    const fakeRetry = new FakeRetry();
    const adapter = new HttpBinanceFapiSource({
      baseUrl: "https://fapi.binance.com",
      symbol: "SOLUSDT",
      http: fakeHttp,
      retry: fakeRetry
    });

    fakeHttp.setResponse("https://fapi.binance.com/fapi/v1/fundingRate?symbol=SOLUSDT&limit=10", {
      error: new Error("HTTP 429 Too Many Requests")
    });
    fakeHttp.setResponse(
      "https://fapi.binance.com/futures/data/openInterestHist?symbol=SOLUSDT&period=5m&limit=48",
      {
        body: [
          {
            symbol: "SOLUSDT",
            sumOpenInterest: "invalid",
            sumOpenInterestValue: "150",
            timestamp: 1700000000000
          }
        ]
      }
    );
    fakeHttp.setResponse("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=SOLUSDT", {
      body: {
        symbol: "SOLUSDT",
        markPrice: "150",
        indexPrice: "150",
        time: 1700000000000
      }
    });
    fakeHttp.setResponse(
      "https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=SOLUSDT&period=5m&limit=1",
      {
        body: [{ symbol: "SOLUSDT", longShortRatio: "1.25", timestamp: 1700000000000 }]
      }
    );

    const snapshot = await adapter.collect({
      pair: "SOL/USDC",
      fromUnixMs: 1699999000000,
      toUnixMs: 1700000000000
    });

    expect(snapshot.coverage.funding_rate.status).toBe("unavailable");
    expect(snapshot.coverage.open_interest.status).toBe("malformed");
    expect(fakeRetry.delays.length).toBeGreaterThan(0);
  });

  it("marks Binance liquidation coverage unavailable without calling a user-data endpoint", async () => {
    const fakeHttp = new FakeHttp();
    const fakeRetry = new FakeRetry();
    const adapter = new HttpBinanceFapiSource({
      baseUrl: "https://fapi.binance.com",
      symbol: "SOLUSDT",
      http: fakeHttp,
      retry: fakeRetry
    });

    fakeHttp.setResponse("https://fapi.binance.com/fapi/v1/fundingRate?symbol=SOLUSDT&limit=10", {
      body: []
    });
    fakeHttp.setResponse(
      "https://fapi.binance.com/futures/data/openInterestHist?symbol=SOLUSDT&period=5m&limit=48",
      { body: [] }
    );
    fakeHttp.setResponse("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=SOLUSDT", {
      body: {
        symbol: "SOLUSDT",
        markPrice: "150",
        indexPrice: "150",
        time: 1700000000000
      }
    });
    fakeHttp.setResponse(
      "https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=SOLUSDT&period=5m&limit=1",
      { body: [] }
    );

    const snapshot = await adapter.collect({
      pair: "SOL/USDC",
      fromUnixMs: 1699999000000,
      toUnixMs: 1700000000000
    });

    expect(snapshot.coverage.liquidation_event.status).toBe("unavailable");
    expect(snapshot.coverage.liquidation_event.diagnostic).toBe("not_supported");
    for (const call of fakeHttp.calls) {
      expect(call.url).not.toContain("allForceOrders");
      expect(call.url).not.toContain("forceOrders");
    }
  });

  it("handles malformed numeric strings, wrong symbol, 404/429/5xx, timeout, and secret redaction", async () => {
    const fakeHttp = new FakeHttp();
    const fakeRetry = new FakeRetry();
    const adapter = new HttpBinanceFapiSource({
      baseUrl: "https://fapi.binance.com",
      symbol: "SOLUSDT",
      http: fakeHttp,
      retry: fakeRetry
    });

    fakeHttp.setResponse("https://fapi.binance.com/fapi/v1/fundingRate?symbol=SOLUSDT&limit=10", {
      body: "not json array"
    });
    fakeHttp.setResponse(
      "https://fapi.binance.com/futures/data/openInterestHist?symbol=SOLUSDT&period=5m&limit=48",
      {
        body: [
          {
            symbol: "WRONGSYMBOL",
            sumOpenInterest: "100",
            sumOpenInterestValue: "1000",
            timestamp: 1700000000000
          }
        ]
      }
    );
    fakeHttp.setResponse("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=SOLUSDT", {
      error: new Error("Timeout after 5000ms")
    });
    fakeHttp.setResponse(
      "https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=SOLUSDT&period=5m&limit=1",
      {
        error: new Error("HTTP 500 Internal Error with key=mysecretkey")
      }
    );

    const snapshot = await adapter.collect({
      pair: "SOL/USDC",
      fromUnixMs: 1699999000000,
      toUnixMs: 1700000000000
    });

    expect(snapshot.coverage.funding_rate.status).toBe("malformed");
    expect(snapshot.coverage.open_interest.status).toBe("malformed");
    expect(snapshot.coverage.perp_basis.status).toBe("unavailable");
    expect(snapshot.coverage.leverage_proxy.status).toBe("unavailable");
    expect(snapshot.coverage.leverage_proxy.diagnostic).not.toContain("mysecretkey");
    expect(snapshot.coverage.leverage_proxy.diagnostic).not.toContain("supersecret");
  });
});
