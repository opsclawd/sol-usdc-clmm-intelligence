import { describe, expect, it } from "vitest";
import { HttpRequestError } from "../../src/ports/http.js";
import { makeJupiterQuote, SOL_MINT, USDC_MINT } from "../fixtures/jupiter-quote.js";
import { FakeHttp, FakeJsonStore, FakeEnv, FakeClock } from "../fakes/index.js";
import { FakeObservationRepo } from "../fakes/fake-observation-repo.js";
import { FakeNormalizedObservationRepo } from "../fakes/fake-normalized-observation-repo.js";
import { collectJupiterQuote } from "../../src/application/collect-jupiter-quote.js";
import type { DegradedResult } from "../../src/application/price-source-result.js";
import { mapSourceError } from "../../src/application/source-outcome.js";

const JUPITER_API_BASE = "https://api.jup.ag/swap/v6";
const JUPITER_API_KEY = "test-jup-key-12345";

const FIXED_CLOCK_TIME = "2026-05-10T12:00:00.000Z";
const FIXED_TIMESTAMP_MS = new Date(FIXED_CLOCK_TIME).getTime();

function createDeps(clock?: FakeClock) {
  const c = clock ?? new FakeClock(FIXED_CLOCK_TIME);
  return {
    http: new FakeHttp(),
    jsonStore: new FakeJsonStore(),
    env: new FakeEnv({
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

const VALID_CONTEXT = Object.freeze({
  runId: "run-123",
  startedAtUnixMs: FIXED_TIMESTAMP_MS
});

describe("collectJupiterQuote", () => {
  it("passes explicit immutable context without leaf environment rereads", async () => {
    const deps = createDeps();
    const quote = makeJupiterQuote();
    const expectedUrl = `${JUPITER_API_BASE}/quote?inputMint=${encodeURIComponent(SOL_MINT)}&outputMint=${encodeURIComponent(USDC_MINT)}&amount=1000000000&swapMode=ExactIn&slippageBps=50&restrictIntermediateTokens=true`;
    deps.http.setResponse(expectedUrl, { body: quote });

    // Mock env to reject run ID reads
    deps.env.getOptional = (name) => {
      if (name === "INTELLIGENCE_PIPELINE_RUN_ID")
        throw new Error("Should not read run id from env");
      return undefined;
    };

    const result = await collectJupiterQuote(deps, VALID_CONTEXT);
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;
    const row = await deps.rawObservationRepo.findById(result.rawObservationId!);
    expect(row?.sourceRequestMeta).toEqual(
      expect.objectContaining({
        runId: "run-123"
      })
    );
  });

  describe("behavioral invariants", () => {
    it("requests the deterministic generic Jupiter quote contract", async () => {
      const deps = createDeps();
      const quote = makeJupiterQuote();
      const expectedUrl = `${JUPITER_API_BASE}/quote?inputMint=${encodeURIComponent(SOL_MINT)}&outputMint=${encodeURIComponent(USDC_MINT)}&amount=1000000000&swapMode=ExactIn&slippageBps=50&restrictIntermediateTokens=true`;

      deps.http.setResponse(expectedUrl, { body: quote });

      const result = await collectJupiterQuote(deps, VALID_CONTEXT);

      expect(result.status).toBe("accepted");
      const call = deps.http.calls[0];
      expect(call).toBeDefined();
      expect(call?.url).toBe(expectedUrl);
      expect(call?.options?.timeoutMs).toBe(5000);
      expect(call?.options?.maxAttempts).toBe(2);
      expect(call?.options?.headers).toEqual({ "x-api-key": JUPITER_API_KEY });

      // Assert redacted metadata
      const rawRows = deps.rawObservationRepo as FakeObservationRepo;
      const allRows = await rawRows.findBySource("jupiter-quote", 0);
      const lastRow = allRows[allRows.length - 1];
      expect(lastRow).toBeDefined();
      expect(lastRow?.sourceRequestMeta).toBeDefined();

      const meta = lastRow?.sourceRequestMeta as Record<string, unknown>;
      expect(meta.host).toBe("api.jup.ag");
      expect(meta.path).toBe("/quote");
      expect(meta.inputMint).toBe(SOL_MINT);
      expect(meta.outputMint).toBe(USDC_MINT);
      expect(meta.amount).toBe("1000000000");
      expect(meta.swapMode).toBe("ExactIn");
      expect(meta.slippageBps).toBe(50);
      expect(meta.restrictIntermediateTokens).toBe(true);
      expect(meta).not.toHaveProperty("headers");
      expect(meta).not.toHaveProperty("apiKey");
      expect(meta).not.toHaveProperty("authorization");
      expect(meta).not.toHaveProperty("x-api-key");
    });

    it("updates compatibility snapshot only from normalized Jupiter evidence", async () => {
      const deps = createDeps();
      const quote = makeJupiterQuote();
      const expectedUrl = `${JUPITER_API_BASE}/quote?inputMint=${encodeURIComponent(SOL_MINT)}&outputMint=${encodeURIComponent(USDC_MINT)}&amount=1000000000&swapMode=ExactIn&slippageBps=50&restrictIntermediateTokens=true`;

      deps.http.setResponse(expectedUrl, { body: quote });

      await collectJupiterQuote(deps, VALID_CONTEXT);

      // Compatibility snapshot should be written
      expect(deps.jsonStore.writes.length).toBe(1);
      expect(deps.jsonStore.writes[0]?.path).toBe("data/latest-price-snapshot.json");
      expect(deps.jsonStore.writes[0]?.value).toEqual(
        expect.objectContaining({
          pair: "SOL/USDC",
          timestamp: FIXED_CLOCK_TIME,
          source: "jupiter-quote",
          priceUsd: 175,
          confidence: "high"
        })
      );
    });

    it("preserves durable Jupiter evidence when compatibility snapshot writing fails", async () => {
      const deps = createDeps();
      const quote = makeJupiterQuote();
      const expectedUrl = `${JUPITER_API_BASE}/quote?inputMint=${encodeURIComponent(SOL_MINT)}&outputMint=${encodeURIComponent(USDC_MINT)}&amount=1000000000&swapMode=ExactIn&slippageBps=50&restrictIntermediateTokens=true`;

      deps.http.setResponse(expectedUrl, { body: quote });
      deps.jsonStore.writeError = new Error("Disk full");

      let errorThrown: unknown;
      try {
        await collectJupiterQuote(deps, VALID_CONTEXT);
      } catch (err) {
        errorThrown = err;
      }
      expect(errorThrown).toBeDefined();

      const rawRows = deps.rawObservationRepo as FakeObservationRepo;
      const allRows = await rawRows.findBySource("jupiter-quote", 0);
      expect(allRows.length).toBe(1);
      expect(allRows[0]?.parseStatus).toBe("parsed");

      const normRows = deps.normalizedObservationRepo as FakeNormalizedObservationRepo;
      const allNorm = await normRows.findBySource("jupiter-quote", "executable_quote", 0);
      expect(allNorm.length).toBe(1);

      const mapped = mapSourceError("jupiter", "jupiter-quote", errorThrown);
      expect(mapped.status).toBe("failed");
      expect(mapped.hasUsableEvidence).toBe(true);
      expect(mapped.rawObservationId).toBe(allRows[0]?.id);
      expect(mapped.normalizedCount).toBe(1);
      expect(mapped.diagnostic).toContain("Disk full");
    });
  });

  describe("error and edge cases", () => {
    it("handles malformed response before raw insert", async () => {
      const deps = createDeps();
      const expectedUrl = `${JUPITER_API_BASE}/quote?inputMint=${encodeURIComponent(SOL_MINT)}&outputMint=${encodeURIComponent(USDC_MINT)}&amount=1000000000&swapMode=ExactIn&slippageBps=50&restrictIntermediateTokens=true`;

      deps.http.setResponse(expectedUrl, { body: { invalid: "data" } });

      const result = await collectJupiterQuote(deps, VALID_CONTEXT);
      expect(result.status).toBe("malformed");

      const rawRows = deps.rawObservationRepo as FakeObservationRepo;
      const allRows = await rawRows.findBySource("jupiter-quote", 0);
      expect(allRows.length).toBe(0);
    });

    it("handles no route before raw insert", async () => {
      const deps = createDeps();
      const expectedUrl = `${JUPITER_API_BASE}/quote?inputMint=${encodeURIComponent(SOL_MINT)}&outputMint=${encodeURIComponent(USDC_MINT)}&amount=1000000000&swapMode=ExactIn&slippageBps=50&restrictIntermediateTokens=true`;

      deps.http.setResponse(expectedUrl, {
        error: new HttpRequestError(
          "http_status",
          "GET failed: 400 Bad Request COULD_NOT_FIND_ANY_ROUTE",
          400,
          false
        )
      });

      const result = await collectJupiterQuote(deps, VALID_CONTEXT);
      expect(result.status).toBe("no_route");

      const rawRows = deps.rawObservationRepo as FakeObservationRepo;
      const allRows = await rawRows.findBySource("jupiter-quote", 0);
      expect(allRows.length).toBe(0);
    });

    it("handles stale outcome", async () => {
      const deps = createDeps();
      const quote = makeJupiterQuote();
      const expectedUrl = `${JUPITER_API_BASE}/quote?inputMint=${encodeURIComponent(SOL_MINT)}&outputMint=${encodeURIComponent(USDC_MINT)}&amount=1000000000&swapMode=ExactIn&slippageBps=50&restrictIntermediateTokens=true`;

      deps.http.setResponse(expectedUrl, { body: quote });

      const res1 = await collectJupiterQuote(deps, VALID_CONTEXT);
      expect(res1.status).toBe("accepted");

      // Advance clock by 40s
      deps.clock.now = () => new Date(FIXED_TIMESTAMP_MS + 40000).toISOString();

      // Mark the row as stale
      const normRows = await deps.normalizedObservationRepo.findBySource(
        "jupiter-quote",
        "executable_quote",
        0
      );
      if (normRows[0]) {
        type Writeable<T> = { -readonly [P in keyof T]: T[P] };
        (normRows[0] as Writeable<(typeof normRows)[0]>).isStale = true;
      }

      const res2 = await collectJupiterQuote(deps, VALID_CONTEXT);
      expect(res2.status).toBe("stale");
    });

    it("handles high price impact outcomes", async () => {
      const deps = createDeps();
      const quote = makeJupiterQuote({ highPriceImpact: true, priceImpactPct: "1.5" });
      const expectedUrl = `${JUPITER_API_BASE}/quote?inputMint=${encodeURIComponent(SOL_MINT)}&outputMint=${encodeURIComponent(USDC_MINT)}&amount=1000000000&swapMode=ExactIn&slippageBps=50&restrictIntermediateTokens=true`;

      deps.http.setResponse(expectedUrl, { body: quote });

      const result = await collectJupiterQuote(deps, VALID_CONTEXT);
      expect(result.status).toBe("degraded");
      expect((result as DegradedResult).warnings).toContain("price_impact_exceeds_threshold");
    });

    it("handles replay and conflict", async () => {
      const deps = createDeps();
      const quote1 = makeJupiterQuote();
      const expectedUrl = `${JUPITER_API_BASE}/quote?inputMint=${encodeURIComponent(SOL_MINT)}&outputMint=${encodeURIComponent(USDC_MINT)}&amount=1000000000&swapMode=ExactIn&slippageBps=50&restrictIntermediateTokens=true`;

      deps.http.setResponse(expectedUrl, { body: quote1 });
      const res1 = await collectJupiterQuote(deps, VALID_CONTEXT);
      expect(res1.status).toBe("accepted");

      // Replay
      const res2 = await collectJupiterQuote(deps, VALID_CONTEXT);
      expect(res2.status).toBe("identical_replay");

      // Conflict
      const quote2 = makeJupiterQuote({ outAmount: "176000000" });
      deps.http.setResponse(expectedUrl, { body: quote2 });
      const res3 = await collectJupiterQuote(deps, VALID_CONTEXT);
      expect(res3.status).toBe("conflict");
    });
  });
});
