import { describe, it, expect, vi, type Mock } from "vitest";
import type { HttpClient } from "../../src/ports/http.js";
import type { JsonStore } from "../../src/ports/json-store.js";
import type { TextReader } from "../../src/ports/text-reader.js";
import type { EnvReader } from "../../src/ports/env.js";
import type { Clock } from "../../src/ports/clock.js";
import type { CommandRunner } from "../../src/ports/command-runner.js";
import type { RawObservationRepo } from "../../src/ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../../src/ports/normalized-observation-repo.js";
import type { DbConnection } from "../../src/ports/db.js";
import type { CollectClmmBundleResult } from "../../src/application/collect-clmm-bundle.js";
import type { NodeRuntime } from "../../src/adapters/node/composition-root.js";

function createMockEnvReader(envMap?: Record<string, string>): EnvReader {
  const map = envMap ?? {};
  return {
    get: vi.fn((name: string, fallback?: string) => {
      const value = map[name] ?? fallback;
      if (value == null || value.length === 0) {
        throw new Error(`Missing required environment variable: ${name}`);
      }
      return value;
    }),
    getOptional: vi.fn((name: string) => map[name] ?? undefined)
  };
}

function createMockClock(): Clock {
  return {
    now: vi.fn(() => new Date().toISOString())
  };
}

function createMockRawObservationRepo(): RawObservationRepo {
  return {
    insertOrClassify: vi.fn(),
    findById: vi.fn(),
    findByIdentity: vi.fn(),
    findByHash: vi.fn(),
    findBySource: vi.fn(),
    updateParseStatus: vi.fn()
  };
}

function createMockNormalizedObservationRepo(): NormalizedObservationRepo {
  return {
    insert: vi.fn(),
    insertMany: vi.fn(),
    findBySource: vi.fn(),
    findFreshByKind: vi.fn()
  };
}

function createMockCommandRunner(): CommandRunner {
  return {
    run: vi.fn().mockResolvedValue(undefined)
  };
}

function createMockHttpClient(): HttpClient {
  return {
    getJson: vi.fn()
  } as unknown as HttpClient;
}

function createMockJsonStore(): JsonStore {
  return {
    readJson: vi.fn(),
    writeJson: vi.fn()
  } as unknown as JsonStore;
}

function createMockTextReader(): TextReader {
  return {
    readText: vi.fn()
  };
}

const TEST_ENV = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  CLMM_DATA_API_BASE: "https://api.example.com",
  CLMM_INSIGHTS_API_KEY: "test-key",
  WALLET_PUBLIC_KEY: "test-wallet"
};

function makeValidBundleEnvelope() {
  return {
    bundle: {
      pair: "SOL/USDC",
      source: "orca",
      observedAtUnixMs: Date.now(),
      pool: {
        poolId: "pool-solusdc-123",
        pair: "SOL/USDC",
        source: "orca",
        observedAtUnixMs: Date.now(),
        tokenPairLabel: "SOL/USDC",
        currentPrice: 149.85,
        currentPriceLabel: "149.85",
        sqrtPrice: "122345678901234567890",
        tickCurrentIndex: 49800,
        tickSpacing: 60,
        feeRate: 0.0005,
        feeRateLabel: "0.05%",
        poolLiquidity: "9876543210",
        priceSource: "orca_whirlpool_sqrt_price"
      },
      srLevels: {
        briefId: "brief-001",
        sourceRecordedAtIso: new Date().toISOString(),
        summary: "SOL/USDC resistance at 150.5",
        capturedAtUnixMs: Date.now(),
        supports: [
          {
            price: 140.0,
            rank: "1h",
            timeframe: "1h",
            invalidation: 139.0,
            notes: "key level"
          }
        ],
        resistances: [
          {
            price: 150.5,
            rank: "1h",
            timeframe: "1h",
            invalidation: 149.0,
            notes: "key level"
          }
        ]
      },
      positions: [],
      alerts: [],
      dataQuality: {
        score: 95,
        isComplete: true,
        isPartial: false,
        missingFields: [],
        warnings: [],
        missingSources: []
      }
    },
    status: "ok"
  };
}

