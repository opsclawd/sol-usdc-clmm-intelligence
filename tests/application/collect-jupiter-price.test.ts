import { describe, expect, it } from "vitest";
import { collectJupiterPrice } from "../../src/application/collect-jupiter-price.js";
import { makeJupiterQuote, SOL_MINT, USDC_MINT } from "../fixtures/jupiter-quote.js";
import { FakeHttp, FakeJsonStore, FakeEnv, FakeClock } from "../fakes/index.js";
import { FakeObservationRepo } from "../fakes/fake-observation-repo.js";
import { FakeNormalizedObservationRepo } from "../fakes/fake-normalized-observation-repo.js";

const JUPITER_API_BASE = "https://api.jup.ag/swap/v6";

function createDeps() {
  return {
    http: new FakeHttp(),
    jsonStore: new FakeJsonStore(),
    env: new FakeEnv({
      JUPITER_API_BASE,
      SOL_MINT,
      USDC_MINT
    }),
    clock: new FakeClock("2026-05-10T12:30:00.000Z"),
    rawObservationRepo: new FakeObservationRepo(),
    normalizedObservationRepo: new FakeNormalizedObservationRepo()
  };
}

const VALID_CONTEXT = Object.freeze({
  runId: "run-123",
  startedAtUnixMs: 1778416200000 // 2026-05-10T12:30:00.000Z
});

describe("collectJupiterPrice (compatibility wrapper)", () => {
  it("delegates to collectJupiterQuote and writes compatibility snapshot", async () => {
    const deps = createDeps();
    const quote = makeJupiterQuote();
    const url = `${JUPITER_API_BASE}/quote?inputMint=${encodeURIComponent(SOL_MINT)}&outputMint=${encodeURIComponent(USDC_MINT)}&amount=1000000000&swapMode=ExactIn&slippageBps=50&restrictIntermediateTokens=true`;
    deps.http.setResponse(url, { body: quote });

    await collectJupiterPrice(deps, VALID_CONTEXT);

    expect(deps.jsonStore.writes[0]).toEqual({
      path: "data/latest-price-snapshot.json",
      value: expect.objectContaining({
        pair: "SOL/USDC",
        timestamp: "2026-05-10T12:30:00.000Z",
        source: "jupiter-quote",
        priceUsd: 175,
        confidence: "high"
      })
    });
  });

  it("uses default mints when SOL_MINT is unset", async () => {
    const deps = createDeps();
    deps.env = new FakeEnv({ JUPITER_API_BASE });
    const quote = makeJupiterQuote();
    const url = `${JUPITER_API_BASE}/quote?inputMint=${encodeURIComponent(SOL_MINT)}&outputMint=${encodeURIComponent(USDC_MINT)}&amount=1000000000&swapMode=ExactIn&slippageBps=50&restrictIntermediateTokens=true`;
    deps.http.setResponse(url, { body: quote });

    await collectJupiterPrice(deps, VALID_CONTEXT);
    expect(deps.http.calls[0]?.url).toBe(url);
  });

  it("rejects when quote schema is invalid", async () => {
    const deps = createDeps();
    const url = `${JUPITER_API_BASE}/quote?inputMint=${encodeURIComponent(SOL_MINT)}&outputMint=${encodeURIComponent(USDC_MINT)}&amount=1000000000&swapMode=ExactIn&slippageBps=50&restrictIntermediateTokens=true`;
    deps.http.setResponse(url, { body: { invalid: "response" } });

    const result = await collectJupiterPrice(deps, VALID_CONTEXT);
    expect(result.status).toBe("malformed");
  });
});
