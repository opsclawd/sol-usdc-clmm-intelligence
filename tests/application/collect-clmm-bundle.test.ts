import { describe, expect, it } from "vitest";
import { collectClmmBundle } from "../../src/application/collect-clmm-bundle.js";
import { FakeHttp, FakeJsonStore, FakeEnv } from "../fakes/index.js";

const VALID_BUNDLE = {
  bundle: {
    pair: "SOL/USDC",
    source: "orca",
    observedAtUnixMs: 1700000000000,
    pool: {
      poolId: "abc",
      currentPrice: 150.5,
      currentPriceLabel: "$150.50",
      sqrtPrice: "1000000",
      tickCurrentIndex: 0,
      tickSpacing: 64,
      feeRate: 0.0005,
      feeRateLabel: "0.05%",
      poolLiquidity: "1000000",
      priceSource: "orca_whirlpool_sqrt_price",
      tokenPairLabel: "SOL/USDC"
    },
    srLevels: null,
    positions: [],
    alerts: [],
    dataQuality: { warnings: [], isPartial: false, missingSources: [] }
  }
};

const VALID_ENV = {
  CLMM_DATA_API_BASE: "http://api.test",
  CLMM_INSIGHTS_API_KEY: "test-key-123",
  WALLET_PUBLIC_KEY: "11111111111111111111111111111111"
};

describe("collectClmmBundle", () => {
  it("writes valid bundle to data/latest-clmm-bundle.json", async () => {
    const http = new FakeHttp();
    http.setResponse("http://api.test/insights/sol-usdc/bundle/11111111111111111111111111111111", {
      body: VALID_BUNDLE
    });
    const jsonStore = new FakeJsonStore();
    const env = new FakeEnv(VALID_ENV);

    await collectClmmBundle({ http, jsonStore, env });

    expect(jsonStore.writes).toHaveLength(1);
    expect(jsonStore.writes[0]!.path).toBe("data/latest-clmm-bundle.json");
    const written = jsonStore.writes[0]!.value as Record<string, unknown>;
    expect(written.pair).toBe("SOL/USDC");
    expect(Array.isArray(written.positions)).toBe(true);
    expect(http.calls[0]!.headers["x-insights-api-key"]).toBe("test-key-123");
  });

  it("throws when response has no bundle field", async () => {
    const http = new FakeHttp();
    http.setResponse("http://api.test/insights/sol-usdc/bundle/11111111111111111111111111111111", {
      body: { something: "else" }
    });
    const jsonStore = new FakeJsonStore();
    const env = new FakeEnv(VALID_ENV);

    await expect(collectClmmBundle({ http, jsonStore, env })).rejects.toThrow("bundle");
  });

  it("throws when bundle pair is not SOL/USDC", async () => {
    const http = new FakeHttp();
    http.setResponse("http://api.test/insights/sol-usdc/bundle/11111111111111111111111111111111", {
      body: { bundle: { pair: "ETH/BTC" } }
    });
    const jsonStore = new FakeJsonStore();
    const env = new FakeEnv(VALID_ENV);

    await expect(collectClmmBundle({ http, jsonStore, env })).rejects.toThrow("pair");
  });

  it("throws when CLMM_INSIGHTS_API_KEY is missing", async () => {
    const http = new FakeHttp();
    const jsonStore = new FakeJsonStore();
    const env = new FakeEnv({
      CLMM_DATA_API_BASE: "http://api.test",
      WALLET_PUBLIC_KEY: "11111111111111111111111111111111"
    });

    await expect(collectClmmBundle({ http, jsonStore, env })).rejects.toThrow(
      "Missing required environment variable: CLMM_INSIGHTS_API_KEY"
    );
  });

  it("normalizes trailing slash on base URL", async () => {
    const http = new FakeHttp();
    const jsonStore = new FakeJsonStore();
    const env = new FakeEnv({
      CLMM_DATA_API_BASE: "http://api.test/",
      CLMM_INSIGHTS_API_KEY: "test-key-123",
      WALLET_PUBLIC_KEY: "11111111111111111111111111111111"
    });

    http.setResponse("http://api.test/insights/sol-usdc/bundle/11111111111111111111111111111111", {
      body: VALID_BUNDLE
    });

    await collectClmmBundle({ http, jsonStore, env });

    expect(http.calls[0]!.url).toBe(
      "http://api.test/insights/sol-usdc/bundle/11111111111111111111111111111111"
    );
  });
});
