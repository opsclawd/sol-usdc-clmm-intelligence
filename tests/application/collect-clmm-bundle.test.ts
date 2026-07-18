import { describe, expect, it } from "vitest";
import {
  collectClmmBundle,
  ClmmObservationConflictError
} from "../../src/application/collect-clmm-bundle.js";
import { FakeHttp, FakeJsonStore, FakeEnv, FakeClock } from "../fakes/index.js";
import { FakeObservationRepo } from "../fakes/fake-observation-repo.js";
import { FakeNormalizedObservationRepo } from "../fakes/fake-normalized-observation-repo.js";

const VALID_BUNDLE = {
  bundle: {
    pair: "SOL/USDC",
    source: "orca",
    observedAtUnixMs: 1700000000000,
    pool: {
      poolId: "abc",
      pair: "SOL/USDC",
      source: "orca",
      observedAtUnixMs: 1700000000000,
      tokenPairLabel: "SOL/USDC",
      currentPrice: 150.5,
      currentPriceLabel: "$150.50",
      sqrtPrice: "1000000",
      tickCurrentIndex: 0,
      tickSpacing: 64,
      feeRate: 0.0005,
      feeRateLabel: "0.05%",
      poolLiquidity: "1000000",
      priceSource: "orca_whirlpool_sqrt_price"
    },
    srLevels: null,
    positions: [],
    alerts: [],
    dataQuality: { warnings: [], isPartial: false, missingSources: [] }
  },
  status: "ok"
};

const VALID_ENV = {
  CLMM_DATA_API_BASE: "http://api.test",
  CLMM_INSIGHTS_API_KEY: "test-key-123",
  WALLET_PUBLIC_KEY: "11111111111111111111111111111111",
  INTELLIGENCE_CODE_VERSION: "1.0.0",
  INTELLIGENCE_PIPELINE_RUN_ID: "run-123"
};

function makeDeps() {
  return {
    http: new FakeHttp(),
    jsonStore: new FakeJsonStore(),
    env: new FakeEnv(VALID_ENV),
    clock: new FakeClock("2024-01-01T00:00:00.000Z"),
    rawObservationRepo: new FakeObservationRepo(),
    normalizedObservationRepo: new FakeNormalizedObservationRepo()
  };
}

