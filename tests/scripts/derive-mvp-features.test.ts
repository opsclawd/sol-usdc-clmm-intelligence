import { describe, it, expect, vi, type Mock, beforeEach } from "vitest";
import type { Clock } from "../../src/ports/clock.js";
import type { RunIdFactory } from "../../src/ports/run-id.js";
import type { EnvReader } from "../../src/ports/env.js";
import type { NodeRuntime } from "../../src/adapters/node/composition-root.js";
import type { RetryControl } from "../../src/ports/retry.js";
import { runDeriveMvpFeaturesScript } from "../../scripts/collectors/derive-mvp-features.js";

function createMockRetryControl(): RetryControl {
  return {
    sleep: vi.fn().mockResolvedValue(undefined),
    jitterUnit: vi.fn().mockReturnValue(0)
  };
}

function createMockClock(now?: string): Clock {
  return {
    now: vi.fn(() => now ?? new Date().toISOString())
  };
}

function createMockNormalizedObservationRepo() {
  return {
    insert: vi.fn(),
    insertMany: vi.fn(),
    findBySource: vi.fn(),
    findFreshByKind: vi.fn(),
    findLatestByKind: vi.fn(),
    findByRawObservation: vi.fn(),
    listCandidates: vi.fn(),
    findByIds: vi.fn()
  };
}

function createMockFeatureRepo() {
  return {
    insert: vi.fn(),
    insertMany: vi.fn(),
    findByDerivationKey: vi.fn(),
    findByKind: vi.fn(),
    listBundleCandidates: vi.fn()
  };
}

function createMockEnvReader(envMap: Record<string, string> = {}): EnvReader {
  const map = { ...envMap };
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

function createMockRunIdFactory(): RunIdFactory {
  return { nextRunId: vi.fn(() => "test-run-id") };
}

describe("runtime persistence exposes all three repositories from one connection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should create raw, normalized, and derived repositories over the same lazy database connection", async () => {
    const { createNodeRuntime } = await import("../../src/adapters/node/composition-root.js");

    const originalEnvGet = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

    try {
      const runtime = createNodeRuntime();
      const result = await runtime.getPersistence();

      expect(result.rawObservationRepo).toBeDefined();
      expect(result.normalizedObservationRepo).toBeDefined();
      expect(result.featureRepo).toBeDefined();
      expect(result.connection).toBeDefined();

      expect(result.rawObservationRepo).not.toBe(result.normalizedObservationRepo);
      expect(result.rawObservationRepo).not.toBe(result.featureRepo);
      expect(result.normalizedObservationRepo).not.toBe(result.featureRepo);

      const rawRepo = result.rawObservationRepo;
      const normalizedRepo = result.normalizedObservationRepo;
      const featureRepoResult = result.featureRepo;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((rawRepo as any).db).toBe((normalizedRepo as any).db);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((rawRepo as any).db).toBe((featureRepoResult as any).db);
    } finally {
      if (originalEnvGet !== undefined) {
        process.env.DATABASE_URL = originalEnvGet;
      } else {
        delete process.env.DATABASE_URL;
      }
    }
  });

  it("should lazily create the database connection on first call to getPersistence", async () => {
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
      expect(result1.featureRepo).toBe(result2.featureRepo);
    } finally {
      if (originalEnvGet !== undefined) {
        process.env.DATABASE_URL = originalEnvGet;
      } else {
        delete process.env.DATABASE_URL;
      }
    }
  });
});

