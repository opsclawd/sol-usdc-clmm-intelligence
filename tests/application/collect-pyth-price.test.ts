import { describe, expect, it } from "vitest";
import { HttpRequestError } from "../../src/ports/http.js";
import {
  makePythHermesEnvelope,
  makePythHermesPriceUpdate,
  makePythHermesParsedPrice,
  SOL_USD_FEED_ID
} from "../fixtures/pyth-price-update.js";
import { FakeHttp, FakeJsonStore, FakeEnv, FakeClock } from "../fakes/index.js";
import { FakeObservationRepo } from "../fakes/fake-observation-repo.js";
import { FakeNormalizedObservationRepo } from "../fakes/fake-normalized-observation-repo.js";
import type { PriceSourceResult } from "../../src/application/price-source-result.js";

const PYTH_HERMES_BASE_URL = "https://hermes.pyth.network";
const PYTH_API_KEY = "test-api-key-12345";
const PYTH_SOL_USD_FEED_ID = SOL_USD_FEED_ID;

const FIXED_CLOCK_TIME = "2026-05-10T12:00:00.000Z";
const FIXED_TIMESTAMP_SECS = Math.floor(new Date(FIXED_CLOCK_TIME).getTime() / 1000) - 30; // 30 seconds in the past

function makeRecentEnvelope(overrides?: {
  price?: string;
  confidence?: string;
  timestampSecs?: number;
}) {
  const timestampSecs = overrides?.timestampSecs ?? FIXED_TIMESTAMP_SECS;
  return makePythHermesEnvelope({
    parsed: [
      makePythHermesPriceUpdate({
        price: makePythHermesParsedPrice({
          timestamp: timestampSecs,
          price: overrides?.price ?? "175000000",
          confidence: overrides?.confidence ?? "1500000"
        })
      })
    ]
  });
}

function createDeps(clock?: FakeClock) {
  const c = clock ?? new FakeClock(FIXED_CLOCK_TIME);
  return {
    http: new FakeHttp(),
    jsonStore: new FakeJsonStore(),
    env: new FakeEnv({
      PYTH_HERMES_BASE_URL,
      PYTH_API_KEY,
      PYTH_SOL_USD_FEED_ID
    }),
    clock: c,
    rawObservationRepo: new FakeObservationRepo(),
    normalizedObservationRepo: new FakeNormalizedObservationRepo()
  };
}

async function importCollectPythPrice() {
  return import("../../src/application/collect-pyth-price.js");
}

const VALID_CONTEXT = Object.freeze({
  runId: "run-123",
  startedAtUnixMs: new Date(FIXED_CLOCK_TIME).getTime()
});

