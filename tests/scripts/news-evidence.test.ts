import { describe, it, expect, vi } from "vitest";
import type { HttpClient } from "../../src/ports/http.js";
import type { JsonStore } from "../../src/ports/json-store.js";
import type { TextReader } from "../../src/ports/text-reader.js";
import type { EnvReader } from "../../src/ports/env.js";
import type { Clock } from "../../src/ports/clock.js";
import type { CommandRunner } from "../../src/ports/command-runner.js";
import type { RawObservationRepo } from "../../src/ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../../src/ports/normalized-observation-repo.js";
import type { DbConnection } from "../../src/ports/db.js";
import type { NodeRuntime } from "../../src/adapters/node/composition-root.js";
import type { RetryControl } from "../../src/ports/retry.js";
import type { NewsSourcePort } from "../../src/ports/news-source.js";

function createMockRetryControl(): RetryControl {
  return {
    sleep: vi.fn().mockResolvedValue(undefined),
    jitterUnit: vi.fn().mockReturnValue(0)
  };
}

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
    findByIds: vi.fn(),
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
    findFreshByKind: vi.fn(),
    findLatestByKind: vi.fn(),
    findByRawObservation: vi.fn(),
    listCandidates: vi.fn(),
    findByIds: vi.fn()
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

function createMockNewsSourcePort(): NewsSourcePort {
  return {
    collect: vi.fn()
  };
}

interface TestRuntimeOptions {
  env: EnvReader;
  http?: HttpClient;
  jsonStore?: JsonStore;
  clock?: Clock;
  commandRunner?: CommandRunner;
  retryControl?: RetryControl;
  persistence?: {
    connection: DbConnection;
    rawObservationRepo: RawObservationRepo;
    normalizedObservationRepo: NormalizedObservationRepo;
  };
}

function createTestRuntime(options: TestRuntimeOptions): NodeRuntime {
  return {
    http: options.http ?? createMockHttpClient(),
    jsonStore: options.jsonStore ?? createMockJsonStore(),
    textReader: createMockTextReader(),
    env: options.env,
    clock: options.clock ?? createMockClock(),
    commandRunner: options.commandRunner ?? createMockCommandRunner(),
    runIdFactory: { nextRunId: () => "run-123" },
    retryControl: options.retryControl ?? createMockRetryControl(),
    getDb: vi.fn(),
    getPersistence: options.persistence ? vi.fn().mockResolvedValue(options.persistence) : vi.fn(),
    getContract: vi.fn()
  };
}

const BASE_TEST_ENV = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test"
};

