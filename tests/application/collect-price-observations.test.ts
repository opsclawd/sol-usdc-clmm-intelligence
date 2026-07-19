import { describe, expect, it } from "vitest";
import { collectPriceObservations } from "../../src/application/collect-price-observations.js";
import { HttpRequestError } from "../../src/ports/http.js";
import { FakeHttp, FakeJsonStore, FakeEnv, FakeClock } from "../fakes/index.js";
import { FakeObservationRepo } from "../fakes/fake-observation-repo.js";
import { FakeNormalizedObservationRepo } from "../fakes/fake-normalized-observation-repo.js";
import {
  makePythHermesEnvelope,
  makePythHermesPriceUpdate,
  makePythHermesParsedPrice,
  SOL_USD_FEED_ID
} from "../fixtures/pyth-price-update.js";
import { makeJupiterQuote, SOL_MINT, USDC_MINT } from "../fixtures/jupiter-quote.js";

const PYTH_HERMES_BASE_URL = "https://hermes.pyth.network";
const PYTH_API_KEY = "test-api-key-12345";
const PYTH_SOL_USD_FEED_ID = SOL_USD_FEED_ID;

const JUPITER_API_BASE = "https://api.jup.ag/swap/v6";
const JUPITER_API_KEY = "test-jup-key-12345";

const FIXED_CLOCK_TIME = "2026-05-10T12:00:00.000Z";
const FIXED_TIMESTAMP_SECS = Math.floor(new Date(FIXED_CLOCK_TIME).getTime() / 1000) - 30;

function createDeps(clock?: FakeClock) {
  const c = clock ?? new FakeClock(FIXED_CLOCK_TIME);
  return {
    http: new FakeHttp(),
    jsonStore: new FakeJsonStore(),
    env: new FakeEnv({
      PYTH_HERMES_BASE_URL,
      PYTH_API_KEY,
      PYTH_SOL_USD_FEED_ID,
      JUPITER_API_BASE,
      JUPITER_API_KEY,
      SOL_MINT,
      USDC_MINT
    }),
    clock: c,
    rawObservationRepo: new FakeObservationRepo(),
    normalizedObservationRepo: new FakeNormalizedObservationRepo()
  };
}

function makeRecentPythEnvelope(overrides?: { timestampSecs?: number }) {
  const timestampSecs = overrides?.timestampSecs ?? FIXED_TIMESTAMP_SECS;
  return makePythHermesEnvelope({
    parsed: [
      makePythHermesPriceUpdate({
        price: makePythHermesParsedPrice({
          timestamp: timestampSecs,
          price: "175000000",
          confidence: "1500000"
        })
      })
    ]
  });
}

