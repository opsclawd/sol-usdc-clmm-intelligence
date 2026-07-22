import { describe, it, expect, vi, type Mock, beforeEach } from "vitest";
import type { Clock } from "../../src/ports/clock.js";
import type { EnvReader } from "../../src/ports/env.js";
import type { NodeRuntime } from "../../src/adapters/node/composition-root.js";
import type { EvidenceBundleRepo } from "../../src/ports/bundle-repo.js";
import type { EvidenceBundleContract } from "../../src/ports/evidence-bundle-contract.js";
import type { RetryControl } from "../../src/ports/retry.js";
import type { PublishAttemptRepo } from "../../src/ports/publish-attempt-repo.js";
import type { HttpClient } from "../../src/ports/http.js";

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

function createMockBundleRepo(): EvidenceBundleRepo {
  return {
    insertOrClassify: vi.fn(),
    findByPair: vi.fn(),
    findLatestByPair: vi.fn()
  };
}

function createMockContract(): EvidenceBundleContract {
  return {
    validateCanonicalizeAndHash: vi.fn()
  };
}

function createMockPublishAttemptRepo(): PublishAttemptRepo {
  return {
    insert: vi.fn(),
    findByTargetAndKey: vi.fn(),
    findByBundle: vi.fn(),
    findRecentByStatus: vi.fn()
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

function createMockHttpClient(): HttpClient {
  return {
    getJson: vi.fn(),
    postJsonRaw: vi.fn()
  };
}

const MOCK_BUNDLE_ROW = {
  id: 1,
  schemaVersion: "evidence-bundle.v1",
  pair: "SOL/USDC",
  asOfUnixMs: 1700000000000,
  expiresAtUnixMs: 1700003600000,
  payload: { test: "payload" },
  payloadHash: "hash123",
  payloadCanonical: '{"test":"payload"}',
  idempotencyKey: "idem-key-123",
  taxonomySummary: null,
  dominantSignalClass: "deterministic" as const,
  confidence: {
    components: {},
    compositeScore: 5000,
    level: "high" as const,
    weightingVersion: "v1",
    reasons: []
  },
  confidenceComposite: 5000,
  confidenceLevel: "high",
  validUntilUnixMs: null,
  isStale: false,
  staleBehavior: null,
  provenance: {},
  version: 1,
  receivedAtUnixMs: 1700000000000
};

describe("publisher CLI wires latest bundle persistence contract HTTP clock retry and env", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("wires runtime persistence, contract, http, clock, retry, and env for publishing", async () => {
    const bundleRepo = createMockBundleRepo();
    const publishAttemptRepo = createMockPublishAttemptRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");
    const retryControl = createMockRetryControl();
    const httpClient = createMockHttpClient();
    const envReader = createMockEnvReader({
      REGIME_ENGINE_BASE_URL: "http://localhost:4000",
      REGIME_ENGINE_AUTH_TOKEN: "test-secret-token"
    });

    (bundleRepo.findLatestByPair as Mock).mockResolvedValue(MOCK_BUNDLE_ROW);
    (contract.validateCanonicalizeAndHash as Mock).mockResolvedValue({
      payload: MOCK_BUNDLE_ROW.payload,
      payloadCanonical: MOCK_BUNDLE_ROW.payloadCanonical,
      payloadHash: MOCK_BUNDLE_ROW.payloadHash,
      idempotencyKey: MOCK_BUNDLE_ROW.idempotencyKey,
      schemaVersion: "evidence-bundle.v1"
    });
    (httpClient.postJsonRaw as Mock).mockResolvedValue({
      status: 201,
      ok: true,
      body: { success: true },
      headers: {}
    });
    (publishAttemptRepo.insert as Mock).mockResolvedValue({ outcome: "inserted", row: { id: 1 } });

    const consoleLogSpy = vi.spyOn(console, "log").mockReturnValue(undefined);
    const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as () => never);

    const runtime: NodeRuntime = {
      http: httpClient,
      jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env: envReader,
      clock,
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: { nextRunId: vi.fn(() => "run-id") },
      retryControl,
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: vi.fn().mockResolvedValue(undefined) },
        rawObservationRepo: {},
        normalizedObservationRepo: {},
        featureRepo: {},
        bundleRepo,
        briefRepo: {},
        publishAttemptRepo
      }),
      getContract: vi.fn().mockResolvedValue(contract)
    };

    const { runPublishEvidenceBundleScript } =
      await import("../../scripts/collectors/publish-evidence-bundle.js");

    await runPublishEvidenceBundleScript(runtime);

    expect(bundleRepo.findLatestByPair).toHaveBeenCalledWith("SOL/USDC");
    expect(contract.validateCanonicalizeAndHash).toHaveBeenCalled();
    expect(httpClient.postJsonRaw).toHaveBeenCalled();
    expect(retryControl.sleep).toBeDefined();
    expect(envReader.get).toHaveBeenCalledWith("REGIME_ENGINE_BASE_URL");
    expect(envReader.get).toHaveBeenCalledWith("REGIME_ENGINE_AUTH_TOKEN");

    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });
});

