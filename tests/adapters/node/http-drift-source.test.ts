import { describe, expect, it } from "vitest";
import { HttpDriftSource } from "../../../src/adapters/node/http-drift-source.js";
import { FakeHttp, FakeRetry } from "../../fakes/index.js";

describe("HttpDriftSource", () => {
  it("unwraps Velocity funding-rate and market-stat envelopes into canonical facts", async () => {
    const fakeHttp = new FakeHttp();
    const fakeRetry = new FakeRetry();
    const adapter = new HttpDriftSource({
      baseUrl: "https://data.velocity.exchange",
      symbol: "SOL-PERP",
      marketIndex: 0,
      http: fakeHttp,
      retry: fakeRetry
    });

    fakeHttp.setResponse("https://data.velocity.exchange/market/SOL-PERP/fundingRates", {
      body: {
        success: true,
        records: [{ id: "f1", ts: 1700000000000, fundingRate: "0.015717" }]
      }
    });

    fakeHttp.setResponse("https://data.velocity.exchange/stats/markets", {
      body: {
        success: true,
        markets: [
          {
            symbol: "SOL-PERP",
            oraclePrice: "73.857295",
            markPrice: "73.504000",
            openInterest: { long: "52.16", short: "-182.12" },
            fundingRate: { long: "0.015717", short: "-0.015717" },
            fundingRate24h: "-0.016384"
          }
        ]
      }
    });

    fakeHttp.setResponse("https://data.velocity.exchange/stats/liquidations", {
      body: {
        records: [
          {
            id: "liq-sol-1",
            marketIndex: 0,
            liquidationType: "perp",
            side: "long",
            amountBase: "5.5",
            notionalUsdc: "404.272",
            ts: 1700000000000
          }
        ]
      }
    });

    const snapshot = await adapter.collect({
      pair: "SOL/USDC",
      fromUnixMs: 1699999000000,
      toUnixMs: 1700000000000
    });

    expect(snapshot.source).toBe("drift-api");
    expect(snapshot.coverage.funding_rate.status).toBe("available");
    expect(snapshot.coverage.open_interest.status).toBe("available");
    expect(snapshot.coverage.perp_basis.status).toBe("available");
    expect(snapshot.coverage.leverage_proxy.status).toBe("available");
    expect(snapshot.coverage.liquidation_event.status).toBe("available");

    const fundingFact = snapshot.facts.find((f) => f.kind === "funding_rate");
    expect(fundingFact).toBeDefined();
    expect(fundingFact?.payload).toEqual({
      schemaVersion: 1,
      evidenceFamily: "perp_liquidation",
      pair: "SOL/USDC",
      venue: "drift-api",
      instrument: "SOL-PERP",
      sourceEventId: "drift-funding-f1",
      observedAtUnixMs: 1700000000000,
      kind: "funding_rate",
      fundingRate: "0.015717",
      fundingIntervalHours: 1
    });

    const oiFact = snapshot.facts.find((f) => f.kind === "open_interest");
    expect(oiFact).toBeDefined();
    expect(oiFact?.payload).toMatchObject({
      schemaVersion: 1,
      evidenceFamily: "perp_liquidation",
      pair: "SOL/USDC",
      venue: "drift-api",
      instrument: "SOL-PERP",
      kind: "open_interest",
      openInterestBase: "234.28",
      openInterestUsdc: "17220.51712"
    });

    const basisFact = snapshot.facts.find((f) => f.kind === "perp_basis");
    expect(basisFact).toBeDefined();
    expect(basisFact?.payload).toMatchObject({
      schemaVersion: 1,
      evidenceFamily: "perp_liquidation",
      pair: "SOL/USDC",
      venue: "drift-api",
      instrument: "SOL-PERP",
      kind: "perp_basis",
      perpPriceUsdc: "73.504000",
      spotPriceUsdc: "73.857295"
    });

    const levFact = snapshot.facts.find((f) => f.kind === "leverage_proxy");
    expect(levFact).toBeDefined();
    expect(levFact?.payload).toMatchObject({
      schemaVersion: 1,
      evidenceFamily: "perp_liquidation",
      pair: "SOL/USDC",
      venue: "drift-api",
      instrument: "SOL-PERP",
      kind: "leverage_proxy",
      longShortRatio: "0.286404568416",
      methodology: "market_net_position_ratio"
    });

    const liqFact = snapshot.facts.find((f) => f.kind === "liquidation_event");
    expect(liqFact).toBeDefined();
    expect(liqFact?.payload).toEqual({
      schemaVersion: 1,
      evidenceFamily: "perp_liquidation",
      pair: "SOL/USDC",
      venue: "drift-api",
      instrument: "SOL-PERP",
      sourceEventId: "liq-sol-1",
      observedAtUnixMs: 1700000000000,
      kind: "liquidation_event",
      side: "long",
      amountBase: "5.5",
      notionalUsdc: "404.272"
    });

    for (const fact of snapshot.facts) {
      const payload = fact.payload as unknown as Record<string, unknown>;
      expect(payload).not.toHaveProperty("oraclePrice");
      expect(payload).not.toHaveProperty("markPrice");
      expect(payload).not.toHaveProperty("openInterest");
      expect(payload).not.toHaveProperty("fundingRate24h");
      expect(payload).not.toHaveProperty("records");
      expect(payload).not.toHaveProperty("liquidationType");
    }
  });

  it("marks a bare funding-rate array malformed and emits no funding facts", async () => {
    const fakeHttp = new FakeHttp();
    const fakeRetry = new FakeRetry();
    const adapter = new HttpDriftSource({
      baseUrl: "https://data.velocity.exchange",
      symbol: "SOL-PERP",
      marketIndex: 0,
      http: fakeHttp,
      retry: fakeRetry
    });

    fakeHttp.setResponse("https://data.velocity.exchange/market/SOL-PERP/fundingRates", {
      body: []
    });
    fakeHttp.setResponse("https://data.velocity.exchange/stats/markets", {
      body: { markets: [] }
    });
    fakeHttp.setResponse("https://data.velocity.exchange/stats/liquidations", {
      body: { records: [] }
    });

    const snapshot = await adapter.collect({
      pair: "SOL/USDC",
      fromUnixMs: 1699999000000,
      toUnixMs: 1700000000000
    });

    expect(snapshot.coverage.funding_rate).toEqual({
      kind: "funding_rate",
      status: "malformed",
      diagnostic: "Expected object with records array from fundingRates endpoint"
    });
    expect(snapshot.facts.some((fact) => fact.kind === "funding_rate")).toBe(false);
  });

  it("marks a bare market-stat array malformed and emits no market-stat facts", async () => {
    const fakeHttp = new FakeHttp();
    const adapter = new HttpDriftSource({
      baseUrl: "https://data.velocity.exchange",
      symbol: "SOL-PERP",
      marketIndex: 0,
      http: fakeHttp,
      retry: new FakeRetry()
    });

    fakeHttp.setResponse("https://data.velocity.exchange/market/SOL-PERP/fundingRates", {
      body: { records: [] }
    });
    fakeHttp.setResponse("https://data.velocity.exchange/stats/markets", {
      body: [
        {
          symbol: "SOL-PERP",
          oraclePrice: "73.857295",
          markPrice: "73.504000",
          openInterest: { long: "52.16", short: "-182.12" }
        }
      ]
    });
    fakeHttp.setResponse("https://data.velocity.exchange/stats/liquidations", {
      body: { records: [] }
    });

    const snapshot = await adapter.collect({
      pair: "SOL/USDC",
      fromUnixMs: 1699999000000,
      toUnixMs: 1700000000000
    });

    const expectedCoverage = {
      status: "malformed",
      diagnostic: "Expected object with markets array from stats/markets endpoint"
    };
    expect(snapshot.coverage.open_interest).toMatchObject(expectedCoverage);
    expect(snapshot.coverage.perp_basis).toMatchObject(expectedCoverage);
    expect(snapshot.coverage.leverage_proxy).toMatchObject(expectedCoverage);
    expect(
      snapshot.facts.filter((fact) =>
        ["open_interest", "perp_basis", "leverage_proxy"].includes(fact.kind)
      )
    ).toEqual([]);
  });

  it("computes leverage proxy from absolute long and short open interest", async () => {
    const fakeHttp = new FakeHttp();
    const fakeRetry = new FakeRetry();
    const adapter = new HttpDriftSource({
      baseUrl: "https://data.velocity.exchange",
      symbol: "SOL-PERP",
      marketIndex: 0,
      http: fakeHttp,
      retry: fakeRetry
    });

    fakeHttp.setResponse("https://data.velocity.exchange/market/SOL-PERP/fundingRates", {
      body: []
    });
    fakeHttp.setResponse("https://data.velocity.exchange/stats/liquidations", {
      body: { records: [] }
    });

    fakeHttp.setResponse("https://data.velocity.exchange/stats/markets", {
      body: {
        markets: [
          {
            symbol: "SOL-PERP",
            oraclePrice: "73.857295",
            markPrice: "73.504000",
            openInterest: { long: "52.16", short: "-182.12" },
            fundingRate: { long: "0.015717", short: "-0.015717" }
          }
        ]
      }
    });

    const snapshot1 = await adapter.collect({
      pair: "SOL/USDC",
      fromUnixMs: 1699999000000,
      toUnixMs: 1700000000000
    });

    expect(snapshot1.coverage.leverage_proxy.status).toBe("available");
    const levFact = snapshot1.facts.find((f) => f.kind === "leverage_proxy");
    expect(levFact).toBeDefined();
    expect(levFact?.payload).toMatchObject({
      kind: "leverage_proxy",
      longShortRatio: "0.286404568416",
      methodology: "market_net_position_ratio"
    });

    fakeHttp.setResponse("https://data.velocity.exchange/stats/markets", {
      body: {
        markets: [
          {
            symbol: "SOL-PERP",
            oraclePrice: "73.857295",
            markPrice: "73.504000",
            openInterest: { long: "52.16", short: "0.0" },
            fundingRate: { long: "0.015717", short: "-0.015717" }
          }
        ]
      }
    });

    const snapshot2 = await adapter.collect({
      pair: "SOL/USDC",
      fromUnixMs: 1699999000000,
      toUnixMs: 1700000000000
    });

    expect(snapshot2.coverage.leverage_proxy.status).toBe("unavailable");
    expect(snapshot2.facts.some((f) => f.kind === "leverage_proxy")).toBe(false);
  });

  it("filters Velocity liquidation records by market index and requested time window", async () => {
    const fakeHttp = new FakeHttp();
    const fakeRetry = new FakeRetry();
    const adapter = new HttpDriftSource({
      baseUrl: "https://data.velocity.exchange",
      symbol: "SOL-PERP",
      marketIndex: 0,
      http: fakeHttp,
      retry: fakeRetry
    });

    fakeHttp.setResponse("https://data.velocity.exchange/market/SOL-PERP/fundingRates", {
      body: []
    });
    fakeHttp.setResponse("https://data.velocity.exchange/stats/markets", {
      body: { markets: [] }
    });

    fakeHttp.setResponse("https://data.velocity.exchange/stats/liquidations", {
      body: {
        records: [
          {
            id: "liq-before",
            marketIndex: 0,
            liquidationType: "perp",
            side: "long",
            amountBase: "10.0",
            notionalUsdc: "735.04",
            ts: 1699998999999
          },
          {
            id: "liq-in-window",
            marketIndex: 0,
            liquidationType: "perp",
            side: "long",
            amountBase: "5.5",
            notionalUsdc: "404.272",
            ts: 1699999500000
          },
          {
            id: "liq-after",
            marketIndex: 0,
            liquidationType: "perp",
            side: "short",
            amountBase: "8.0",
            notionalUsdc: "588.032",
            ts: 1700000000001
          },
          {
            id: "liq-other-market",
            marketIndex: 1,
            liquidationType: "perp",
            side: "long",
            amountBase: "1.0",
            notionalUsdc: "40000.0",
            ts: 1699999500000
          },
          {
            id: "liq-spot",
            marketIndex: 0,
            liquidationType: "spot",
            side: "long",
            amountBase: "2.0",
            notionalUsdc: "147.0",
            ts: 1699999500000
          }
        ]
      }
    });

    const snapshot = await adapter.collect({
      pair: "SOL/USDC",
      fromUnixMs: 1699999000000,
      toUnixMs: 1700000000000
    });

    const liqFacts = snapshot.facts.filter((f) => f.kind === "liquidation_event");
    expect(liqFacts).toHaveLength(1);
    expect(liqFacts[0]?.payload).toMatchObject({
      kind: "liquidation_event",
      sourceEventId: "liq-in-window",
      side: "long",
      amountBase: "5.5",
      notionalUsdc: "404.272",
      observedAtUnixMs: 1699999500000
    });
  });

  it("marks missing configured market and malformed liquidation envelopes without emitting facts", async () => {
    const fakeHttp = new FakeHttp();
    const fakeRetry = new FakeRetry();
    const adapter = new HttpDriftSource({
      baseUrl: "https://data.velocity.exchange",
      symbol: "SOL-PERP",
      marketIndex: 0,
      http: fakeHttp,
      retry: fakeRetry
    });

    fakeHttp.setResponse("https://data.velocity.exchange/market/SOL-PERP/fundingRates", {
      body: []
    });
    fakeHttp.setResponse("https://data.velocity.exchange/stats/markets", {
      body: {
        markets: [
          {
            symbol: "BTC-PERP",
            oraclePrice: "40000",
            markPrice: "40000",
            openInterest: { long: "10", short: "-10" }
          }
        ]
      }
    });
    fakeHttp.setResponse("https://data.velocity.exchange/stats/liquidations", {
      body: { status: "ok" }
    });

    const snapshot = await adapter.collect({
      pair: "SOL/USDC",
      fromUnixMs: 1699999000000,
      toUnixMs: 1700000000000
    });

    expect(snapshot.coverage.open_interest.status).toBe("malformed");
    expect(snapshot.coverage.perp_basis.status).toBe("malformed");
    expect(snapshot.coverage.leverage_proxy.status).toBe("malformed");
    expect(snapshot.coverage.liquidation_event.status).toBe("malformed");

    expect(snapshot.facts.some((f) => f.kind === "open_interest")).toBe(false);
    expect(snapshot.facts.some((f) => f.kind === "perp_basis")).toBe(false);
    expect(snapshot.facts.some((f) => f.kind === "leverage_proxy")).toBe(false);
    expect(snapshot.facts.some((f) => f.kind === "liquidation_event")).toBe(false);
  });

  it("preserves partial coverage when one Velocity endpoint fails", async () => {
    const fakeHttp = new FakeHttp();
    const fakeRetry = new FakeRetry();
    const adapter = new HttpDriftSource({
      baseUrl: "https://data.velocity.exchange",
      symbol: "SOL-PERP",
      marketIndex: 0,
      http: fakeHttp,
      retry: fakeRetry
    });

    fakeHttp.setResponse("https://data.velocity.exchange/market/SOL-PERP/fundingRates", {
      error: new Error("HTTP 500 Internal Server Error")
    });

    fakeHttp.setResponse("https://data.velocity.exchange/stats/markets", {
      body: {
        markets: [
          {
            symbol: "SOL-PERP",
            oraclePrice: "73.857295",
            markPrice: "73.504000",
            openInterest: { long: "52.16", short: "-182.12" }
          }
        ]
      }
    });

    fakeHttp.setResponse("https://data.velocity.exchange/stats/liquidations", {
      body: { records: [] }
    });

    const snapshot = await adapter.collect({
      pair: "SOL/USDC",
      fromUnixMs: 1699999000000,
      toUnixMs: 1700000000000
    });

    expect(snapshot.coverage.funding_rate.status).toBe("unavailable");
    expect(snapshot.coverage.open_interest.status).toBe("available");
    expect(snapshot.coverage.perp_basis.status).toBe("available");
    expect(snapshot.coverage.leverage_proxy.status).toBe("available");
    expect(snapshot.coverage.liquidation_event.status).toBe("available");
  });

  it("retries only retryable Velocity request failures and redacts diagnostics", async () => {
    const fakeHttp = new FakeHttp();
    const fakeRetry = new FakeRetry();
    const adapter = new HttpDriftSource({
      baseUrl: "https://data.velocity.exchange",
      symbol: "SOL-PERP",
      marketIndex: 0,
      http: fakeHttp,
      retry: fakeRetry,
      maxAttempts: 2
    });

    fakeHttp.setResponse("https://data.velocity.exchange/market/SOL-PERP/fundingRates", {
      error: new Error("Network error key=secret12345")
    });
    fakeHttp.setResponse("https://data.velocity.exchange/stats/markets", {
      body: { markets: [] }
    });
    fakeHttp.setResponse("https://data.velocity.exchange/stats/liquidations", {
      body: { records: [] }
    });

    const snapshot = await adapter.collect({
      pair: "SOL/USDC",
      fromUnixMs: 1699999000000,
      toUnixMs: 1700000000000
    });

    expect(snapshot.coverage.funding_rate.status).toBe("unavailable");
    expect(snapshot.coverage.funding_rate.diagnostic).toContain("[REDACTED]");
    expect(snapshot.coverage.funding_rate.diagnostic).not.toContain("secret12345");
  });
});