describe("deriveMvpFeaturesJob thin job", () => {
  describe("job performs no publication or source collection", () => {
    it("should only bind clock, normalized repo, feature repo, run ID, and request metadata", async () => {
      const normalizedObservationRepo = createMockNormalizedObservationRepo();
      const featureRepo = createMockFeatureRepo();
      const clock = createMockClock();
      const runIdFactory = createMockRunIdFactory();

      const mockRows = [
        { id: 1, status: "AVAILABLE" as const },
        { id: 2, status: "UNAVAILABLE" as const }
      ];

      (featureRepo.insertMany as Mock).mockResolvedValue(mockRows);
      (normalizedObservationRepo.listCandidates as Mock).mockResolvedValue([]);

      const { deriveMvpFeaturesJob } = await import("../../src/jobs/derive-mvp-features-job.js");

      const job = deriveMvpFeaturesJob({
        clock,
        normalizedObservationRepo,
        featureRepo,
        runIdFactory
      });

      const result = await job({
        poolId: "test-pool",
        positionIds: ["pos1", "pos2"]
      });

      expect(result.counts).toBeDefined();
      expect(result.rows).toHaveLength(2);
      expect(runIdFactory.nextRunId).toHaveBeenCalled();
      expect(clock.now).toHaveBeenCalledTimes(1);
    });

    it("reads clock exactly once and passes parsed Unix milliseconds into derivation", async () => {
      const normalizedObservationRepo = createMockNormalizedObservationRepo();
      const featureRepo = createMockFeatureRepo();
      const isoTime = "2026-05-10T15:30:00.000Z";
      const expectedUnixMs = new Date(isoTime).getTime();
      const clock = createMockClock(isoTime);
      const runIdFactory = createMockRunIdFactory();

      const mockRows = [{ id: 1, status: "AVAILABLE" as const, asOfUnixMs: expectedUnixMs }];
      (featureRepo.insertMany as Mock).mockResolvedValue(mockRows);
      (normalizedObservationRepo.listCandidates as Mock).mockResolvedValue([]);

      const { deriveMvpFeaturesJob } = await import("../../src/jobs/derive-mvp-features-job.js");

      const job = deriveMvpFeaturesJob({
        clock,
        normalizedObservationRepo,
        featureRepo,
        runIdFactory
      });

      const result = await job({
        poolId: "test-pool",
        positionIds: ["pos1"]
      });

      expect(clock.now).toHaveBeenCalledTimes(1);
      for (const row of result.rows) {
        expect(row.asOfUnixMs).toBe(expectedUnixMs);
      }
    });

    it("should not call any HTTP, jsonStore, textReader, or commandRunner", async () => {
      const normalizedObservationRepo = createMockNormalizedObservationRepo();
      const featureRepo = createMockFeatureRepo();
      const clock = createMockClock();
      const runIdFactory = createMockRunIdFactory();

      const mockRows = [{ id: 1, status: "AVAILABLE" as const }];
      (featureRepo.insertMany as Mock).mockResolvedValue(mockRows);
      (normalizedObservationRepo.listCandidates as Mock).mockResolvedValue([]);

      const { deriveMvpFeaturesJob } = await import("../../src/jobs/derive-mvp-features-job.js");

      const job = deriveMvpFeaturesJob({
        clock,
        normalizedObservationRepo,
        featureRepo,
        runIdFactory
      });

      await job({ poolId: "pool-123", positionIds: ["pos-A"] });

      expect(featureRepo.insertMany).toHaveBeenCalled();
      expect(normalizedObservationRepo.listCandidates).toHaveBeenCalled();
    });

    it("should return counts with AVAILABLE, PARTIAL, and UNAVAILABLE keys", async () => {
      const normalizedObservationRepo = createMockNormalizedObservationRepo();
      const featureRepo = createMockFeatureRepo();
      const clock = createMockClock();
      const runIdFactory = createMockRunIdFactory();

      const mockRows = [
        { id: 1, status: "AVAILABLE" as const },
        { id: 2, status: "PARTIAL" as const },
        { id: 3, status: "UNAVAILABLE" as const },
        { id: 4, status: "AVAILABLE" as const }
      ];

      (featureRepo.insertMany as Mock).mockResolvedValue(mockRows);
      (normalizedObservationRepo.listCandidates as Mock).mockResolvedValue([]);

      const { deriveMvpFeaturesJob } = await import("../../src/jobs/derive-mvp-features-job.js");

      const job = deriveMvpFeaturesJob({
        clock,
        normalizedObservationRepo,
        featureRepo,
        runIdFactory
      });

      const result = await job({
        poolId: "test-pool",
        positionIds: ["pos1"]
      });

      expect(result.counts["AVAILABLE"]).toBe(2);
      expect(result.counts["PARTIAL"]).toBe(1);
      expect(result.counts["UNAVAILABLE"]).toBe(1);
    });

    it("should throw when normalizedObservationRepo.listCandidates fails", async () => {
      const normalizedObservationRepo = createMockNormalizedObservationRepo();
      const featureRepo = createMockFeatureRepo();
      const clock = createMockClock();
      const runIdFactory = createMockRunIdFactory();

      (normalizedObservationRepo.listCandidates as Mock).mockRejectedValue(
        new Error("Database query failed")
      );

      const { deriveMvpFeaturesJob } = await import("../../src/jobs/derive-mvp-features-job.js");

      const job = deriveMvpFeaturesJob({
        clock,
        normalizedObservationRepo,
        featureRepo,
        runIdFactory
      });

      await expect(job({ poolId: "pool-123", positionIds: ["pos-A"] })).rejects.toThrow(
        "MVP feature derivation failed"
      );
    });
  });
});