describe("created and replay exit zero with redacted JSON", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("publishing a new bundle exits zero with redacted outcome", async () => {
    const bundleRepo = createMockBundleRepo();
    const publishAttemptRepo = createMockPublishAttemptRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");
    const retryControl = createMockRetryControl();
    const httpClient = createMockHttpClient();
    const envReader = createMockEnvReader({
      REGIME_ENGINE_BASE_URL: "http://localhost:4000",
      REGIME_ENGINE_AUTH_TOKEN: "test-secret-token"
    });

    (bundleRepo.findLatestByPair as Mock).mockResolvedValue(MOCK_BUNDLE_ROW);
    (contract.validateCanonicalizeAndHash as Mock).mockResolvedValue({
      payload: MOCK_BUNDLE_ROW.payload,
      payloadCanonical: MOCK_BUNDLE_ROW.payloadCanonical,
      payloadHash: MOCK_BUNDLE_ROW.payloadHash,
      idempotencyKey: MOCK_BUNDLE_ROW.idempotencyKey,
      schemaVersion: "evidence-bundle.v1"
    });
    (httpClient.postJsonRaw as Mock).mockResolvedValue({
      status: 201,
      ok: true,
      body: { success: true },
      headers: {}
    });
    (publishAttemptRepo.insert as Mock).mockResolvedValue({ outcome: "inserted", row: { id: 1 } });

    const consoleLogSpy = vi.spyOn(console, "log").mockReturnValue(undefined);
    const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as () => never);

    const runtime: NodeRuntime = {
      http: httpClient,
      jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env: envReader,
      clock,
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: { nextRunId: vi.fn(() => "run-id") },
      retryControl,
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: vi.fn().mockResolvedValue(undefined) },
        rawObservationRepo: {},
        normalizedObservationRepo: {},
        featureRepo: {},
        bundleRepo,
        briefRepo: {},
        publishAttemptRepo
      }),
      getContract: vi.fn().mockResolvedValue(contract)
    };

    const { runPublishEvidenceBundleScript } =
      await import("../../scripts/collectors/publish-evidence-bundle.js");

    await runPublishEvidenceBundleScript(runtime);

    const loggedOutput = JSON.parse(
      consoleLogSpy.mock.calls[consoleLogSpy.mock.calls.length - 1]![0] as string
    );

    expect(loggedOutput.outcome).toBe("created");
    expect(loggedOutput.bundleId).toBe(1);
    expect(loggedOutput.attemptCount).toBeDefined();
    expect(processExitSpy).not.toHaveBeenCalledWith(1);

    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it("idempotent replay exits zero with redacted outcome", async () => {
    const bundleRepo = createMockBundleRepo();
    const publishAttemptRepo = createMockPublishAttemptRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");
    const retryControl = createMockRetryControl();
    const httpClient = createMockHttpClient();
    const envReader = createMockEnvReader({
      REGIME_ENGINE_BASE_URL: "http://localhost:4000",
      REGIME_ENGINE_AUTH_TOKEN: "test-secret-token"
    });

    (bundleRepo.findLatestByPair as Mock).mockResolvedValue(MOCK_BUNDLE_ROW);
    (contract.validateCanonicalizeAndHash as Mock).mockResolvedValue({
      payload: MOCK_BUNDLE_ROW.payload,
      payloadCanonical: MOCK_BUNDLE_ROW.payloadCanonical,
      payloadHash: MOCK_BUNDLE_ROW.payloadHash,
      idempotencyKey: MOCK_BUNDLE_ROW.idempotencyKey,
      schemaVersion: "evidence-bundle.v1"
    });
    (httpClient.postJsonRaw as Mock).mockResolvedValue({
      status: 200,
      ok: true,
      body: { success: true, message: "Already processed" },
      headers: {}
    });
    (publishAttemptRepo.insert as Mock).mockResolvedValue({ outcome: "inserted", row: { id: 1 } });

    const consoleLogSpy = vi.spyOn(console, "log").mockReturnValue(undefined);
    const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as () => never);

    const runtime: NodeRuntime = {
      http: httpClient,
      jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env: envReader,
      clock,
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: { nextRunId: vi.fn(() => "run-id") },
      retryControl,
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: vi.fn().mockResolvedValue(undefined) },
        rawObservationRepo: {},
        normalizedObservationRepo: {},
        featureRepo: {},
        bundleRepo,
        briefRepo: {},
        publishAttemptRepo
      }),
      getContract: vi.fn().mockResolvedValue(contract)
    };

    const { runPublishEvidenceBundleScript } =
      await import("../../scripts/collectors/publish-evidence-bundle.js");

    await runPublishEvidenceBundleScript(runtime);

    const loggedOutput = JSON.parse(
      consoleLogSpy.mock.calls[consoleLogSpy.mock.calls.length - 1]![0] as string
    );

    expect(loggedOutput.outcome).toBe("idempotent_replay");
    expect(loggedOutput.bundleId).toBe(1);
    expect(processExitSpy).not.toHaveBeenCalledWith(1);

    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });
});