describe("collectPythPrice", () => {
  it("passes explicit immutable context without leaf environment rereads", async () => {
    const { collectPythPrice } = await importCollectPythPrice();
    const deps = createDeps();
    const validEnvelope = makeRecentEnvelope();
    const url = `${PYTH_HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(PYTH_SOL_USD_FEED_ID)}`;
    deps.http.setResponse(url, { body: validEnvelope });

    // Mock env to reject run ID reads
    deps.env.getOptional = (name) => {
      if (name === "INTELLIGENCE_PIPELINE_RUN_ID")
        throw new Error("Should not read run id from env");
      return undefined;
    };

    const result = await collectPythPrice(deps, VALID_CONTEXT);
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
    it("persists an accepted Pyth envelope before normalization and rejects malformed envelopes before raw insert", async () => {
      const { collectPythPrice } = await importCollectPythPrice();
      const deps = createDeps();

      const validEnvelope = makeRecentEnvelope();
      const url = `${PYTH_HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(PYTH_SOL_USD_FEED_ID)}`;
      deps.http.setResponse(url, { body: validEnvelope });

      const result = await collectPythPrice(deps, VALID_CONTEXT);

      expect(result.status).toBe("accepted");
      if (result.status !== "accepted") return;

      expect(result.rawObservationId).toBeDefined();
      expect(result.normalizedCount).toBe(1);

      const rawRows = deps.rawObservationRepo;
      const insertedRow = await rawRows.findById(result.rawObservationId!);
      expect(insertedRow).toBeDefined();
      expect(insertedRow?.parseStatus).toBe("parsed");

      const malformedEnvelope = { binary: "data", parsed: [] };
      deps.http.setResponse(url, { body: malformedEnvelope });

      const malformedResult = await collectPythPrice(deps, VALID_CONTEXT);
      expect(malformedResult.status).toBe("failed");
    });

    it("records redacted Pyth request metadata without credentials", async () => {
      const { collectPythPrice } = await importCollectPythPrice();
      const deps = createDeps();

      const validEnvelope = makeRecentEnvelope();
      const url = `${PYTH_HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(PYTH_SOL_USD_FEED_ID)}`;
      deps.http.setResponse(url, { body: validEnvelope });

      await collectPythPrice(deps, VALID_CONTEXT);

      const httpCall = deps.http.calls[0];
      expect(httpCall).toBeDefined();
      expect(httpCall?.url).toContain(PYTH_HERMES_BASE_URL);
      expect(httpCall?.url).toContain("/v2/updates/price/latest");
      expect(httpCall?.url).toContain(encodeURIComponent(PYTH_SOL_USD_FEED_ID));
      expect(httpCall?.options?.timeoutMs).toBe(5_000);
      expect(httpCall?.options?.maxAttempts).toBe(2);

      const rawRepo = deps.rawObservationRepo as FakeObservationRepo;
      const allRows = await rawRepo.findBySource("pyth-hermes", 0);
      const lastRow = allRows[allRows.length - 1];

      if (lastRow?.sourceRequestMeta) {
        const meta = lastRow.sourceRequestMeta as Record<string, unknown>;
        expect(meta).not.toHaveProperty("headers");
        expect(meta).not.toHaveProperty("apiKey");
        expect(meta).not.toHaveProperty("authorization");
      }
    });

    it("persists stale oracle evidence and returns an unusable stale outcome", async () => {
      const { collectPythPrice } = await importCollectPythPrice();
      const deps = createDeps();

      const clockTimestampSecs = Math.floor(new Date(FIXED_CLOCK_TIME).getTime() / 1000);
      const oldTimestamp = clockTimestampSecs - 120; // 120 seconds in the past relative to clock
      const staleEnvelope = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({ timestamp: oldTimestamp })
          })
        ]
      });

      const url = `${PYTH_HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(PYTH_SOL_USD_FEED_ID)}`;
      deps.http.setResponse(url, { body: staleEnvelope });

      const result = await collectPythPrice(deps, VALID_CONTEXT);

      expect(result.status).toBe("stale");
      if (result.status !== "stale") return;

      expect(result.rawObservationId).toBeDefined();
      expect(result.freshness).toBeDefined();
      expect(result.freshness?.isStale).toBe(true);
    });
  });

  describe("request configuration", () => {
    it("uses correct timeout and max attempts", async () => {
      const { collectPythPrice } = await importCollectPythPrice();
      const deps = createDeps();

      const url = `${PYTH_HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(PYTH_SOL_USD_FEED_ID)}`;
      deps.http.setResponse(url, { body: makeRecentEnvelope() });

      await collectPythPrice(deps, VALID_CONTEXT);

      const call = deps.http.calls[0];
      expect(call?.options?.timeoutMs).toBe(5_000);
      expect(call?.options?.maxAttempts).toBe(2);
    });

    it("builds correct URL with feed ID query parameter", async () => {
      const { collectPythPrice } = await importCollectPythPrice();
      const deps = createDeps();

      const url = `${PYTH_HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(PYTH_SOL_USD_FEED_ID)}`;
      deps.http.setResponse(url, { body: makeRecentEnvelope() });

      await collectPythPrice(deps, VALID_CONTEXT);

      expect(deps.http.calls[0]?.url).toBe(url);
    });
  });

  describe("receipt and publish timestamps", () => {
    it("derives observedAtUnixMs from price timestamp", async () => {
      const { collectPythPrice } = await importCollectPythPrice();
      const deps = createDeps();

      const nowSeconds = FIXED_TIMESTAMP_SECS;
      const envelope = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({ timestamp: nowSeconds })
          })
        ]
      });

      const url = `${PYTH_HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(PYTH_SOL_USD_FEED_ID)}`;
      deps.http.setResponse(url, { body: envelope });

      const result = await collectPythPrice(deps, VALID_CONTEXT);

      expect(result.status).toBe("accepted");
      if (result.status !== "accepted") return;

      const normalized = deps.normalizedObservationRepo as FakeNormalizedObservationRepo;
      const allRows = await normalized.findBySource("pyth-hermes", "oracle_price", 0);
      const normRow = allRows[allRows.length - 1];

      if (!normRow) {
        throw new Error("No normalized row found");
      }

      const payload = normRow.payload as { observedSource: { observedAtUnixMs: number } };
      expect(payload.observedSource.observedAtUnixMs).toBe(nowSeconds * 1000);
    });
  });

  describe("identical replay handling", () => {
    it("returns identical_replay status when same payload is submitted twice", async () => {
      const { collectPythPrice } = await importCollectPythPrice();
      const deps = createDeps();

      const envelope = makeRecentEnvelope();
      const url = `${PYTH_HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(PYTH_SOL_USD_FEED_ID)}`;
      deps.http.setResponse(url, { body: envelope });

      const result1 = await collectPythPrice(deps, VALID_CONTEXT);
      expect(result1.status).toBe("accepted");

      const result2 = await collectPythPrice(deps, VALID_CONTEXT);
      expect(result2.status).toBe("identical_replay");
      if (result2.status !== "identical_replay") return;

      expect((result2 as { rawObservationId: number }).rawObservationId).toBe(
        (result1 as { rawObservationId: number }).rawObservationId
      );
    });

    it("returns conflict when same identity has different payload", async () => {
      const { collectPythPrice } = await importCollectPythPrice();
      const deps = createDeps();

      const envelope1 = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({ price: "175000000" })
          })
        ]
      });

      const url = `${PYTH_HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(PYTH_SOL_USD_FEED_ID)}`;
      deps.http.setResponse(url, { body: envelope1 });

      await collectPythPrice(deps, VALID_CONTEXT);

      const envelope2 = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({ price: "176000000" })
          })
        ]
      });
      deps.http.setResponse(url, { body: envelope2 });

      const result = await collectPythPrice(deps, VALID_CONTEXT);
      expect(result.status).toBe("conflict");
    });
  });

  describe("wide-confidence degradation", () => {
    it("marks result as degraded when confidence interval is wide", async () => {
      const { collectPythPrice } = await importCollectPythPrice();
      const deps = createDeps();

      const envelope = makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            price: makePythHermesParsedPrice({
              price: "100000000",
              confidence: "3000000",
              exponent: -8,
              timestamp: FIXED_TIMESTAMP_SECS
            })
          })
        ]
      });

      const url = `${PYTH_HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(PYTH_SOL_USD_FEED_ID)}`;
      deps.http.setResponse(url, { body: envelope });

      const result = await collectPythPrice(deps, VALID_CONTEXT);

      expect(result.status).toBe("degraded");
    });
  });

  describe("error handling", () => {
    it("returns timeout error with safe summary", async () => {
      const { collectPythPrice } = await importCollectPythPrice();
      const deps = createDeps();

      const url = `${PYTH_HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(PYTH_SOL_USD_FEED_ID)}`;
      deps.http.setResponse(url, {
        error: new HttpRequestError("timeout", "Request timed out", null, true)
      });

      const result = await collectPythPrice(deps, VALID_CONTEXT);

      expect(result.status).toBe("timeout");
      if (result.status !== "timeout") return;

      expect(result.summary).toContain("timed");
      expect(result.summary.toLowerCase()).not.toContain("api");
      expect(result.summary.toLowerCase()).not.toContain("key");
    });

    it("returns network error with safe summary", async () => {
      const { collectPythPrice } = await importCollectPythPrice();
      const deps = createDeps();

      const url = `${PYTH_HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(PYTH_SOL_USD_FEED_ID)}`;
      deps.http.setResponse(url, {
        error: new HttpRequestError("network", "Connection failed", null, true)
      });

      const result = await collectPythPrice(deps, VALID_CONTEXT);

      expect(result.status).toBe("network");
    });

    it("returns unavailable when HTTP returns non-retryable error", async () => {
      const { collectPythPrice } = await importCollectPythPrice();
      const deps = createDeps();

      const url = `${PYTH_HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(PYTH_SOL_USD_FEED_ID)}`;
      deps.http.setResponse(url, {
        error: new HttpRequestError("http_status", "Service unavailable", 503, false)
      });

      const result = await collectPythPrice(deps, VALID_CONTEXT);

      expect(result.status).toBe("unavailable");
    });

    it("returns malformed when JSON parsing fails", async () => {
      const { collectPythPrice } = await importCollectPythPrice();
      const deps = createDeps();

      const url = `${PYTH_HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(PYTH_SOL_USD_FEED_ID)}`;
      deps.http.setResponse(url, {
        error: new HttpRequestError("invalid_json", "Unexpected token", null, false)
      });

      const result = await collectPythPrice(deps, VALID_CONTEXT);

      expect(result.status).toBe("malformed");
    });

    it("returns no_route when feed ID is not found in envelope", async () => {
      const { collectPythPrice } = await importCollectPythPrice();
      const deps = createDeps();

      const wrongFeedId = "0x0000000000000000000000000000000000000000000000000000000000000000";
      const envelope = makePythHermesEnvelope({
        parsed: [makePythHermesPriceUpdate({ id: wrongFeedId })]
      });

      const url = `${PYTH_HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(PYTH_SOL_USD_FEED_ID)}`;
      deps.http.setResponse(url, { body: envelope });

      const result = await collectPythPrice(deps, VALID_CONTEXT);

      expect(result.status).toBe("no_route");
    });
  });

  describe("PriceSourceResult union", () => {
    it("has stable safe summaries for all variants", async () => {
      const { PriceSourceResult } = await importCollectPythPrice();

      const acceptedResult = {
        status: "accepted" as const,
        rawObservationId: 1,
        normalizedCount: 1,
        warnings: [] as string[],
        freshness: {
          isStale: false,
          validUntilUnixMs: 0,
          derivedAt: 0,
          policyKind: "oracle_price" as const,
          reasons: []
        },
        confidenceLevel: "high" as const
      };
      expect(typeof PriceSourceResult.safeSummary(acceptedResult as PriceSourceResult)).toBe(
        "string"
      );

      const timeoutResult = { status: "timeout" as const, summary: "Request timed out" };
      expect(typeof PriceSourceResult.safeSummary(timeoutResult as PriceSourceResult)).toBe(
        "string"
      );
      expect(timeoutResult.summary.toLowerCase()).not.toContain("secret");

      const identicalResult = {
        status: "identical_replay" as const,
        rawObservationId: 1,
        normalizedCount: 1,
        warnings: [] as string[],
        freshness: {
          isStale: false,
          validUntilUnixMs: 0,
          derivedAt: 0,
          policyKind: "oracle_price" as const,
          reasons: []
        },
        confidenceLevel: "high" as const
      };
      expect(typeof PriceSourceResult.safeSummary(identicalResult as PriceSourceResult)).toBe(
        "string"
      );

      const staleResult = {
        status: "stale" as const,
        rawObservationId: 1,
        normalizedCount: 1,
        warnings: [] as string[],
        freshness: {
          isStale: true,
          validUntilUnixMs: 0,
          derivedAt: 0,
          policyKind: "oracle_price" as const,
          reasons: ["expired_past_max_observed_age"] as const
        },
        confidenceLevel: "medium" as const
      };
      expect(typeof PriceSourceResult.safeSummary(staleResult as PriceSourceResult)).toBe("string");

      const degradedResult = {
        status: "degraded" as const,
        rawObservationId: 1,
        normalizedCount: 1,
        warnings: ["wide_confidence_interval"] as string[],
        freshness: {
          isStale: false,
          validUntilUnixMs: 0,
          derivedAt: 0,
          policyKind: "oracle_price" as const,
          reasons: []
        },
        confidenceLevel: "medium" as const,
        reason: "wide_confidence_interval"
      };
      expect(typeof PriceSourceResult.safeSummary(degradedResult as PriceSourceResult)).toBe(
        "string"
      );

      const failedResult = { status: "failed" as const, summary: "Unknown error" };
      expect(typeof PriceSourceResult.safeSummary(failedResult as PriceSourceResult)).toBe(
        "string"
      );
    });
  });
});