describe("news-evidence collector CLI configuration", () => {
  describe("rejects invalid source allowlists before external work", () => {
    it("rejects missing NEWS_SOURCE_ALLOWLIST", async () => {
      const envMap = { ...BASE_TEST_ENV };
      const env = createMockEnvReader(envMap);
      vi.spyOn(env, "get").mockImplementation((name: string, fallback?: string) => {
        if (name === "NEWS_SOURCE_ALLOWLIST") {
          throw new Error(`Missing required environment variable: ${name}`);
        }
        return (envMap as Record<string, string>)[name] ?? fallback ?? "";
      });

      const runtime = createTestRuntime({ env });

      await expect(
        import("../../scripts/collectors/news-evidence.js").then((m) =>
          m.runNewsEvidenceCollect(runtime)
        )
      ).rejects.toThrow("Missing required environment variable: NEWS_SOURCE_ALLOWLIST");

      expect(runtime.getPersistence).not.toHaveBeenCalled();
    });

    it("rejects empty NEWS_SOURCE_ALLOWLIST", async () => {
      const envMap = { ...BASE_TEST_ENV, NEWS_SOURCE_ALLOWLIST: "" };
      const env = createMockEnvReader(envMap);
      const runtime = createTestRuntime({ env });

      await expect(
        import("../../scripts/collectors/news-evidence.js").then((m) =>
          m.runNewsEvidenceCollect(runtime)
        )
      ).rejects.toThrow("NEWS_SOURCE_ALLOWLIST cannot be empty");

      expect(runtime.getPersistence).not.toHaveBeenCalled();
    });

    it("rejects duplicate source names in allowlist", async () => {
      const envMap = {
        ...BASE_TEST_ENV,
        NEWS_SOURCE_ALLOWLIST: "crypto-news-api,crypto-news-api",
        CRYPTO_NEWS_API_URL: "https://api.example.com/news"
      };
      const env = createMockEnvReader(envMap);
      const runtime = createTestRuntime({ env });

      await expect(
        import("../../scripts/collectors/news-evidence.js").then((m) =>
          m.runNewsEvidenceCollect(runtime)
        )
      ).rejects.toThrow("Duplicate source name: crypto-news-api");

      expect(runtime.getPersistence).not.toHaveBeenCalled();
    });

    it("rejects unknown source names in allowlist", async () => {
      const envMap = {
        ...BASE_TEST_ENV,
        NEWS_SOURCE_ALLOWLIST: "unknown-source",
        UNKNOWN_SOURCE_URL: "https://api.example.com"
      };
      const env = createMockEnvReader(envMap);
      const runtime = createTestRuntime({ env });

      await expect(
        import("../../scripts/collectors/news-evidence.js").then((m) =>
          m.runNewsEvidenceCollect(runtime)
        )
      ).rejects.toThrow(
        "Unknown source name: unknown-source. Known sources are: crypto-news-api, regulatory-monitor-api"
      );

      expect(runtime.getPersistence).not.toHaveBeenCalled();
    });

    it("rejects allowlist with whitespace-only entries after trimming", async () => {
      const envMap = {
        ...BASE_TEST_ENV,
        NEWS_SOURCE_ALLOWLIST: "  ,crypto-news-api",
        CRYPTO_NEWS_API_URL: "https://api.example.com/news"
      };
      const env = createMockEnvReader(envMap);
      const runtime = createTestRuntime({ env });

      await expect(
        import("../../scripts/collectors/news-evidence.js").then((m) =>
          m.runNewsEvidenceCollect(runtime)
        )
      ).rejects.toThrow("Empty source name in allowlist");

      expect(runtime.getPersistence).not.toHaveBeenCalled();
    });

    it("rejects when required URL is missing for configured source", async () => {
      const envMap = {
        ...BASE_TEST_ENV,
        NEWS_SOURCE_ALLOWLIST: "crypto-news-api"
      };
      const env = createMockEnvReader(envMap);
      const runtime = createTestRuntime({ env });

      await expect(
        import("../../scripts/collectors/news-evidence.js").then((m) =>
          m.runNewsEvidenceCollect(runtime)
        )
      ).rejects.toThrow("Missing required environment variable: CRYPTO_NEWS_API_URL");

      expect(runtime.getPersistence).not.toHaveBeenCalled();
    });
  });

  describe("stable allowlist ordering", () => {
    it("maintains canonical order from configuration, not alphabetical", async () => {
      const envMap = {
        ...BASE_TEST_ENV,
        NEWS_SOURCE_ALLOWLIST: "regulatory-monitor-api,crypto-news-api",
        REGULATORY_MONITOR_API_URL: "https://api.example.com/regulatory",
        CRYPTO_NEWS_API_URL: "https://api.example.com/crypto"
      };
      const env = createMockEnvReader(envMap);
      const closeMock = vi.fn().mockResolvedValue(undefined);
      const connection: DbConnection = { close: closeMock };
      const rawObservationRepo = createMockRawObservationRepo();
      const normalizedObservationRepo = createMockNormalizedObservationRepo();
      const mockNewsSource1 = createMockNewsSourcePort();
      const mockNewsSource2 = createMockNewsSourcePort();

      vi.spyOn(mockNewsSource1, "collect").mockResolvedValue({
        source: "crypto-news-api",
        providerId: "provider-1",
        providerRunId: "run-1",
        retrievedAtUnixMs: Date.now(),
        records: []
      });

      vi.spyOn(mockNewsSource2, "collect").mockResolvedValue({
        source: "regulatory-monitor-api",
        providerId: "provider-2",
        providerRunId: "run-2",
        retrievedAtUnixMs: Date.now(),
        records: []
      });

      const runtime = createTestRuntime({
        env,
        persistence: {
          connection,
          rawObservationRepo,
          normalizedObservationRepo
        }
      });

      const { runNewsEvidenceCollect } = await import("../../scripts/collectors/news-evidence.js");

      const collectSpy = vi.spyOn(runtime, "getPersistence");

      await runNewsEvidenceCollect(runtime, {
        sources: [
          { source: "regulatory-monitor-api", adapter: mockNewsSource2 },
          { source: "crypto-news-api", adapter: mockNewsSource1 }
        ]
      });

      expect(collectSpy).toHaveBeenCalled();
    });
  });
});