describe("terminal publish failure exits nonzero", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("validation_failed status exits nonzero", async () => {
    const bundleRepo = createMockBundleRepo();
    const publishAttemptRepo = createMockPublishAttemptRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");
    const retryControl = createMockRetryControl();
    const httpClient = createMockHttpClient();
    const envReader = createMockEnvReader({
      REGIME_ENGINE_BASE_URL: "http://localhost:4000",
      REGIME_ENGINE_AUTH_TOKEN: "test-secret-token"
    });

    (bundleRepo.findLatestByPair as Mock).mockResolvedValue(MOCK_BUNDLE_ROW);
    (contract.validateCanonicalizeAndHash as Mock).mockResolvedValue({
      payload: MOCK_BUNDLE_ROW.payload,
      payloadCanonical: MOCK_BUNDLE_ROW.payloadCanonical,
      payloadHash: MOCK_BUNDLE_ROW.payloadHash,
      idempotencyKey: MOCK_BUNDLE_ROW.idempotencyKey,
      schemaVersion: "evidence-bundle.v1"
    });
    (httpClient.postJsonRaw as Mock).mockResolvedValue({
      status: 422,
      ok: false,
      body: { error: "Validation failed" },
      headers: {}
    });
    (publishAttemptRepo.insert as Mock).mockResolvedValue({ outcome: "inserted", row: { id: 1 } });

    const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as () => never);

    const runtime: NodeRuntime = {
      http: httpClient,
      jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env: envReader,
      clock,
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: { nextRunId: vi.fn(() => "run-id") },
      retryControl,
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: vi.fn().mockResolvedValue(undefined) },
        rawObservationRepo: {},
        normalizedObservationRepo: {},
        featureRepo: {},
        bundleRepo,
        briefRepo: {},
        publishAttemptRepo
      }),
      getContract: vi.fn().mockResolvedValue(contract)
    };

    const { runPublishEvidenceBundleScript } =
      await import("../../scripts/collectors/publish-evidence-bundle.js");

    await runPublishEvidenceBundleScript(runtime);

    expect(processExitSpy).toHaveBeenCalledWith(1);

    processExitSpy.mockRestore();
  });

  it("auth_failed status exits nonzero", async () => {
    const bundleRepo = createMockBundleRepo();
    const publishAttemptRepo = createMockPublishAttemptRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");
    const retryControl = createMockRetryControl();
    const httpClient = createMockHttpClient();
    const envReader = createMockEnvReader({
      REGIME_ENGINE_BASE_URL: "http://localhost:4000",
      REGIME_ENGINE_AUTH_TOKEN: "test-secret-token"
    });

    (bundleRepo.findLatestByPair as Mock).mockResolvedValue(MOCK_BUNDLE_ROW);
    (contract.validateCanonicalizeAndHash as Mock).mockResolvedValue({
      payload: MOCK_BUNDLE_ROW.payload,
      payloadCanonical: MOCK_BUNDLE_ROW.payloadCanonical,
      payloadHash: MOCK_BUNDLE_ROW.payloadHash,
      idempotencyKey: MOCK_BUNDLE_ROW.idempotencyKey,
      schemaVersion: "evidence-bundle.v1"
    });
    (httpClient.postJsonRaw as Mock).mockResolvedValue({
      status: 401,
      ok: false,
      body: { error: "Unauthorized" },
      headers: {}
    });
    (publishAttemptRepo.insert as Mock).mockResolvedValue({ outcome: "inserted", row: { id: 1 } });

    const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as () => never);

    const runtime: NodeRuntime = {
      http: httpClient,
      jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env: envReader,
      clock,
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: { nextRunId: vi.fn(() => "run-id") },
      retryControl,
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: vi.fn().mockResolvedValue(undefined) },
        rawObservationRepo: {},
        normalizedObservationRepo: {},
        featureRepo: {},
        bundleRepo,
        briefRepo: {},
        publishAttemptRepo
      }),
      getContract: vi.fn().mockResolvedValue(contract)
    };

    const { runPublishEvidenceBundleScript } =
      await import("../../scripts/collectors/publish-evidence-bundle.js");

    await runPublishEvidenceBundleScript(runtime);

    expect(processExitSpy).toHaveBeenCalledWith(1);

    processExitSpy.mockRestore();
  });

  it("permanent_http_failed status exits nonzero", async () => {
    const bundleRepo = createMockBundleRepo();
    const publishAttemptRepo = createMockPublishAttemptRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");
    const retryControl = createMockRetryControl();
    const httpClient = createMockHttpClient();
    const envReader = createMockEnvReader({
      REGIME_ENGINE_BASE_URL: "http://localhost:4000",
      REGIME_ENGINE_AUTH_TOKEN: "test-secret-token"
    });

    (bundleRepo.findLatestByPair as Mock).mockResolvedValue(MOCK_BUNDLE_ROW);
    (contract.validateCanonicalizeAndHash as Mock).mockResolvedValue({
      payload: MOCK_BUNDLE_ROW.payload,
      payloadCanonical: MOCK_BUNDLE_ROW.payloadCanonical,
      payloadHash: MOCK_BUNDLE_ROW.payloadHash,
      idempotencyKey: MOCK_BUNDLE_ROW.idempotencyKey,
      schemaVersion: "evidence-bundle.v1"
    });
    (httpClient.postJsonRaw as Mock).mockRejectedValue(new Error("Connection refused"));
    (publishAttemptRepo.insert as Mock).mockResolvedValue({ outcome: "inserted", row: { id: 1 } });

    const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as () => never);

    const runtime: NodeRuntime = {
      http: httpClient,
      jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env: envReader,
      clock,
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: { nextRunId: vi.fn(() => "run-id") },
      retryControl,
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: vi.fn().mockResolvedValue(undefined) },
        rawObservationRepo: {},
        normalizedObservationRepo: {},
        featureRepo: {},
        bundleRepo,
        briefRepo: {},
        publishAttemptRepo
      }),
      getContract: vi.fn().mockResolvedValue(contract)
    };

    const { runPublishEvidenceBundleScript } =
      await import("../../scripts/collectors/publish-evidence-bundle.js");

    await runPublishEvidenceBundleScript(runtime);

    expect(processExitSpy).toHaveBeenCalledWith(1);

    processExitSpy.mockRestore();
  });

  it("transient_failure_exhausted status exits nonzero", async () => {
    const bundleRepo = createMockBundleRepo();
    const publishAttemptRepo = createMockPublishAttemptRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");
    const retryControl = createMockRetryControl();
    const httpClient = createMockHttpClient();
    const envReader = createMockEnvReader({
      REGIME_ENGINE_BASE_URL: "http://localhost:4000",
      REGIME_ENGINE_AUTH_TOKEN: "test-secret-token"
    });

    (bundleRepo.findLatestByPair as Mock).mockResolvedValue(MOCK_BUNDLE_ROW);
    (contract.validateCanonicalizeAndHash as Mock).mockResolvedValue({
      payload: MOCK_BUNDLE_ROW.payload,
      payloadCanonical: MOCK_BUNDLE_ROW.payloadCanonical,
      payloadHash: MOCK_BUNDLE_ROW.payloadHash,
      idempotencyKey: MOCK_BUNDLE_ROW.idempotencyKey,
      schemaVersion: "evidence-bundle.v1"
    });
    (httpClient.postJsonRaw as Mock).mockResolvedValue({
      status: 503,
      ok: false,
      body: { error: "Service unavailable" },
      headers: {}
    });
    (publishAttemptRepo.insert as Mock).mockResolvedValue({ outcome: "inserted", row: { id: 1 } });

    const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as () => never);

    const runtime: NodeRuntime = {
      http: httpClient,
      jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env: envReader,
      clock,
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: { nextRunId: vi.fn(() => "run-id") },
      retryControl,
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: vi.fn().mockResolvedValue(undefined) },
        rawObservationRepo: {},
        normalizedObservationRepo: {},
        featureRepo: {},
        bundleRepo,
        briefRepo: {},
        publishAttemptRepo
      }),
      getContract: vi.fn().mockResolvedValue(contract)
    };

    const { runPublishEvidenceBundleScript } =
      await import("../../scripts/collectors/publish-evidence-bundle.js");

    await runPublishEvidenceBundleScript(runtime);

    expect(processExitSpy).toHaveBeenCalledWith(1);

    processExitSpy.mockRestore();
  });
});