describe("clmm-bundle collector lifecycle", () => {
  describe("collector closes the database connection after success", () => {
    it("should close the database connection exactly once after successful collection", async () => {
      const closeMock = vi.fn().mockResolvedValue(undefined);
      const connection: DbConnection = { close: closeMock };
      const rawObservationRepo = createMockRawObservationRepo();
      const normalizedObservationRepo = createMockNormalizedObservationRepo();
      const env = createMockEnvReader(TEST_ENV);
      const clock = createMockClock();
      const http = createMockHttpClient();
      const jsonStore = createMockJsonStore();

      (http.getJson as Mock).mockResolvedValue(makeValidBundleEnvelope());

      (rawObservationRepo.insertOrClassify as Mock).mockResolvedValue({
        outcome: "inserted",
        row: {
          id: 1,
          source: "clmm-v2-bundle",
          sourceObservationKey: "key1",
          observedAtUnixMs: Date.now(),
          fetchedAtUnixMs: Date.now(),
          payloadHash: "hash1",
          payloadCanonical: "{}",
          parseStatus: "pending",
          sourceRequestMeta: null,
          receivedAtUnixMs: Date.now()
        }
      });

      const persistence = {
        connection,
        rawObservationRepo,
        normalizedObservationRepo
      };

      const runtime: NodeRuntime = {
        http,
        jsonStore,
        textReader: createMockTextReader(),
        env,
        clock,
        commandRunner: createMockCommandRunner(),
        getDb: vi.fn(),
        getPersistence: vi.fn().mockResolvedValue(persistence)
      };

      const { runClmmBundleCollector } = await import("../../scripts/collectors/clmm-bundle.js");
      await runClmmBundleCollector(runtime);

      expect(closeMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("collector closes the database connection after collection failure and preserves the collection error", () => {
    it("should close the database connection even when collection fails", async () => {
      const closeMock = vi.fn().mockResolvedValue(undefined);
      const connection: DbConnection = { close: closeMock };
      const rawObservationRepo = createMockRawObservationRepo();
      const normalizedObservationRepo = createMockNormalizedObservationRepo();
      const env = createMockEnvReader(TEST_ENV);
      const clock = createMockClock();
      const http = createMockHttpClient();
      const jsonStore = createMockJsonStore();

      (http.getJson as Mock).mockResolvedValue(makeValidBundleEnvelope());

      (rawObservationRepo.insertOrClassify as Mock).mockRejectedValue(new Error("Network failure"));

      const persistence = {
        connection,
        rawObservationRepo,
        normalizedObservationRepo
      };

      const runtime: NodeRuntime = {
        http,
        jsonStore,
        textReader: createMockTextReader(),
        env,
        clock,
        commandRunner: createMockCommandRunner(),
        getDb: vi.fn(),
        getPersistence: vi.fn().mockResolvedValue(persistence)
      };

      const { runClmmBundleCollector } = await import("../../scripts/collectors/clmm-bundle.js");

      await expect(runClmmBundleCollector(runtime)).rejects.toThrow("Network failure");
      expect(closeMock).toHaveBeenCalledTimes(1);
    });

    it("should preserve the original collection error and not replace it with close error", async () => {
      const collectionError = new Error("Collection failed");
      const closeMock = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("Close failed"));
      const connection: DbConnection = { close: closeMock };
      const rawObservationRepo = createMockRawObservationRepo();
      const normalizedObservationRepo = createMockNormalizedObservationRepo();
      const env = createMockEnvReader(TEST_ENV);
      const clock = createMockClock();
      const http = createMockHttpClient();
      const jsonStore = createMockJsonStore();

      (http.getJson as Mock).mockResolvedValue(makeValidBundleEnvelope());

      (rawObservationRepo.insertOrClassify as Mock).mockRejectedValue(collectionError);

      const persistence = {
        connection,
        rawObservationRepo,
        normalizedObservationRepo
      };

      const runtime: NodeRuntime = {
        http,
        jsonStore,
        textReader: createMockTextReader(),
        env,
        clock,
        commandRunner: createMockCommandRunner(),
        getDb: vi.fn(),
        getPersistence: vi.fn().mockResolvedValue(persistence)
      };

      const { runClmmBundleCollector } = await import("../../scripts/collectors/clmm-bundle.js");

      await expect(runClmmBundleCollector(runtime)).rejects.toThrow(collectionError);
      expect(closeMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("composition root creates raw and normalized repositories over the same lazily-created Drizzle database", () => {
    it("should create both repositories over the same database connection", async () => {
      const { createNodeRuntime } = await import("../../src/adapters/node/composition-root.js");

      const originalEnvGet = process.env.DATABASE_URL;
      process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

      try {
        const runtime = createNodeRuntime();
        const result = await runtime.getPersistence();

        expect(result.rawObservationRepo).toBeDefined();
        expect(result.normalizedObservationRepo).toBeDefined();
        expect(result.connection).toBeDefined();

        expect(result.rawObservationRepo).not.toBe(result.normalizedObservationRepo);

        const rawRepo = result.rawObservationRepo;
        const normalizedRepo = result.normalizedObservationRepo;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((rawRepo as any).db).toBe((normalizedRepo as any).db);
      } finally {
        if (originalEnvGet !== undefined) {
          process.env.DATABASE_URL = originalEnvGet;
        } else {
          delete process.env.DATABASE_URL;
        }
      }
    });

    it("should lazily create the database connection on first call", async () => {
      const { createNodeRuntime } = await import("../../src/adapters/node/composition-root.js");

      const originalEnvGet = process.env.DATABASE_URL;
      process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

      try {
        const runtime = createNodeRuntime();

        expect(runtime.getPersistence).toBeDefined();

        const result1 = await runtime.getPersistence();
        const result2 = await runtime.getPersistence();

        expect(result1.connection).toBe(result2.connection);
        expect(result1.rawObservationRepo).toBe(result2.rawObservationRepo);
        expect(result1.normalizedObservationRepo).toBe(result2.normalizedObservationRepo);
      } finally {
        if (originalEnvGet !== undefined) {
          process.env.DATABASE_URL = originalEnvGet;
        } else {
          delete process.env.DATABASE_URL;
        }
      }
    });
  });
});

describe("clmmBundleJob result type", () => {
  it("should preserve the CollectClmmBundleResult type", async () => {
    const rawObservationRepo = createMockRawObservationRepo();
    const normalizedObservationRepo = createMockNormalizedObservationRepo();
    const env = createMockEnvReader(TEST_ENV);
    const clock = createMockClock();
    const http = createMockHttpClient();
    const jsonStore = createMockJsonStore();

    const mockResult: CollectClmmBundleResult = {
      rawObservationId: 123,
      rawOutcome: {
        outcome: "inserted",
        row: {
          id: 123,
          source: "clmm-v2-bundle",
          sourceObservationKey: "key1",
          observedAtUnixMs: Date.now(),
          fetchedAtUnixMs: Date.now(),
          payloadHash: "hash1",
          payloadCanonical: "{}",
          parseStatus: "parsed",
          sourceRequestMeta: null,
          receivedAtUnixMs: Date.now()
        }
      },
      normalizedCount: 2,
      parseStatus: "parsed"
    };

    (http.getJson as Mock).mockResolvedValue(makeValidBundleEnvelope());
    (rawObservationRepo.insertOrClassify as Mock).mockResolvedValue(mockResult.rawOutcome);

    const { clmmBundleJob } = await import("../../src/jobs/clmm-bundle-job.js");

    const job = clmmBundleJob({
      http,
      jsonStore,
      env,
      clock,
      rawObservationRepo,
      normalizedObservationRepo
    });

    const result = await job();
    expect(result.rawObservationId).toBe(mockResult.rawObservationId);
    expect(result.rawOutcome.outcome).toBe(mockResult.rawOutcome.outcome);
    expect(result.parseStatus).toBe(mockResult.parseStatus);
    expect(typeof result.normalizedCount).toBe("number");
  });
});