describe("derive-mvp-features script", () => {
  it("script prints deterministic status counts and sorted warnings after persistence", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const normalizedObservationRepo = createMockNormalizedObservationRepo();
    const featureRepo = createMockFeatureRepo();

    const mockRows = [
      { id: 1, status: "AVAILABLE" as const },
      { id: 2, status: "PARTIAL" as const },
      { id: 3, status: "UNAVAILABLE" as const },
      { id: 4, status: "AVAILABLE" as const }
    ];

    (featureRepo.insertMany as Mock).mockResolvedValue(mockRows);
    (normalizedObservationRepo.listCandidates as Mock).mockResolvedValue([]);

    const env = createMockEnvReader({
      WHIRLPOOL_ADDRESS: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
      INTELLIGENCE_POSITION_IDS: "pos2, pos1, pos1",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test"
    });

    const runtime: NodeRuntime = {
      http: { getJson: vi.fn() } as unknown as NodeRuntime["http"],
      jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env,
      clock: createMockClock(),
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: createMockRunIdFactory(),
      retryControl: createMockRetryControl(),
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: vi.fn().mockResolvedValue(undefined) },
        normalizedObservationRepo,
        featureRepo
      }),
      getContract: vi.fn()
    };

    const result = await runDeriveMvpFeaturesScript(runtime);

    expect(result.counts["AVAILABLE"]).toBe(2);
    expect(result.counts["PARTIAL"]).toBe(1);
    expect(result.counts["UNAVAILABLE"]).toBe(1);

    expect(consoleSpy).toHaveBeenCalled();
    const firstCall = consoleSpy.mock.calls[0];
    expect(firstCall).toBeDefined();
    const loggedJson = JSON.parse(firstCall![0] as string);
    expect(loggedJson.counts).toEqual({
      AVAILABLE: 2,
      PARTIAL: 1,
      UNAVAILABLE: 1
    });
    expect(Array.isArray(loggedJson.warnings)).toBe(true);

    consoleSpy.mockRestore();
  });

  it("script fails for missing scope malformed position list or infrastructure failure", async () => {
    const normalizedObservationRepo = createMockNormalizedObservationRepo();
    const featureRepo = createMockFeatureRepo();

    // 1. Missing WHIRLPOOL_ADDRESS
    const envMissingPool = createMockEnvReader({
      INTELLIGENCE_POSITION_IDS: "pos1",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test"
    });
    const runtimeMissingPool: NodeRuntime = {
      http: { getJson: vi.fn() } as unknown as NodeRuntime["http"],
      jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env: envMissingPool,
      clock: createMockClock(),
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: createMockRunIdFactory(),
      retryControl: createMockRetryControl(),
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: vi.fn().mockResolvedValue(undefined) },
        normalizedObservationRepo,
        featureRepo
      }),
      getContract: vi.fn()
    };
    await expect(runDeriveMvpFeaturesScript(runtimeMissingPool)).rejects.toThrow(
      "Missing required environment variable: WHIRLPOOL_ADDRESS"
    );

    // 2. Empty position list
    const envEmptyPositions = createMockEnvReader({
      WHIRLPOOL_ADDRESS: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
      INTELLIGENCE_POSITION_IDS: "   ,   ",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test"
    });
    const runtimeEmptyPositions: NodeRuntime = {
      ...runtimeMissingPool,
      env: envEmptyPositions
    };
    await expect(runDeriveMvpFeaturesScript(runtimeEmptyPositions)).rejects.toThrow(
      "INTELLIGENCE_POSITION_IDS cannot be empty"
    );

    // 3. Infrastructure (DB) failure
    (normalizedObservationRepo.listCandidates as Mock).mockRejectedValue(
      new Error("Database query failed")
    );
    const envDbFail = createMockEnvReader({
      WHIRLPOOL_ADDRESS: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
      INTELLIGENCE_POSITION_IDS: "pos1",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test"
    });
    const runtimeDbFail: NodeRuntime = {
      ...runtimeMissingPool,
      env: envDbFail
    };
    await expect(runDeriveMvpFeaturesScript(runtimeDbFail)).rejects.toThrow(
      "MVP feature derivation failed"
    );
  });

  describe("script validation", () => {
    it("should throw for missing WHIRLPOOL_ADDRESS", async () => {
      const env = createMockEnvReader({
        INTELLIGENCE_POSITION_IDS: "pos1",
        DATABASE_URL: "postgresql://test:test@localhost:5432/test"
      });

      const runtime: NodeRuntime = {
        http: { getJson: vi.fn() } as unknown as NodeRuntime["http"],
        jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
        textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
        env,
        clock: createMockClock(),
        commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
        runIdFactory: createMockRunIdFactory(),
        retryControl: createMockRetryControl(),
        getDb: vi.fn(),
        getPersistence: vi.fn().mockResolvedValue({
          connection: { close: vi.fn().mockResolvedValue(undefined) },
          normalizedObservationRepo: createMockNormalizedObservationRepo(),
          featureRepo: createMockFeatureRepo()
        }),
        getContract: vi.fn()
      };

      await expect(runDeriveMvpFeaturesScript(runtime)).rejects.toThrow(
        "Missing required environment variable: WHIRLPOOL_ADDRESS"
      );
    });

    it("should throw when INTELLIGENCE_POSITION_IDS is empty", async () => {
      const env = createMockEnvReader({
        WHIRLPOOL_ADDRESS: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        INTELLIGENCE_POSITION_IDS: "",
        DATABASE_URL: "postgresql://test:test@localhost:5432/test"
      });

      const runtime: NodeRuntime = {
        http: { getJson: vi.fn() } as unknown as NodeRuntime["http"],
        jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
        textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
        env,
        clock: createMockClock(),
        commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
        runIdFactory: createMockRunIdFactory(),
        retryControl: createMockRetryControl(),
        getDb: vi.fn(),
        getPersistence: vi.fn().mockResolvedValue({
          connection: { close: vi.fn().mockResolvedValue(undefined) },
          normalizedObservationRepo: createMockNormalizedObservationRepo(),
          featureRepo: createMockFeatureRepo()
        }),
        getContract: vi.fn()
      };

      await expect(runDeriveMvpFeaturesScript(runtime)).rejects.toThrow(
        "INTELLIGENCE_POSITION_IDS cannot be empty"
      );
    });

    it("should produce mixed status output when job returns available, partial, and unavailable", async () => {
      const normalizedObservationRepo = createMockNormalizedObservationRepo();
      const featureRepo = createMockFeatureRepo();

      const mockRows = [
        { id: 1, status: "AVAILABLE" as const },
        { id: 2, status: "PARTIAL" as const },
        { id: 3, status: "UNAVAILABLE" as const },
        { id: 4, status: "AVAILABLE" as const }
      ];

      (featureRepo.insertMany as Mock).mockResolvedValue(mockRows);
      (normalizedObservationRepo.listCandidates as Mock).mockResolvedValue([]);

      const env = createMockEnvReader({
        WHIRLPOOL_ADDRESS: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        INTELLIGENCE_POSITION_IDS: "pos1,pos2",
        DATABASE_URL: "postgresql://test:test@localhost:5432/test"
      });

      const runtime: NodeRuntime = {
        http: { getJson: vi.fn() } as unknown as NodeRuntime["http"],
        jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
        textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
        env,
        clock: createMockClock(),
        commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
        runIdFactory: createMockRunIdFactory(),
        retryControl: createMockRetryControl(),
        getDb: vi.fn(),
        getPersistence: vi.fn().mockResolvedValue({
          connection: { close: vi.fn().mockResolvedValue(undefined) },
          normalizedObservationRepo,
          featureRepo
        }),
        getContract: vi.fn()
      };

      const result = await runDeriveMvpFeaturesScript(runtime);

      expect(result.counts["AVAILABLE"]).toBe(2);
      expect(result.counts["PARTIAL"]).toBe(1);
      expect(result.counts["UNAVAILABLE"]).toBe(1);
    });

    it("should throw when job throws (database failure)", async () => {
      const normalizedObservationRepo = createMockNormalizedObservationRepo();
      const featureRepo = createMockFeatureRepo();

      (normalizedObservationRepo.listCandidates as Mock).mockRejectedValue(
        new Error("Database query failed")
      );

      const env = createMockEnvReader({
        WHIRLPOOL_ADDRESS: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        INTELLIGENCE_POSITION_IDS: "pos1,pos2",
        DATABASE_URL: "postgresql://test:test@localhost:5432/test"
      });

      const runtime: NodeRuntime = {
        http: { getJson: vi.fn() } as unknown as NodeRuntime["http"],
        jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
        textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
        env,
        clock: createMockClock(),
        commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
        runIdFactory: createMockRunIdFactory(),
        retryControl: createMockRetryControl(),
        getDb: vi.fn(),
        getPersistence: vi.fn().mockResolvedValue({
          connection: { close: vi.fn().mockResolvedValue(undefined) },
          normalizedObservationRepo,
          featureRepo
        }),
        getContract: vi.fn()
      };

      await expect(runDeriveMvpFeaturesScript(runtime)).rejects.toThrow(
        "MVP feature derivation failed"
      );
    });

    it("should throw when connection.close() throws (connection close failure)", async () => {
      const normalizedObservationRepo = createMockNormalizedObservationRepo();
      const featureRepo = createMockFeatureRepo();

      const mockRows = [{ id: 1, status: "AVAILABLE" as const }];
      (featureRepo.insertMany as Mock).mockResolvedValue(mockRows);
      (normalizedObservationRepo.listCandidates as Mock).mockResolvedValue([]);

      const env = createMockEnvReader({
        WHIRLPOOL_ADDRESS: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        INTELLIGENCE_POSITION_IDS: "pos1",
        DATABASE_URL: "postgresql://test:test@localhost:5432/test"
      });

      const runtime: NodeRuntime = {
        http: { getJson: vi.fn() } as unknown as NodeRuntime["http"],
        jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
        textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
        env,
        clock: createMockClock(),
        commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
        runIdFactory: createMockRunIdFactory(),
        retryControl: createMockRetryControl(),
        getDb: vi.fn(),
        getPersistence: vi.fn().mockResolvedValue({
          connection: { close: vi.fn().mockRejectedValue(new Error("Connection close failed")) },
          normalizedObservationRepo,
          featureRepo
        }),
        getContract: vi.fn()
      };

      await expect(runDeriveMvpFeaturesScript(runtime)).rejects.toThrow("Connection close failed");
    });
  });
});