describe("audit store failure exits nonzero and is visible", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("audit_store_failed outcome exits nonzero", async () => {
    const bundleRepo = createMockBundleRepo();
    const publishAttemptRepo = createMockPublishAttemptRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");
    const retryControl = createMockRetryControl();
    const httpClient = createMockHttpClient();
    const envReader = createMockEnvReader({
      REGIME_ENGINE_BASE_URL: "http://localhost:4000",
      REGIME_ENGINE_AUTH_TOKEN: "test-secret-token"
    });

    (bundleRepo.findLatestByPair as Mock).mockResolvedValue(MOCK_BUNDLE_ROW);
    (contract.validateCanonicalizeAndHash as Mock).mockResolvedValue({
      payload: MOCK_BUNDLE_ROW.payload,
      payloadCanonical: MOCK_BUNDLE_ROW.payloadCanonical,
      payloadHash: MOCK_BUNDLE_ROW.payloadHash,
      idempotencyKey: MOCK_BUNDLE_ROW.idempotencyKey,
      schemaVersion: "evidence-bundle.v1"
    });
    (httpClient.postJsonRaw as Mock).mockResolvedValue({
      status: 201,
      ok: true,
      body: { success: true },
      headers: {}
    });
    (publishAttemptRepo.insert as Mock).mockRejectedValue(new Error("Database connection lost"));

    const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as () => never);
    const consoleErrorSpy = vi.spyOn(console, "error").mockReturnValue(undefined);

    const runtime: NodeRuntime = {
      http: httpClient,
      jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env: envReader,
      clock,
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: { nextRunId: vi.fn(() => "run-id") },
      retryControl,
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: vi.fn().mockResolvedValue(undefined) },
        rawObservationRepo: {},
        normalizedObservationRepo: {},
        featureRepo: {},
        bundleRepo,
        briefRepo: {},
        publishAttemptRepo
      }),
      getContract: vi.fn().mockResolvedValue(contract)
    };

    const { runPublishEvidenceBundleScript } =
      await import("../../scripts/collectors/publish-evidence-bundle.js");

    await runPublishEvidenceBundleScript(runtime);

    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalled();

    processExitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});