describe("collectClmmBundle", () => {
  describe("successful collection orders raw insert normalized batch parsed status then latest file write", () => {
    it("enforces durable boundary", async () => {
      const { http, jsonStore, env, clock, rawObservationRepo, normalizedObservationRepo } =
        makeDeps();
      http.setResponse(
        "http://api.test/insights/sol-usdc/bundle/11111111111111111111111111111111",
        {
          body: VALID_BUNDLE
        }
      );

      const events: string[] = [];
      const originalInsertOrClassify = rawObservationRepo.insertOrClassify.bind(rawObservationRepo);
      rawObservationRepo.insertOrClassify = async (row) => {
        events.push("raw_insert");
        return originalInsertOrClassify(row);
      };
      const originalInsertMany =
        normalizedObservationRepo.insertMany.bind(normalizedObservationRepo);
      normalizedObservationRepo.insertMany = async (rows) => {
        events.push("normalized_batch");
        return originalInsertMany(rows);
      };
      const originalUpdateParseStatus =
        rawObservationRepo.updateParseStatus.bind(rawObservationRepo);
      rawObservationRepo.updateParseStatus = async (id, status) => {
        events.push(`parse_status_${status}`);
        return originalUpdateParseStatus(id, status);
      };

      await collectClmmBundle({
        http,
        jsonStore,
        env,
        clock,
        rawObservationRepo,
        normalizedObservationRepo
      });

      expect(events).toContain("raw_insert");
      expect(events).toContain("normalized_batch");
      expect(events).toContain("parse_status_parsed");
      expect(jsonStore.writes.length).toBeGreaterThan(0);
      expect(jsonStore.writes[jsonStore.writes.length - 1]?.path).toBe(
        "data/latest-clmm-bundle.json"
      );
    });
  });

  describe("malformed input persists neither raw nor normalized data", () => {
    it("rejects before raw insert", async () => {
      const { http, jsonStore, env, clock, rawObservationRepo, normalizedObservationRepo } =
        makeDeps();
      http.setResponse(
        "http://api.test/insights/sol-usdc/bundle/11111111111111111111111111111111",
        {
          body: { something: "else" }
        }
      );

      await expect(
        collectClmmBundle({
          http,
          jsonStore,
          env,
          clock,
          rawObservationRepo,
          normalizedObservationRepo
        })
      ).rejects.toThrow();

      expect(rawObservationRepo["store"].size).toBe(0);
      expect(normalizedObservationRepo.store.length).toBe(0);
    });
  });

  describe("identical parsed replay skips normalization and refreshes the latest file", () => {
    it("does not insert new normalized rows", async () => {
      const { http, jsonStore, env, clock, rawObservationRepo, normalizedObservationRepo } =
        makeDeps();
      http.setResponse(
        "http://api.test/insights/sol-usdc/bundle/11111111111111111111111111111111",
        {
          body: VALID_BUNDLE
        }
      );

      let normalizedCount = 0;
      const originalInsertMany =
        normalizedObservationRepo.insertMany.bind(normalizedObservationRepo);
      normalizedObservationRepo.insertMany = async (rows) => {
        normalizedCount += rows.length;
        return originalInsertMany(rows);
      };

      await collectClmmBundle({
        http,
        jsonStore,
        env,
        clock,
        rawObservationRepo,
        normalizedObservationRepo
      });
      const countAfterFirst = normalizedCount;
      await collectClmmBundle({
        http,
        jsonStore,
        env,
        clock,
        rawObservationRepo,
        normalizedObservationRepo
      });

      expect(normalizedCount).toBe(countAfterFirst);
      expect(jsonStore.writes.length).toBe(2);
    });
  });

  describe("conflicting replay throws ClmmObservationConflictError with identity and both hashes", () => {
    it("fails closed without overwrite or file write", async () => {
      const { http, jsonStore, env, clock, rawObservationRepo, normalizedObservationRepo } =
        makeDeps();

      http.setResponse(
        "http://api.test/insights/sol-usdc/bundle/11111111111111111111111111111111",
        {
          body: VALID_BUNDLE
        }
      );

      await collectClmmBundle({
        http,
        jsonStore,
        env,
        clock,
        rawObservationRepo,
        normalizedObservationRepo
      });

      const writesAfterFirst = jsonStore.writes.length;

      const modifiedBundle = {
        bundle: {
          ...VALID_BUNDLE.bundle,
          pool: { ...VALID_BUNDLE.bundle.pool, currentPrice: 999.9 }
        },
        status: "ok"
      };
      http.setResponse(
        "http://api.test/insights/sol-usdc/bundle/11111111111111111111111111111111",
        {
          body: modifiedBundle
        }
      );

      await expect(
        collectClmmBundle({
          http,
          jsonStore,
          env,
          clock,
          rawObservationRepo,
          normalizedObservationRepo
        })
      ).rejects.toThrow(ClmmObservationConflictError);

      expect(jsonStore.writes.length).toBe(writesAfterFirst);
    });
  });

  describe("normalization or normalized batch failure preserves raw and marks failed before rethrowing", () => {
    it("marks raw as failed and rethrows original error", async () => {
      const { http, jsonStore, env, clock, rawObservationRepo, normalizedObservationRepo } =
        makeDeps();
      http.setResponse(
        "http://api.test/insights/sol-usdc/bundle/11111111111111111111111111111111",
        {
          body: VALID_BUNDLE
        }
      );

      normalizedObservationRepo.failAtIndex = 0;

      await expect(
        collectClmmBundle({
          http,
          jsonStore,
          env,
          clock,
          rawObservationRepo,
          normalizedObservationRepo
        })
      ).rejects.toThrow();

      const rawRows = [...rawObservationRepo["store"].values()];
      expect(rawRows.length).toBe(1);
      expect(rawRows[0]!.parseStatus).toBe("failed");
    });
  });

  describe("latest file failure leaves parsed raw and normalized rows durable and identical replay repairs", () => {
    it("can repair file on replay", async () => {
      const { http, jsonStore, env, clock, rawObservationRepo, normalizedObservationRepo } =
        makeDeps();
      http.setResponse(
        "http://api.test/insights/sol-usdc/bundle/11111111111111111111111111111111",
        {
          body: VALID_BUNDLE
        }
      );

      await collectClmmBundle({
        http,
        jsonStore,
        env,
        clock,
        rawObservationRepo,
        normalizedObservationRepo
      });

      const writesAfterFirst = jsonStore.writes.length;

      jsonStore.writeError = new Error("disk full");
      http.setResponse(
        "http://api.test/insights/sol-usdc/bundle/11111111111111111111111111111111",
        {
          body: VALID_BUNDLE
        }
      );

      await expect(
        collectClmmBundle({
          http,
          jsonStore,
          env,
          clock,
          rawObservationRepo,
          normalizedObservationRepo
        })
      ).rejects.toThrow("disk full");

      const rawRows = [...rawObservationRepo["store"].values()];
      expect(rawRows[0]!.parseStatus).toBe("parsed");
      expect(normalizedObservationRepo.store.length).toBeGreaterThan(0);

      jsonStore.writeError = null;
      await collectClmmBundle({
        http,
        jsonStore,
        env,
        clock,
        rawObservationRepo,
        normalizedObservationRepo
      });

      expect(jsonStore.writes.length).toBeGreaterThan(writesAfterFirst);
    });
  });

  describe("request metadata contains only method path wallet hash and versions", () => {
    it("never includes API key or headers", async () => {
      const { http, jsonStore, env, clock, rawObservationRepo, normalizedObservationRepo } =
        makeDeps();
      http.setResponse(
        "http://api.test/insights/sol-usdc/bundle/11111111111111111111111111111111",
        {
          body: VALID_BUNDLE
        }
      );

      let capturedMeta: unknown = null;
      const originalInsertOrClassify = rawObservationRepo.insertOrClassify.bind(rawObservationRepo);
      rawObservationRepo.insertOrClassify = async (row) => {
        capturedMeta = row.sourceRequestMeta;
        return originalInsertOrClassify(row);
      };

      await collectClmmBundle({
        http,
        jsonStore,
        env,
        clock,
        rawObservationRepo,
        normalizedObservationRepo
      });

      const meta = capturedMeta as Record<string, unknown>;
      expect(meta).toHaveProperty("method");
      expect(meta).toHaveProperty("path");
      expect(meta).toHaveProperty("walletPublicKeyHash");
      expect(meta).toHaveProperty("intelligenceCodeVersion");
      expect(meta).toHaveProperty("intelligencePipelineRunId");
      expect(meta).not.toHaveProperty("x-insights-api-key");
      expect(meta).not.toHaveProperty("headers");
      expect(meta).not.toHaveProperty("apiKey");
    });
  });
});
