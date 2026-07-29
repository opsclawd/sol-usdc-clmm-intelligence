import { describe, expect, it } from "vitest";
import { HttpDriftSource } from "../../../src/adapters/node/http-drift-source.js";
import { FakeHttp, FakeRetry } from "../../fakes/index.js";

describe("HttpDriftSource", () => {
  it("keeps venue response fields inside adapters and emits only canonical source facts", async () => {
    const fakeHttp = new FakeHttp();
    const fakeRetry = new FakeRetry();
    const adapter = new HttpDriftSource({
      baseUrl: "https://drift-api.example.com",
      symbol: "SOL-PERP",
      marketIndex: 0,
      http: fakeHttp,
      retry: fakeRetry,
      precisions: {
        basePrecisionExp: 9,
        quotePrecisionExp: 6,
        pricePrecisionExp: 6
      }
    });

    fakeHttp.setResponse("https://drift-api.example.com/fundingRates?marketIndex=0", {
      body: [{ marketIndex: 0, recordId: "1", fundingRate: "1000", ts: "1700000000" }]
    });
    fakeHttp.setResponse("https://drift-api.example.com/marketState?marketIndex=0", {
      body: {
        marketIndex: 0,
        baseAssetAmountWithUnsettledLp: "1000000000000",
        amm: {
          historicalOracleData: { lastOraclePrice: "150000000" },
          lastMarkPrice: "150250000"
        }
      }
    });
    fakeHttp.setResponse(
      "https://drift-api.example.com/liquidations?marketIndex=0&fromMs=1699999000000&toMs=1700000000000",
      {
        body: [
          {
            liquidationId: "liq-100",
            marketIndex: 0,
            direction: "long",
            baseAssetAmount: "5000000000",
            quoteAssetAmount: "750000000",
            ts: 1700000000000
          }
        ]
      }
    );
    fakeHttp.setResponse("https://drift-api.example.com/netPositionRatio?marketIndex=0", {
      body: { netPositionRatio: "1.15" }
    });

    const snapshot = await adapter.collect({
      pair: "SOL/USDC",
      fromUnixMs: 1699999000000,
      toUnixMs: 1700000000000
    });

    expect(snapshot.source).toBe("drift-api");
    expect(snapshot.coverage.liquidation_event.status).toBe("available");
    expect(snapshot.facts.length).toBeGreaterThan(0);

    for (const fact of snapshot.facts) {
      expect(fact.venue).toBe("drift-api");
      const payload = fact.payload as unknown as Record<string, unknown>;
      expect(payload).not.toHaveProperty("baseAssetAmountWithUnsettledLp");
      expect(payload).not.toHaveProperty("lastOraclePrice");
      expect(payload).not.toHaveProperty("baseAssetAmount");
      expect(payload.schemaVersion).toBe(1);
    }
  });

  it("maps Drift liquidation precision only from configured documented precision", async () => {
    const fakeHttp = new FakeHttp();
    const fakeRetry = new FakeRetry();
    const adapter = new HttpDriftSource({
      baseUrl: "https://drift-api.example.com",
      symbol: "SOL-PERP",
      marketIndex: 0,
      http: fakeHttp,
      retry: fakeRetry,
      precisions: {
        basePrecisionExp: 9,
        quotePrecisionExp: 6,
        pricePrecisionExp: 6
      }
    });

    fakeHttp.setResponse("https://drift-api.example.com/fundingRates?marketIndex=0", { body: [] });
    fakeHttp.setResponse("https://drift-api.example.com/marketState?marketIndex=0", {
      body: {
        marketIndex: 0,
        baseAssetAmountWithUnsettledLp: "1000000000",
        amm: { historicalOracleData: { lastOraclePrice: "1000000" }, lastMarkPrice: "1000000" }
      }
    });
    fakeHttp.setResponse(
      "https://drift-api.example.com/liquidations?marketIndex=0&fromMs=1699999000000&toMs=1700000000000",
      {
        body: [
          {
            liquidationId: "liq-1",
            marketIndex: 0,
            direction: "short",
            baseAssetAmount: "2000000000",
            quoteAssetAmount: "300000000",
            ts: 1700000000000
          }
        ]
      }
    );
    fakeHttp.setResponse("https://drift-api.example.com/netPositionRatio?marketIndex=0", {
      body: null
    });

    const snapshot = await adapter.collect({
      pair: "SOL/USDC",
      fromUnixMs: 1699999000000,
      toUnixMs: 1700000000000
    });

    const liqFact = snapshot.facts.find((f) => f.kind === "liquidation_event");
    expect(liqFact).toBeDefined();
    if (liqFact && liqFact.payload.kind === "liquidation_event") {
      expect(liqFact.payload.amountBase).toBe("2");
      expect(liqFact.payload.notionalUsdc).toBe("300");
    }
  });

  it("emits leverage proxy only when documented market net-position ratio is supplied", async () => {
    const fakeHttp = new FakeHttp();
    const fakeRetry = new FakeRetry();
    const adapter = new HttpDriftSource({
      baseUrl: "https://drift-api.example.com",
      symbol: "SOL-PERP",
      marketIndex: 0,
      http: fakeHttp,
      retry: fakeRetry,
      precisions: { basePrecisionExp: 9, quotePrecisionExp: 6, pricePrecisionExp: 6 }
    });

    fakeHttp.setResponse("https://drift-api.example.com/fundingRates?marketIndex=0", { body: [] });
    fakeHttp.setResponse("https://drift-api.example.com/marketState?marketIndex=0", {
      body: {
        marketIndex: 0,
        baseAssetAmountWithUnsettledLp: "1000000000",
        amm: { historicalOracleData: { lastOraclePrice: "1000000" }, lastMarkPrice: "1000000" }
      }
    });
    fakeHttp.setResponse(
      "https://drift-api.example.com/liquidations?marketIndex=0&fromMs=1699999000000&toMs=1700000000000",
      { body: [] }
    );
    fakeHttp.setResponse("https://drift-api.example.com/netPositionRatio?marketIndex=0", {
      error: new Error("HTTP 404 Not Found")
    });

    const snapshot = await adapter.collect({
      pair: "SOL/USDC",
      fromUnixMs: 1699999000000,
      toUnixMs: 1700000000000
    });

    expect(snapshot.coverage.leverage_proxy.status).toBe("unavailable");
    expect(snapshot.facts.some((f) => f.kind === "leverage_proxy")).toBe(false);
  });
});