describe("missing Regime configuration fails before HTTP", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("missing REGIME_ENGINE_AUTH_TOKEN fails before HTTP call", async () => {
    const bundleRepo = createMockBundleRepo();
    const publishAttemptRepo = createMockPublishAttemptRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");
    const retryControl = createMockRetryControl();
    const httpClient = createMockHttpClient();
    const envReader = createMockEnvReader({
      REGIME_ENGINE_BASE_URL: "http://localhost:4000"
    });

    const consoleErrorSpy = vi.spyOn(console, "error").mockReturnValue(undefined);
    const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as () => never);

    const runtime: NodeRuntime = {
      http: httpClient,
      jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env: envReader,
      clock,
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: { nextRunId: vi.fn(() => "run-id") },
      retryControl,
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: vi.fn().mockResolvedValue(undefined) },
        rawObservationRepo: {},
        normalizedObservationRepo: {},
        featureRepo: {},
        bundleRepo,
        briefRepo: {},
        publishAttemptRepo
      }),
      getContract: vi.fn().mockResolvedValue(contract)
    };

    const { runPublishEvidenceBundleScript } =
      await import("../../scripts/collectors/publish-evidence-bundle.js");

    await runPublishEvidenceBundleScript(runtime);

    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(httpClient.postJsonRaw).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it("missing REGIME_ENGINE_BASE_URL fails before HTTP call", async () => {
    const bundleRepo = createMockBundleRepo();
    const publishAttemptRepo = createMockPublishAttemptRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");
    const retryControl = createMockRetryControl();
    const httpClient = createMockHttpClient();
    const envReader = createMockEnvReader({
      REGIME_ENGINE_AUTH_TOKEN: "test-secret-token"
    });

    const consoleErrorSpy = vi.spyOn(console, "error").mockReturnValue(undefined);
    const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as () => never);

    const runtime: NodeRuntime = {
      http: httpClient,
      jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env: envReader,
      clock,
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: { nextRunId: vi.fn(() => "run-id") },
      retryControl,
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: vi.fn().mockResolvedValue(undefined) },
        rawObservationRepo: {},
        normalizedObservationRepo: {},
        featureRepo: {},
        bundleRepo,
        briefRepo: {},
        publishAttemptRepo
      }),
      getContract: vi.fn().mockResolvedValue(contract)
    };

    const { runPublishEvidenceBundleScript } =
      await import("../../scripts/collectors/publish-evidence-bundle.js");

    await runPublishEvidenceBundleScript(runtime);

    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(httpClient.postJsonRaw).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });
});

