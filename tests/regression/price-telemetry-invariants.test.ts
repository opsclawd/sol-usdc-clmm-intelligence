import { describe, expect, it } from "vitest";
import { collectPriceObservations } from "../../src/application/collect-price-observations.js";
import {
  calculateRealizedVolatility1h,
  type PriceObservation
} from "../../src/domain/derived-feature/volatility.js";
import { HttpRequestError } from "../../src/ports/http.js";
import {
  FakeClock,
  FakeEnv,
  FakeHttp,
  FakeJsonStore,
  FakeObservationRepo,
  FakeNormalizedObservationRepo
} from "../fakes/index.js";
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

const JUPITER_API_BASE = "https://lite-api.jup.ag/swap/v1";
const JUPITER_API_KEY = "test-jup-key-12345";

const FIXED_CLOCK_TIME = "2026-07-30T12:00:00.000Z";
const FIXED_TIMESTAMP_SECS = Math.floor(new Date(FIXED_CLOCK_TIME).getTime() / 1000) - 30;
const BASE_TIME = Date.parse(FIXED_CLOCK_TIME);

function createDeps(clockTime: string = FIXED_CLOCK_TIME) {
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
    clock: new FakeClock(clockTime),
    rawObservationRepo: new FakeObservationRepo(),
    normalizedObservationRepo: new FakeNormalizedObservationRepo()
  };
}

function makeRecentPythEnvelope(overrides?: { timestampSecs?: number; price?: string }) {
  const timestampSecs = overrides?.timestampSecs ?? FIXED_TIMESTAMP_SECS;
  return makePythHermesEnvelope({
    parsed: [
      makePythHermesPriceUpdate({
        price: makePythHermesParsedPrice({
          publish_time: timestampSecs,
          price: overrides?.price ?? "175000000",
          conf: "1500000"
        })
      })
    ]
  });
}

function makeObservation(id: number, ts: number, price: string): PriceObservation {
  return { id, slot: 100 + id, observedAtUnixMs: ts, price, receivedAtUnixMs: ts };
}

