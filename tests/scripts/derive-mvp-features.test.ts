import { describe, it, expect, vi, type Mock, beforeEach } from "vitest";
import type { Clock } from "../../src/ports/clock.js";
import type { RunIdFactory } from "../../src/ports/run-id.js";
import type { EnvReader } from "../../src/ports/env.js";
import type { NodeRuntime } from "../../src/adapters/node/composition-root.js";
import { runDeriveMvpFeaturesScript } from "../../scripts/collectors/derive-mvp-features.js";

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
    listCandidates: vi.fn()
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
        getDb: vi.fn(),
        getPersistence: vi.fn().mockResolvedValue({
          connection: { close: vi.fn().mockResolvedValue(undefined) },
          normalizedObservationRepo: createMockNormalizedObservationRepo(),
          featureRepo: createMockFeatureRepo()
        })
      };

      await expect(runDeriveMvpFeaturesScript(runtime)).rejects.toThrow(
        "Missing required environment variable: WHIRLPOOL_ADDRESS"
      );
    });

    it("should throw when INTELLIGENCE_POSITION_IDS is empty", async () => {
      const env = createMockEnvReader({
        WHIRLPOOL_ADDRESS: "HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw",
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
        getDb: vi.fn(),
        getPersistence: vi.fn().mockResolvedValue({
          connection: { close: vi.fn().mockResolvedValue(undefined) },
          normalizedObservationRepo: createMockNormalizedObservationRepo(),
          featureRepo: createMockFeatureRepo()
        })
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
        WHIRLPOOL_ADDRESS: "HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw",
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
        getDb: vi.fn(),
        getPersistence: vi.fn().mockResolvedValue({
          connection: { close: vi.fn().mockResolvedValue(undefined) },
          normalizedObservationRepo,
          featureRepo
        })
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
        WHIRLPOOL_ADDRESS: "HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw",
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
        getDb: vi.fn(),
        getPersistence: vi.fn().mockResolvedValue({
          connection: { close: vi.fn().mockResolvedValue(undefined) },
          normalizedObservationRepo,
          featureRepo
        })
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
        WHIRLPOOL_ADDRESS: "HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw",
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
        getDb: vi.fn(),
        getPersistence: vi.fn().mockResolvedValue({
          connection: { close: vi.fn().mockRejectedValue(new Error("Connection close failed")) },
          normalizedObservationRepo,
          featureRepo
        })
      };

      await expect(runDeriveMvpFeaturesScript(runtime)).rejects.toThrow("Connection close failed");
    });
  });
});