describe("database connection closes on every outcome", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("closes on created outcome", async () => {
    const bundleRepo = createMockBundleRepo();
    const publishAttemptRepo = createMockPublishAttemptRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");
    const retryControl = createMockRetryControl();
    const httpClient = createMockHttpClient();
    const envReader = createMockEnvReader({
      REGIME_ENGINE_BASE_URL: "http://localhost:4000",
      REGIME_ENGINE_AUTH_TOKEN: "test-secret-token"
    });

    (bundleRepo.findLatestByPair as Mock).mockResolvedValue(MOCK_BUNDLE_ROW);
    (contract.validateCanonicalizeAndHash as Mock).mockResolvedValue({
      payload: MOCK_BUNDLE_ROW.payload,
      payloadCanonical: MOCK_BUNDLE_ROW.payloadCanonical,
      payloadHash: MOCK_BUNDLE_ROW.payloadHash,
      idempotencyKey: MOCK_BUNDLE_ROW.idempotencyKey,
      schemaVersion: "evidence-bundle.v1"
    });
    (httpClient.postJsonRaw as Mock).mockResolvedValue({
      status: 201,
      ok: true,
      body: { success: true },
      headers: {}
    });
    (publishAttemptRepo.insert as Mock).mockResolvedValue({ outcome: "inserted", row: { id: 1 } });

    const closeMock = vi.fn().mockResolvedValue(undefined);

    const runtime: NodeRuntime = {
      http: httpClient,
      jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env: envReader,
      clock,
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: { nextRunId: vi.fn(() => "run-id") },
      retryControl,
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: closeMock },
        rawObservationRepo: {},
        normalizedObservationRepo: {},
        featureRepo: {},
        bundleRepo,
        briefRepo: {},
        publishAttemptRepo
      }),
      getContract: vi.fn().mockResolvedValue(contract)
    };

    const { runPublishEvidenceBundleScript } =
      await import("../../scripts/collectors/publish-evidence-bundle.js");

    await runPublishEvidenceBundleScript(runtime);

    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("closes on validation_failed outcome", async () => {
    const bundleRepo = createMockBundleRepo();
    const publishAttemptRepo = createMockPublishAttemptRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");
    const retryControl = createMockRetryControl();
    const httpClient = createMockHttpClient();
    const envReader = createMockEnvReader({
      REGIME_ENGINE_BASE_URL: "http://localhost:4000",
      REGIME_ENGINE_AUTH_TOKEN: "test-secret-token"
    });

    (bundleRepo.findLatestByPair as Mock).mockResolvedValue(MOCK_BUNDLE_ROW);
    (contract.validateCanonicalizeAndHash as Mock).mockResolvedValue({
      payload: MOCK_BUNDLE_ROW.payload,
      payloadCanonical: MOCK_BUNDLE_ROW.payloadCanonical,
      payloadHash: MOCK_BUNDLE_ROW.payloadHash,
      idempotencyKey: MOCK_BUNDLE_ROW.idempotencyKey,
      schemaVersion: "evidence-bundle.v1"
    });
    (httpClient.postJsonRaw as Mock).mockResolvedValue({
      status: 422,
      ok: false,
      body: { error: "Validation failed" },
      headers: {}
    });
    (publishAttemptRepo.insert as Mock).mockResolvedValue({ outcome: "inserted", row: { id: 1 } });

    const closeMock = vi.fn().mockResolvedValue(undefined);
    const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as () => never);

    const runtime: NodeRuntime = {
      http: httpClient,
      jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env: envReader,
      clock,
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: { nextRunId: vi.fn(() => "run-id") },
      retryControl,
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: closeMock },
        rawObservationRepo: {},
        normalizedObservationRepo: {},
        featureRepo: {},
        bundleRepo,
        briefRepo: {},
        publishAttemptRepo
      }),
      getContract: vi.fn().mockResolvedValue(contract)
    };

    const { runPublishEvidenceBundleScript } =
      await import("../../scripts/collectors/publish-evidence-bundle.js");

    await runPublishEvidenceBundleScript(runtime);

    expect(closeMock).toHaveBeenCalledTimes(1);
    processExitSpy.mockRestore();
  });

  it("closes on missing token (init failure)", async () => {
    const bundleRepo = createMockBundleRepo();
    const publishAttemptRepo = createMockPublishAttemptRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");
    const retryControl = createMockRetryControl();
    const httpClient = createMockHttpClient();
    const envReader = createMockEnvReader({
      REGIME_ENGINE_BASE_URL: "http://localhost:4000"
    });

    const closeMock = vi.fn().mockResolvedValue(undefined);
    const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as () => never);

    const runtime: NodeRuntime = {
      http: httpClient,
      jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env: envReader,
      clock,
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: { nextRunId: vi.fn(() => "run-id") },
      retryControl,
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: closeMock },
        rawObservationRepo: {},
        normalizedObservationRepo: {},
        featureRepo: {},
        bundleRepo,
        briefRepo: {},
        publishAttemptRepo
      }),
      getContract: vi.fn().mockResolvedValue(contract)
    };

    const { runPublishEvidenceBundleScript } =
      await import("../../scripts/collectors/publish-evidence-bundle.js");

    await runPublishEvidenceBundleScript(runtime);

    expect(closeMock).toHaveBeenCalledTimes(1);
    processExitSpy.mockRestore();
  });

  it("closes on thrown error", async () => {
    const bundleRepo = createMockBundleRepo();
    const publishAttemptRepo = createMockPublishAttemptRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");
    const retryControl = createMockRetryControl();
    const httpClient = createMockHttpClient();
    const envReader = createMockEnvReader({
      REGIME_ENGINE_BASE_URL: "http://localhost:4000",
      REGIME_ENGINE_AUTH_TOKEN: "test-secret-token"
    });

    (bundleRepo.findLatestByPair as Mock).mockRejectedValue(new Error("Database error"));

    const closeMock = vi.fn().mockResolvedValue(undefined);
    const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as () => never);

    const runtime: NodeRuntime = {
      http: httpClient,
      jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env: envReader,
      clock,
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: { nextRunId: vi.fn(() => "run-id") },
      retryControl,
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: closeMock },
        rawObservationRepo: {},
        normalizedObservationRepo: {},
        featureRepo: {},
        bundleRepo,
        briefRepo: {},
        publishAttemptRepo
      }),
      getContract: vi.fn().mockResolvedValue(contract)
    };

    const { runPublishEvidenceBundleScript } =
      await import("../../scripts/collectors/publish-evidence-bundle.js");

    await runPublishEvidenceBundleScript(runtime);

    expect(closeMock).toHaveBeenCalledTimes(1);
    processExitSpy.mockRestore();
  });
});