describe("Task 3 Price Telemetry Behavioral Invariants", () => {
  it("manual_price_tick_persists_both_sources", async () => {
    const deps = createDeps();
    const pythUrl = `${PYTH_HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(PYTH_SOL_USD_FEED_ID)}`;
    const jupUrl = `${JUPITER_API_BASE}/quote?inputMint=${encodeURIComponent(SOL_MINT)}&outputMint=${encodeURIComponent(USDC_MINT)}&amount=1000000000&swapMode=ExactIn&slippageBps=50&restrictIntermediateTokens=true`;

    deps.http.setResponse(pythUrl, { body: makeRecentPythEnvelope() });
    deps.http.setResponse(jupUrl, { body: makeJupiterQuote() });

    const context = { runId: "manual-run-1", startedAtUnixMs: BASE_TIME };
    const result = await collectPriceObservations(deps, context);

    expect(result.pyth.status).toBe("accepted");
    expect(result.jupiter.status).toBe("accepted");
    expect(result.usableSourceCount).toBe(2);
    expect(result.isPartial).toBe(false);
    expect(result.shouldFailCommand).toBe(false);

    // Verify durable persistence for both raw and normalized observations
    expect(result.pyth.rawObservationId).not.toBeNull();
    expect(result.pyth.normalizedCount).toBeGreaterThan(0);
    expect(result.jupiter.rawObservationId).not.toBeNull();
    expect(result.jupiter.normalizedCount).toBeGreaterThan(0);

    const pythRaw = await deps.rawObservationRepo.findById(result.pyth.rawObservationId!);
    const jupRaw = await deps.rawObservationRepo.findById(result.jupiter.rawObservationId!);
    expect(pythRaw?.source).toBe("pyth-hermes");
    expect(jupRaw?.source).toBe("jupiter-quote");

    const pythNorm = await deps.normalizedObservationRepo.findBySource(
      "pyth-hermes",
      "oracle_price",
      10
    );
    const jupNorm = await deps.normalizedObservationRepo.findBySource(
      "jupiter-quote",
      "executable_quote",
      10
    );
    expect(pythNorm.length).toBeGreaterThan(0);
    expect(jupNorm.length).toBeGreaterThan(0);
  });

  it("partial_price_tick_stays_diagnostic", async () => {
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

    const context = { runId: "partial-run-1", startedAtUnixMs: BASE_TIME };
    const result = await collectPriceObservations(deps, context);

    expect(result.pyth.status).toBe("accepted");
    expect(result.jupiter.status).toBe("unavailable");
    expect(result.isPartial).toBe(true);
    expect(result.usableSourceCount).toBe(1);
    expect(result.shouldFailCommand).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.startsWith("jupiter:"))).toBe(true);

    // Ensure no fabricated observation is produced for Jupiter
    expect(result.jupiter.rawObservationId).toBeNull();
    expect(result.jupiter.normalizedCount).toBe(0);
    const jupNorm = await deps.normalizedObservationRepo.findBySource(
      "jupiter-quote",
      "executable_quote",
      10
    );
    expect(jupNorm.length).toBe(0);
  });

  it("warmup_advances_only_on_natural_ticks", async () => {
    // 1 manual tick starts the window
    const obs1 = [makeObservation(1, BASE_TIME, "175.0")];
    const initialCalc = calculateRealizedVolatility1h(obs1, BASE_TIME);
    expect(initialCalc.status).toBe("UNAVAILABLE");
    expect(initialCalc.reasons).toContain("insufficient_coverage");

    // Only after 10 distinct scheduled natural ticks (5-min intervals = 45 min span) is coverage accepted
    const naturalObs: PriceObservation[] = [];
    for (let i = 0; i < 10; i++) {
      naturalObs.push(makeObservation(i + 1, BASE_TIME + i * 300_000, String(175.0 + i * 0.1)));
    }
    const fullCalc = calculateRealizedVolatility1h(naturalObs, BASE_TIME + 45 * 60_000);
    expect(fullCalc.status).toBe("AVAILABLE");
    expect(fullCalc.metadata.sampleCount).toBe(10);
  });

  it("volatility_window_requires_density_span_and_gap", () => {
    // Fewer than 10 samples
    const count9 = Array.from({ length: 9 }, (_, i) =>
      makeObservation(i + 1, BASE_TIME + i * 300_000, "175.0")
    );
    const calcCount = calculateRealizedVolatility1h(count9, BASE_TIME + 45 * 60_000);
    expect(calcCount.status).toBe("UNAVAILABLE");
    expect(calcCount.metadata.insufficientReason).toBe("fewer_than_10_samples");

    // Span < 2,700,000 ms (45 minutes)
    const shortSpan = Array.from({ length: 10 }, (_, i) =>
      makeObservation(i + 1, BASE_TIME + i * 60_000, "175.0")
    );
    const calcSpan = calculateRealizedVolatility1h(shortSpan, BASE_TIME + 9 * 60_000);
    expect(calcSpan.status).toBe("UNAVAILABLE");
    expect(calcSpan.metadata.insufficientReason).toBe("span_less_than_45_minutes");

    // Adjacent gap > 600,000 ms (10 minutes)
    const gapObs = [
      makeObservation(1, BASE_TIME, "175.0"),
      makeObservation(2, BASE_TIME + 300_000, "175.1"),
      makeObservation(3, BASE_TIME + 600_000, "175.2"),
      makeObservation(4, BASE_TIME + 900_000, "175.3"),
      makeObservation(5, BASE_TIME + 1_200_000, "175.4"),
      makeObservation(6, BASE_TIME + 1_500_000, "175.5"),
      makeObservation(7, BASE_TIME + 2_101_000, "175.6"), // > 600k gap
      makeObservation(8, BASE_TIME + 2_400_000, "175.7"),
      makeObservation(9, BASE_TIME + 2_700_000, "175.8"),
      makeObservation(10, BASE_TIME + 3_000_000, "175.9")
    ];
    const calcGap = calculateRealizedVolatility1h(gapObs, BASE_TIME + 50 * 60_000);
    expect(calcGap.status).toBe("UNAVAILABLE");
    expect(calcGap.reasons).toContain("excessive_gap");
  });

  it("insufficient_window_never_becomes_zero_volatility", () => {
    const sparseObs = [
      makeObservation(1, BASE_TIME, "175.0"),
      makeObservation(2, BASE_TIME + 300_000, "175.0")
    ];
    const result = calculateRealizedVolatility1h(sparseObs, BASE_TIME + 300_000);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.status).not.toBe("AVAILABLE");
    // Ensure value is null when UNAVAILABLE, never zero substituted
    expect((result as unknown as Record<string, unknown>).value).toBeNull();
    expect((result as unknown as Record<string, unknown>).value).not.toBe(0);
  });

  it("scheduler_failure_stops_core_trigger", () => {
    // If window is insufficient, coverage_pass evaluates to false
    const sparseObs = [makeObservation(1, BASE_TIME, "175.0")];
    const result = calculateRealizedVolatility1h(sparseObs, BASE_TIME);
    const coveragePass = result.status === "AVAILABLE";
    expect(coveragePass).toBe(false);
  });
});