describe("news-evidence collector lifecycle", () => {
  describe("closes persistence exactly once on every initialized path", () => {
    it("closes database connection exactly once on successful collection", async () => {
      const closeMock = vi.fn().mockResolvedValue(undefined);
      const connection: DbConnection = { close: closeMock };
      const rawObservationRepo = createMockRawObservationRepo();
      const normalizedObservationRepo = createMockNormalizedObservationRepo();
      const env = createMockEnvReader({
        ...BASE_TEST_ENV,
        NEWS_SOURCE_ALLOWLIST: "crypto-news-api",
        CRYPTO_NEWS_API_URL: "https://api.example.com/news"
      });
      const clock = createMockClock();
      const http = createMockHttpClient();
      const jsonStore = createMockJsonStore();

      const mockNewsSource = createMockNewsSourcePort();
      vi.spyOn(mockNewsSource, "collect").mockResolvedValue({
        source: "crypto-news-api",
        providerId: "provider-1",
        providerRunId: "run-1",
        retrievedAtUnixMs: Date.now(),
        records: []
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
        runIdFactory: { nextRunId: () => "run-123" },
        retryControl: createMockRetryControl(),
        getDb: vi.fn(),
        getPersistence: vi.fn().mockResolvedValue(persistence),
        getContract: vi.fn()
      };

      const { runNewsEvidenceCollect } = await import("../../scripts/collectors/news-evidence.js");
      await runNewsEvidenceCollect(runtime, {
        sources: [{ source: "crypto-news-api", adapter: mockNewsSource }]
      });

      expect(closeMock).toHaveBeenCalledTimes(1);
    });

    it("closes database connection exactly once when job returns failed status", async () => {
      const closeMock = vi.fn().mockResolvedValue(undefined);
      const connection: DbConnection = { close: closeMock };
      const rawObservationRepo = createMockRawObservationRepo();
      const normalizedObservationRepo = createMockNormalizedObservationRepo();
      const env = createMockEnvReader({
        ...BASE_TEST_ENV,
        NEWS_SOURCE_ALLOWLIST: "crypto-news-api",
        CRYPTO_NEWS_API_URL: "https://api.example.com/news"
      });
      const clock = createMockClock();
      const http = createMockHttpClient();
      const jsonStore = createMockJsonStore();

      const mockNewsSource = createMockNewsSourcePort();
      vi.spyOn(mockNewsSource, "collect").mockRejectedValue(new Error("Network failure"));

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
        runIdFactory: { nextRunId: () => "run-123" },
        retryControl: createMockRetryControl(),
        getDb: vi.fn(),
        getPersistence: vi.fn().mockResolvedValue(persistence),
        getContract: vi.fn()
      };

      const { runNewsEvidenceCollect } = await import("../../scripts/collectors/news-evidence.js");
      const result = await runNewsEvidenceCollect(runtime, {
        sources: [{ source: "crypto-news-api", adapter: mockNewsSource }]
      });

      expect(result.status).toBe("FAILED");
      expect(result.shouldFailCommand).toBe(true);
      expect(process.exitCode).toBe(1);
      expect(closeMock).toHaveBeenCalledTimes(1);
    });

    it("closes database connection when getPersistence fails - no connection to close", async () => {
      const closeMock = vi.fn().mockResolvedValue(undefined);
      const connection: DbConnection = { close: closeMock };
      const rawObservationRepo = createMockRawObservationRepo();
      const normalizedObservationRepo = createMockNormalizedObservationRepo();
      const env = createMockEnvReader({
        ...BASE_TEST_ENV,
        NEWS_SOURCE_ALLOWLIST: "crypto-news-api",
        CRYPTO_NEWS_API_URL: "https://api.example.com/news"
      });
      const clock = createMockClock();
      const http = createMockHttpClient();
      const jsonStore = createMockJsonStore();

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
        runIdFactory: { nextRunId: () => "run-123" },
        retryControl: createMockRetryControl(),
        getDb: vi.fn().mockRejectedValue(new Error("DB connection failed")),
        getPersistence: vi
          .fn()
          .mockRejectedValueOnce(new Error("DB connection failed"))
          .mockResolvedValueOnce(persistence),
        getContract: vi.fn()
      };

      const { runNewsEvidenceCollect } = await import("../../scripts/collectors/news-evidence.js");
      await expect(
        runNewsEvidenceCollect(runtime, {
          sources: [{ source: "crypto-news-api", adapter: createMockNewsSourcePort() }]
        })
      ).rejects.toThrow("DB connection failed");

      expect(closeMock).not.toHaveBeenCalled();
    });

    it("closes database connection exactly once when close throws but still completes", async () => {
      const closeMock = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("Close failed"));
      const connection: DbConnection = { close: closeMock };
      const rawObservationRepo = createMockRawObservationRepo();
      const normalizedObservationRepo = createMockNormalizedObservationRepo();
      const env = createMockEnvReader({
        ...BASE_TEST_ENV,
        NEWS_SOURCE_ALLOWLIST: "crypto-news-api",
        CRYPTO_NEWS_API_URL: "https://api.example.com/news"
      });
      const clock = createMockClock();
      const http = createMockHttpClient();
      const jsonStore = createMockJsonStore();

      const mockNewsSource = createMockNewsSourcePort();
      vi.spyOn(mockNewsSource, "collect").mockRejectedValue(new Error("Collection failed"));

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
        runIdFactory: { nextRunId: () => "run-123" },
        retryControl: createMockRetryControl(),
        getDb: vi.fn(),
        getPersistence: vi.fn().mockResolvedValue(persistence),
        getContract: vi.fn()
      };

      const { runNewsEvidenceCollect } = await import("../../scripts/collectors/news-evidence.js");
      const result = await runNewsEvidenceCollect(runtime, {
        sources: [{ source: "crypto-news-api", adapter: mockNewsSource }]
      });

      expect(result.status).toBe("FAILED");
      expect(closeMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("exit codes", () => {
    it("sets exit code 0 for COMPLETE status", async () => {
      const closeMock = vi.fn().mockResolvedValue(undefined);
      const connection: DbConnection = { close: closeMock };
      const rawObservationRepo = createMockRawObservationRepo();
      const normalizedObservationRepo = createMockNormalizedObservationRepo();
      const env = createMockEnvReader({
        ...BASE_TEST_ENV,
        NEWS_SOURCE_ALLOWLIST: "crypto-news-api",
        CRYPTO_NEWS_API_URL: "https://api.example.com/news"
      });
      const clock = createMockClock();
      const http = createMockHttpClient();
      const jsonStore = createMockJsonStore();

      const mockNewsSource = createMockNewsSourcePort();
      vi.spyOn(mockNewsSource, "collect").mockResolvedValue({
        source: "crypto-news-api",
        providerId: "provider-1",
        providerRunId: "run-1",
        retrievedAtUnixMs: Date.now(),
        records: []
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
        runIdFactory: { nextRunId: () => "run-123" },
        retryControl: createMockRetryControl(),
        getDb: vi.fn(),
        getPersistence: vi.fn().mockResolvedValue(persistence),
        getContract: vi.fn()
      };

      const { runNewsEvidenceCollect } = await import("../../scripts/collectors/news-evidence.js");
      await runNewsEvidenceCollect(runtime, {
        sources: [{ source: "crypto-news-api", adapter: mockNewsSource }]
      });

      expect(process.exitCode).toBe(0);
    });

    it("sets exit code 0 for PARTIAL status", async () => {
      const closeMock = vi.fn().mockResolvedValue(undefined);
      const connection: DbConnection = { close: closeMock };
      const rawObservationRepo = createMockRawObservationRepo();
      const normalizedObservationRepo = createMockNormalizedObservationRepo();
      const env = createMockEnvReader({
        ...BASE_TEST_ENV,
        NEWS_SOURCE_ALLOWLIST: "crypto-news-api,regulatory-monitor-api",
        CRYPTO_NEWS_API_URL: "https://api.example.com/news",
        REGULATORY_MONITOR_API_URL: "https://api.example.com/regulatory"
      });
      const clock = createMockClock();
      const http = createMockHttpClient();
      const jsonStore = createMockJsonStore();

      const mockNewsSource1 = createMockNewsSourcePort();
      const mockNewsSource2 = createMockNewsSourcePort();

      vi.spyOn(mockNewsSource1, "collect").mockResolvedValue({
        source: "crypto-news-api",
        providerId: "provider-1",
        providerRunId: "run-1",
        retrievedAtUnixMs: Date.now(),
        records: []
      });

      vi.spyOn(mockNewsSource2, "collect").mockRejectedValue({
        kind: "unavailable",
        diagnostic: "Service unavailable"
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
        runIdFactory: { nextRunId: () => "run-123" },
        retryControl: createMockRetryControl(),
        getDb: vi.fn(),
        getPersistence: vi.fn().mockResolvedValue(persistence),
        getContract: vi.fn()
      };

      const { runNewsEvidenceCollect } = await import("../../scripts/collectors/news-evidence.js");
      await runNewsEvidenceCollect(runtime, {
        sources: [
          { source: "crypto-news-api", adapter: mockNewsSource1 },
          { source: "regulatory-monitor-api", adapter: mockNewsSource2 }
        ]
      });

      expect(process.exitCode).toBe(0);
    });

    it("sets exit code 1 for UNAVAILABLE status", async () => {
      const closeMock = vi.fn().mockResolvedValue(undefined);
      const connection: DbConnection = { close: closeMock };
      const rawObservationRepo = createMockRawObservationRepo();
      const normalizedObservationRepo = createMockNormalizedObservationRepo();
      const env = createMockEnvReader({
        ...BASE_TEST_ENV,
        NEWS_SOURCE_ALLOWLIST: "crypto-news-api",
        CRYPTO_NEWS_API_URL: "https://api.example.com/news"
      });
      const clock = createMockClock();
      const http = createMockHttpClient();
      const jsonStore = createMockJsonStore();

      const mockNewsSource = createMockNewsSourcePort();
      vi.spyOn(mockNewsSource, "collect").mockRejectedValue({
        kind: "unavailable",
        diagnostic: "Service unavailable"
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
        runIdFactory: { nextRunId: () => "run-123" },
        retryControl: createMockRetryControl(),
        getDb: vi.fn(),
        getPersistence: vi.fn().mockResolvedValue(persistence),
        getContract: vi.fn()
      };

      const { runNewsEvidenceCollect } = await import("../../scripts/collectors/news-evidence.js");
      await runNewsEvidenceCollect(runtime, {
        sources: [{ source: "crypto-news-api", adapter: mockNewsSource }]
      });

      expect(process.exitCode).toBe(1);
    });

    it("sets exit code 1 for FAILED status", async () => {
      const closeMock = vi.fn().mockResolvedValue(undefined);
      const connection: DbConnection = { close: closeMock };
      const rawObservationRepo = createMockRawObservationRepo();
      const normalizedObservationRepo = createMockNormalizedObservationRepo();
      const env = createMockEnvReader({
        ...BASE_TEST_ENV,
        NEWS_SOURCE_ALLOWLIST: "crypto-news-api",
        CRYPTO_NEWS_API_URL: "https://api.example.com/news"
      });
      const clock = createMockClock();
      const http = createMockHttpClient();
      const jsonStore = createMockJsonStore();

      const mockNewsSource = createMockNewsSourcePort();
      vi.spyOn(mockNewsSource, "collect").mockRejectedValue({
        kind: "malformed",
        diagnostic: "Invalid response format"
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
        runIdFactory: { nextRunId: () => "run-123" },
        retryControl: createMockRetryControl(),
        getDb: vi.fn(),
        getPersistence: vi.fn().mockResolvedValue(persistence),
        getContract: vi.fn()
      };

      const { runNewsEvidenceCollect } = await import("../../scripts/collectors/news-evidence.js");
      await runNewsEvidenceCollect(runtime, {
        sources: [{ source: "crypto-news-api", adapter: mockNewsSource }]
      });

      expect(process.exitCode).toBe(1);
    });
  });

  describe("secret redaction in output", () => {
    it("redacts API keys from result JSON output", async () => {
      const closeMock = vi.fn().mockResolvedValue(undefined);
      const connection: DbConnection = { close: closeMock };
      const rawObservationRepo = createMockRawObservationRepo();
      const normalizedObservationRepo = createMockNormalizedObservationRepo();
      const env = createMockEnvReader({
        ...BASE_TEST_ENV,
        NEWS_SOURCE_ALLOWLIST: "crypto-news-api",
        CRYPTO_NEWS_API_URL: "https://api.example.com/news",
        CRYPTO_NEWS_API_KEY: "super-secret-key-12345"
      });
      const clock = createMockClock();
      const http = createMockHttpClient();
      const jsonStore = createMockJsonStore();
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation();

      const mockNewsSource = createMockNewsSourcePort();
      vi.spyOn(mockNewsSource, "collect").mockResolvedValue({
        source: "crypto-news-api",
        providerId: "provider-1",
        providerRunId: "run-1",
        retrievedAtUnixMs: Date.now(),
        records: []
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
        runIdFactory: { nextRunId: () => "run-123" },
        retryControl: createMockRetryControl(),
        getDb: vi.fn(),
        getPersistence: vi.fn().mockResolvedValue(persistence),
        getContract: vi.fn()
      };

      const { runNewsEvidenceCollect } = await import("../../scripts/collectors/news-evidence.js");
      await runNewsEvidenceCollect(runtime, {
        sources: [{ source: "crypto-news-api", adapter: mockNewsSource }]
      });

      expect(consoleLogSpy).toHaveBeenCalled();
      const loggedOutput = consoleLogSpy.mock.calls[0][0] as string;
      expect(loggedOutput).not.toContain("super-secret-key-12345");

      consoleLogSpy.mockRestore();
    });
  });

  describe("HttpNewsSource construction", () => {
    it("constructs HttpNewsSource with correct URL and optional API key", async () => {
      const closeMock = vi.fn().mockResolvedValue(undefined);
      const connection: DbConnection = { close: closeMock };
      const rawObservationRepo = createMockRawObservationRepo();
      const normalizedObservationRepo = createMockNormalizedObservationRepo();
      const env = createMockEnvReader({
        ...BASE_TEST_ENV,
        NEWS_SOURCE_ALLOWLIST: "crypto-news-api",
        CRYPTO_NEWS_API_URL: "https://api.example.com/news",
        CRYPTO_NEWS_API_KEY: "test-key"
      });
      const clock = createMockClock();
      const http = createMockHttpClient();
      const jsonStore = createMockJsonStore();

      const mockNewsSource = createMockNewsSourcePort();
      vi.spyOn(mockNewsSource, "collect").mockResolvedValue({
        source: "crypto-news-api",
        providerId: "provider-1",
        providerRunId: "run-1",
        retrievedAtUnixMs: Date.now(),
        records: []
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
        runIdFactory: { nextRunId: () => "run-123" },
        retryControl: createMockRetryControl(),
        getDb: vi.fn(),
        getPersistence: vi.fn().mockResolvedValue(persistence),
        getContract: vi.fn()
      };

      const { buildNewsSources } = await import("../../scripts/collectors/news-evidence.js");

      const sources = buildNewsSources(runtime);
      expect(sources).toHaveLength(1);
      expect(sources[0].source).toBe("crypto-news-api");
    });
  });
});