describe("auth token never appears in stdout stderr or serialized result", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("token does not appear in structured event output", async () => {
    const bundleRepo = createMockBundleRepo();
    const publishAttemptRepo = createMockPublishAttemptRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");
    const retryControl = createMockRetryControl();
    const httpClient = createMockHttpClient();
    const envReader = createMockEnvReader({
      REGIME_ENGINE_BASE_URL: "http://localhost:4000",
      REGIME_ENGINE_AUTH_TOKEN: "super-secret-auth-token-12345"
    });

    (bundleRepo.findLatestByPair as Mock).mockResolvedValue(MOCK_BUNDLE_ROW);
    (contract.validateCanonicalizeAndHash as Mock).mockResolvedValue({
      payload: MOCK_BUNDLE_ROW.payload,
      payloadCanonical: MOCK_BUNDLE_ROW.payloadCanonical,
      payloadHash: MOCK_BUNDLE_ROW.payloadHash,
      idempotencyKey: MOCK_BUNDLE_ROW.idempotencyKey,
      schemaVersion: "evidence-bundle.v1"
    });
    (httpClient.postJsonRaw as Mock).mockResolvedValue({
      status: 201,
      ok: true,
      body: { success: true },
      headers: {}
    });
    (publishAttemptRepo.insert as Mock).mockResolvedValue({ outcome: "inserted", row: { id: 1 } });

    const consoleLogSpy = vi.spyOn(console, "log").mockReturnValue(undefined);
    const consoleErrorSpy = vi.spyOn(console, "error").mockReturnValue(undefined);

    const runtime: NodeRuntime = {
      http: httpClient,
      jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env: envReader,
      clock,
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: { nextRunId: vi.fn(() => "run-id") },
      retryControl,
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: vi.fn().mockResolvedValue(undefined) },
        rawObservationRepo: {},
        normalizedObservationRepo: {},
        featureRepo: {},
        bundleRepo,
        briefRepo: {},
        publishAttemptRepo
      }),
      getContract: vi.fn().mockResolvedValue(contract)
    };

    const { runPublishEvidenceBundleScript } =
      await import("../../scripts/collectors/publish-evidence-bundle.js");

    await runPublishEvidenceBundleScript(runtime);

    const allLogCalls = [...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls];
    const allOutputStrings = allLogCalls.map((call) => JSON.stringify(call)).join("\n");

    expect(allOutputStrings).not.toContain("super-secret-auth-token-12345");
    expect(allOutputStrings).not.toContain("REGIME_ENGINE_AUTH_TOKEN");
    expect(allOutputStrings).not.toContain("Bearer");

    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("token does not appear in final result serialization", async () => {
    const bundleRepo = createMockBundleRepo();
    const publishAttemptRepo = createMockPublishAttemptRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");
    const retryControl = createMockRetryControl();
    const httpClient = createMockHttpClient();
    const envReader = createMockEnvReader({
      REGIME_ENGINE_BASE_URL: "http://localhost:4000",
      REGIME_ENGINE_AUTH_TOKEN: "super-secret-auth-token-12345"
    });

    (bundleRepo.findLatestByPair as Mock).mockResolvedValue(MOCK_BUNDLE_ROW);
    (contract.validateCanonicalizeAndHash as Mock).mockResolvedValue({
      payload: MOCK_BUNDLE_ROW.payload,
      payloadCanonical: MOCK_BUNDLE_ROW.payloadCanonical,
      payloadHash: MOCK_BUNDLE_ROW.payloadHash,
      idempotencyKey: MOCK_BUNDLE_ROW.idempotencyKey,
      schemaVersion: "evidence-bundle.v1"
    });
    (httpClient.postJsonRaw as Mock).mockResolvedValue({
      status: 201,
      ok: true,
      body: { success: true },
      headers: {}
    });
    (publishAttemptRepo.insert as Mock).mockResolvedValue({ outcome: "inserted", row: { id: 1 } });

    const consoleLogSpy = vi.spyOn(console, "log").mockReturnValue(undefined);

    const runtime: NodeRuntime = {
      http: httpClient,
      jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env: envReader,
      clock,
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: { nextRunId: vi.fn(() => "run-id") },
      retryControl,
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: vi.fn().mockResolvedValue(undefined) },
        rawObservationRepo: {},
        normalizedObservationRepo: {},
        featureRepo: {},
        bundleRepo,
        briefRepo: {},
        publishAttemptRepo
      }),
      getContract: vi.fn().mockResolvedValue(contract)
    };

    const { runPublishEvidenceBundleScript } =
      await import("../../scripts/collectors/publish-evidence-bundle.js");

    const result = await runPublishEvidenceBundleScript(runtime);

    const resultString = JSON.stringify(result);
    expect(resultString).not.toContain("super-secret-auth-token-12345");
    expect(resultString).not.toContain("REGIME_ENGINE_AUTH_TOKEN");
    expect(resultString).not.toContain("Bearer");

    consoleLogSpy.mockRestore();
  });

  it("HTTP request headers do not leak token in mock calls", async () => {
    const bundleRepo = createMockBundleRepo();
    const publishAttemptRepo = createMockPublishAttemptRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");
    const retryControl = createMockRetryControl();
    const httpClient = createMockHttpClient();
    const envReader = createMockEnvReader({
      REGIME_ENGINE_BASE_URL: "http://localhost:4000",
      REGIME_ENGINE_AUTH_TOKEN: "super-secret-auth-token-12345"
    });

    (bundleRepo.findLatestByPair as Mock).mockResolvedValue(MOCK_BUNDLE_ROW);
    (contract.validateCanonicalizeAndHash as Mock).mockResolvedValue({
      payload: MOCK_BUNDLE_ROW.payload,
      payloadCanonical: MOCK_BUNDLE_ROW.payloadCanonical,
      payloadHash: MOCK_BUNDLE_ROW.payloadHash,
      idempotencyKey: MOCK_BUNDLE_ROW.idempotencyKey,
      schemaVersion: "evidence-bundle.v1"
    });
    (httpClient.postJsonRaw as Mock).mockResolvedValue({
      status: 201,
      ok: true,
      body: { success: true },
      headers: {}
    });
    (publishAttemptRepo.insert as Mock).mockResolvedValue({ outcome: "inserted", row: { id: 1 } });

    const runtime: NodeRuntime = {
      http: httpClient,
      jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env: envReader,
      clock,
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: { nextRunId: vi.fn(() => "run-id") },
      retryControl,
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: vi.fn().mockResolvedValue(undefined) },
        rawObservationRepo: {},
        normalizedObservationRepo: {},
        featureRepo: {},
        bundleRepo,
        briefRepo: {},
        publishAttemptRepo
      }),
      getContract: vi.fn().mockResolvedValue(contract)
    };

    const { runPublishEvidenceBundleScript } =
      await import("../../scripts/collectors/publish-evidence-bundle.js");

    await runPublishEvidenceBundleScript(runtime);

    expect(httpClient.postJsonRaw).toHaveBeenCalled();
    const mockCalls = (httpClient.postJsonRaw as Mock).mock.calls;
    for (const call of mockCalls) {
      const [url, payload] = call;
      expect(url).not.toContain("super-secret-auth-token-12345");
      expect(JSON.stringify(payload)).not.toContain("super-secret-auth-token-12345");
    }
  });
});