describe("collectPriceObservations", () => {
  it("starts both independent source pipelines before awaiting either result", async () => {
    const deps = createDeps();

    const pythUrl = `${PYTH_HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(PYTH_SOL_USD_FEED_ID)}`;
    const jupUrl = `${JUPITER_API_BASE}/quote?inputMint=${encodeURIComponent(SOL_MINT)}&outputMint=${encodeURIComponent(USDC_MINT)}&amount=1000000000&swapMode=ExactIn&slippageBps=50&restrictIntermediateTokens=true`;

    let resolvePythPromise: (value: unknown) => void = () => {};
    const pythPromise = new Promise((resolve) => {
      resolvePythPromise = resolve;
    });

    deps.http.setResponse(pythUrl, {
      body: makeRecentPythEnvelope(),
      promise: pythPromise
    });
    deps.http.setResponse(jupUrl, {
      body: makeJupiterQuote()
    });

    const runPromise = collectPriceObservations(deps);

    // Let microtasks run so that the async operations start and make their HTTP calls
    await new Promise((resolve) => setTimeout(resolve, 10));

    const urls = deps.http.calls.map((c) => c.url);
    expect(urls).toContain(pythUrl);
    expect(urls).toContain(jupUrl);

    // Clean up: resolve pyth
    resolvePythPromise({ body: makeRecentPythEnvelope() });
    await runPromise;
  });

  it("preserves one source when the other source fails", async () => {
    const deps = createDeps();

    const pythUrl = `${PYTH_HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(PYTH_SOL_USD_FEED_ID)}`;
    const jupUrl = `${JUPITER_API_BASE}/quote?inputMint=${encodeURIComponent(SOL_MINT)}&outputMint=${encodeURIComponent(USDC_MINT)}&amount=1000000000&swapMode=ExactIn&slippageBps=50&restrictIntermediateTokens=true`;

    deps.http.setResponse(pythUrl, { body: makeRecentPythEnvelope() });
    deps.http.setResponse(jupUrl, {
      error: new HttpRequestError(
        "http_status",
        "GET failed: 500 Internal Server Error",
        500,
        false
      )
    });

    const result = await collectPriceObservations(deps);

    expect(result.pyth.status).toBe("accepted");
    expect(result.jupiter.status).toBe("unavailable");
    expect(result.isPartial).toBe(true);
    expect(result.usableSourceCount).toBe(1);
    expect(result.shouldFailCommand).toBe(false);
  });

  it("counts stale durable observations as unusable", async () => {
    const deps = createDeps();

    const pythUrl = `${PYTH_HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(PYTH_SOL_USD_FEED_ID)}`;
    const jupUrl = `${JUPITER_API_BASE}/quote?inputMint=${encodeURIComponent(SOL_MINT)}&outputMint=${encodeURIComponent(USDC_MINT)}&amount=1000000000&swapMode=ExactIn&slippageBps=50&restrictIntermediateTokens=true`;

    const clockTimestampSecs = Math.floor(new Date(FIXED_CLOCK_TIME).getTime() / 1000);
    const oldTimestamp = clockTimestampSecs - 120; // stale
    deps.http.setResponse(pythUrl, {
      body: makeRecentPythEnvelope({ timestampSecs: oldTimestamp })
    });
    deps.http.setResponse(jupUrl, { body: makeJupiterQuote() });

    const result = await collectPriceObservations(deps);

    expect(result.pyth.status).toBe("stale");
    expect(result.jupiter.status).toBe("accepted");
    expect(result.usableSourceCount).toBe(1);
  });

  it("fails the command on total unavailability or any conflict", async () => {
    // Total unavailability
    {
      const deps = createDeps();
      const pythUrl = `${PYTH_HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(PYTH_SOL_USD_FEED_ID)}`;
      const jupUrl = `${JUPITER_API_BASE}/quote?inputMint=${encodeURIComponent(SOL_MINT)}&outputMint=${encodeURIComponent(USDC_MINT)}&amount=1000000000&swapMode=ExactIn&slippageBps=50&restrictIntermediateTokens=true`;

      deps.http.setResponse(pythUrl, {
        error: new HttpRequestError(
          "http_status",
          "GET failed: 500 Internal Server Error",
          500,
          false
        )
      });
      deps.http.setResponse(jupUrl, {
        error: new HttpRequestError(
          "http_status",
          "GET failed: 500 Internal Server Error",
          500,
          false
        )
      });

      const result = await collectPriceObservations(deps);
      expect(result.usableSourceCount).toBe(0);
      expect(result.shouldFailCommand).toBe(true);
    }
  });

  it("covers both usable success, parsed replay usability, deterministic warning ordering, and null/omitted missing fields rather than zeros", async () => {
    const deps = createDeps();

    const pythUrl = `${PYTH_HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(PYTH_SOL_USD_FEED_ID)}`;
    const jupUrl = `${JUPITER_API_BASE}/quote?inputMint=${encodeURIComponent(SOL_MINT)}&outputMint=${encodeURIComponent(USDC_MINT)}&amount=1000000000&swapMode=ExactIn&slippageBps=50&restrictIntermediateTokens=true`;

    deps.http.setResponse(pythUrl, { body: makeRecentPythEnvelope() });
    deps.http.setResponse(jupUrl, { body: makeJupiterQuote() });

    const result = await collectPriceObservations(deps);

    expect(result.pyth.status).toBe("accepted");
    expect(result.jupiter.status).toBe("accepted");
    expect(result.isPartial).toBe(false);
    expect(result.usableSourceCount).toBe(2);
    expect(result.shouldFailCommand).toBe(false);
    expect(result.warnings).toEqual([]);

    const resultReplay = await collectPriceObservations(deps);
    expect(resultReplay.pyth.status).toBe("identical_replay");
    expect(resultReplay.jupiter.status).toBe("identical_replay");
    expect(resultReplay.usableSourceCount).toBe(2);
    expect(resultReplay.shouldFailCommand).toBe(false);

    const depsFail = createDeps();
    depsFail.http.setResponse(pythUrl, {
      error: new HttpRequestError(
        "http_status",
        "GET failed: 500 Internal Server Error",
        500,
        false
      )
    });
    depsFail.http.setResponse(jupUrl, {
      error: new HttpRequestError(
        "http_status",
        "GET failed: 500 Internal Server Error",
        500,
        false
      )
    });
    const resultFail = await collectPriceObservations(depsFail);
    expect(resultFail.pyth).not.toHaveProperty("rawObservationId");
    expect(resultFail.pyth).not.toHaveProperty("normalizedCount");
    expect(resultFail.jupiter).not.toHaveProperty("rawObservationId");
    expect(resultFail.jupiter).not.toHaveProperty("normalizedCount");
  });
});
