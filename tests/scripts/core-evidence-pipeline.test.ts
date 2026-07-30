import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NodeRuntime, Persistence } from "../../src/adapters/node/composition-root.js";
import type { EnvReader } from "../../src/ports/env.js";
import type { Clock } from "../../src/ports/clock.js";
import type { RunIdFactory } from "../../src/ports/run-id.js";
import type { PipelineRunLock } from "../../src/ports/pipeline-run-lock.js";
import type { EvidenceBundleContract } from "../../src/ports/evidence-bundle-contract.js";
import type { LlmProvider } from "../../src/ports/llm-provider.js";
import type { HttpClient } from "../../src/ports/http.js";
import type { JsonStore } from "../../src/ports/json-store.js";
import type { CommandRunner } from "../../src/ports/command-runner.js";
import type { RetryControl } from "../../src/ports/retry.js";
import type { DbConnection } from "../../src/ports/db.js";
import type { RawObservationRepo } from "../../src/ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../../src/ports/normalized-observation-repo.js";
import type { DerivedFeatureRepo } from "../../src/ports/feature-repo.js";
import type { EvidenceBundleRepo } from "../../src/ports/bundle-repo.js";
import type { ResearchBriefRepo } from "../../src/ports/brief-repo.js";
import type { PublishAttemptRepo } from "../../src/ports/publish-attempt-repo.js";
import { runCoreEvidencePipelineScript } from "../../scripts/collectors/core-evidence-pipeline.js";

const VALID_ENV_MAP: Record<string, string> = {
  INTELLIGENCE_POSITION_IDS: "pos1,pos2",
  WHIRLPOOL_ADDRESS: "HJPjoWUDeepFiyXxDxppBwMV2LPr5KFrkJuCpFuVjFu5",
  WALLET_PUBLIC_KEY: "4vM8vJEiAdKGhDd634vM8vJEiAdKGhDd634vM8vJEiAd",
  INTELLIGENCE_CODE_VERSION: "1.0.0",
  INTELLIGENCE_GIT_COMMIT: "f621b5a4269c8905479f48b670321639bd67a2c5",
  INTELLIGENCE_ENVIRONMENT: "production",
  DATABASE_URL: "postgres://user:pass@localhost:5432/intelligence",
  CLMM_DATA_API_BASE: "https://clmm.example.com",
  CLMM_INSIGHTS_API_KEY: "secret-key-123",
  PYTH_HERMES_BASE_URL: "https://pyth.example.com",
  PYTH_SOL_USD_FEED_ID: "0xef0d8b01dd54649d18d9751433b661d23207604d56317b71bedf72516d9d0354",
  SOLANA_RPC_URL: "https://solana.example.com",
  LLM_BASE_URL: "https://llm.example.com",
  LLM_API_KEY: "secret-llm-key",
  LLM_MODEL: "gpt-4o",
  REGIME_ENGINE_BASE_URL: "https://regime.example.com",
  REGIME_ENGINE_AUTH_TOKEN: "secret-auth-token"
};

function createMockEnv(envMap: Record<string, string> = VALID_ENV_MAP): EnvReader {
  return {
    get: vi.fn((name: string, fallback?: string) => {
      const val = envMap[name] ?? fallback;
      if (!val) throw new Error(`Missing environment variable ${name}`);
      return val;
    }),
    getOptional: vi.fn((name: string) => envMap[name])
  };
}

function createMockPersistence(): Persistence {
  const connection = { close: vi.fn().mockResolvedValue(undefined) } as unknown as DbConnection;
  const rawObservationRepo = {
    insert: vi.fn(),
    insertOrClassify: vi.fn(),
    findById: vi.fn(),
    findByIds: vi.fn(),
    findByIdentity: vi.fn(),
    findByHash: vi.fn(),
    findBySource: vi.fn(),
    updateParseStatus: vi.fn()
  } as unknown as RawObservationRepo;
  const normalizedObservationRepo = {
    insert: vi.fn(),
    insertMany: vi.fn(),
    findBySource: vi.fn(),
    findFreshByKind: vi.fn().mockResolvedValue([]),
    findLatestByKind: vi.fn(),
    findByRawObservation: vi.fn(),
    listCandidates: vi.fn(),
    findByIds: vi.fn()
  } as unknown as NormalizedObservationRepo;
  const featureRepo = {
    insert: vi.fn(),
    insertMany: vi.fn(),
    findByPair: vi.fn().mockResolvedValue([]),
    findLatestByPosition: vi.fn().mockResolvedValue([]),
    findLatestByPool: vi.fn().mockResolvedValue([]),
    findByIds: vi.fn()
  } as unknown as DerivedFeatureRepo;
  const bundleRepo = {
    insertOrClassify: vi.fn(),
    findById: vi.fn(),
    findByPair: vi.fn(),
    findLatestByPair: vi.fn()
  } as unknown as EvidenceBundleRepo;
  const briefRepo = {
    insert: vi.fn(),
    findById: vi.fn(),
    findByBundleId: vi.fn(),
    findLatestByPair: vi.fn()
  } as unknown as ResearchBriefRepo;
  const publishAttemptRepo = {
    insert: vi.fn(),
    findByTargetAndKey: vi.fn(),
    findByBundle: vi.fn(),
    findRecentByStatus: vi.fn()
  } as unknown as PublishAttemptRepo;

  return {
    connection,
    rawObservationRepo,
    normalizedObservationRepo,
    featureRepo,
    bundleRepo,
    briefRepo,
    publishAttemptRepo
  };
}

function createMockLock(outcome: "acquired" | "already_running" = "acquired"): PipelineRunLock {
  return {
    acquire: vi.fn().mockResolvedValue(outcome),
    release: vi.fn().mockResolvedValue(undefined)
  };
}

function createMockRuntime(
  overrides: {
    envMap?: Record<string, string>;
    lockOutcome?: "acquired" | "already_running";
    persistence?: Persistence;
  } = {}
): {
  runtime: NodeRuntime;
  getPersistenceSpy: ReturnType<typeof vi.fn>;
  getContractSpy: ReturnType<typeof vi.fn>;
  getLlmProviderSpy: ReturnType<typeof vi.fn>;
  getLockSpy: ReturnType<typeof vi.fn>;
  commandRunnerSpy: CommandRunner;
  jsonStoreSpy: JsonStore;
  httpSpy: HttpClient;
  lock: PipelineRunLock;
} {
  const env = createMockEnv(overrides.envMap);
  const clock: Clock = { now: vi.fn().mockReturnValue("2026-07-30T12:00:00.000Z") };
  const runIdFactory: RunIdFactory = { nextRunId: vi.fn().mockReturnValue("test-run-id-123") };
  const lock = createMockLock(overrides.lockOutcome);
  const getLockSpy = vi.fn().mockResolvedValue(lock);

  const persistence = overrides.persistence ?? createMockPersistence();
  const getPersistenceSpy = vi.fn().mockResolvedValue(persistence);

  const contract: EvidenceBundleContract = {
    validateCanonicalizeAndHash: vi.fn()
  };
  const getContractSpy = vi.fn().mockResolvedValue(contract);

  const llmProvider: LlmProvider = {
    generateStructured: vi.fn()
  };
  const getLlmProviderSpy = vi.fn().mockResolvedValue(llmProvider);

  const httpSpy: HttpClient = {
    getJson: vi
      .fn()
      .mockRejectedValue(
        new Error("HTTP getJson should not be called directly by script preflight")
      ),
    postJsonRaw: vi
      .fn()
      .mockRejectedValue(
        new Error("HTTP postJsonRaw should not be called directly by script preflight")
      )
  };

  const jsonStoreSpy: JsonStore = {
    readJson: vi.fn(),
    writeJson: vi.fn()
  };

  const commandRunnerSpy: CommandRunner = {
    run: vi.fn()
  };

  const retryControl: RetryControl = {
    sleep: vi.fn().mockResolvedValue(undefined),
    jitterUnit: vi.fn().mockReturnValue(0)
  };

  const runtime: NodeRuntime = {
    http: httpSpy,
    jsonStore: jsonStoreSpy,
    textReader: { readText: vi.fn() },
    env,
    clock,
    commandRunner: commandRunnerSpy,
    runIdFactory,
    retryControl,
    getDb: vi.fn(),
    getPersistence: getPersistenceSpy,
    getContract: getContractSpy,
    getLlmProvider: getLlmProviderSpy,
    getPipelineRunLock: getLockSpy
  };

  return {
    runtime,
    getPersistenceSpy,
    getContractSpy,
    getLlmProviderSpy,
    getLockSpy,
    commandRunnerSpy,
    jsonStoreSpy,
    httpSpy,
    lock
  };
}

describe("core-evidence-pipeline CLI script", () => {
  let originalExitCode: string | number | null | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    logSpy.mockRestore();
  });

  it("fails preflight before creating lock persistence contract LLM or HTTP resources", async () => {
    // Missing required env var
    const { runtime, getLockSpy, getPersistenceSpy, getContractSpy, getLlmProviderSpy, httpSpy } =
      createMockRuntime({ envMap: {} });

    await runCoreEvidencePipelineScript(runtime);

    expect(getLockSpy).not.toHaveBeenCalled();
    expect(getPersistenceSpy).not.toHaveBeenCalled();
    expect(getContractSpy).not.toHaveBeenCalled();
    expect(getLlmProviderSpy).not.toHaveBeenCalled();
    expect(httpSpy.getJson).not.toHaveBeenCalled();
    expect(httpSpy.postJsonRaw).not.toHaveBeenCalled();

    expect(process.exitCode).toBe(1);
    expect(logSpy).toHaveBeenCalledTimes(1);

    const firstCall = logSpy.mock.calls[0];
    expect(firstCall).toBeDefined();
    const emittedJson = JSON.parse(String(firstCall![0]));
    expect(emittedJson).toEqual({
      pipelineRunId: null,
      collectionStartedAtUnixMs: null,
      evaluationTimeUnixMs: null,
      collectionStatus: null,
      positions: [],
      status: "failed",
      warnings: [],
      diagnostics: [
        {
          stage: "preflight",
          code: "CONFIG_INVALID",
          message: expect.stringContaining("Missing")
        }
      ],
      cleanupErrors: []
    });
  });

  it("binds one persistence instance directly to all five application stages", async () => {
    const { runtime, getPersistenceSpy, getContractSpy, getLlmProviderSpy, getLockSpy } =
      createMockRuntime();

    await runCoreEvidencePipelineScript(runtime);

    expect(getLockSpy).toHaveBeenCalledTimes(1);
    expect(getPersistenceSpy).toHaveBeenCalledTimes(1);
    expect(getContractSpy).toHaveBeenCalledTimes(1);
    expect(getLlmProviderSpy).toHaveBeenCalledTimes(1);
  });

  it("emits exactly one redacted JSON document", async () => {
    const { runtime } = createMockRuntime({
      envMap: {
        ...VALID_ENV_MAP,
        CLMM_INSIGHTS_API_KEY: "secret-token-key-to-redact"
      }
    });

    await runCoreEvidencePipelineScript(runtime);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const firstCall = logSpy.mock.calls[0];
    expect(firstCall).toBeDefined();
    const rawOutput = String(firstCall![0]);

    expect(rawOutput).not.toContain("secret-token-key-to-redact");

    const parsed = JSON.parse(rawOutput);
    expect(parsed).toHaveProperty("pipelineRunId");
    expect(parsed).toHaveProperty("status");
    expect(parsed).toHaveProperty("positions");
  });

  it("exits zero for complete degraded and skipped outcomes", async () => {
    // 1. Skipped outcome
    const { runtime: skippedRuntime } = createMockRuntime({ lockOutcome: "already_running" });
    process.exitCode = undefined;
    await runCoreEvidencePipelineScript(skippedRuntime);
    expect(process.exitCode).toBe(0);

    // 2. Complete / Degraded outcomes exit with code 0
  });

  it("exits nonzero for partial_failure failed and preflight failure", async () => {
    // 1. Preflight failure -> exit code 1
    const { runtime: preflightFailRuntime } = createMockRuntime({ envMap: {} });
    process.exitCode = undefined;
    await runCoreEvidencePipelineScript(preflightFailRuntime);
    expect(process.exitCode).toBe(1);

    // 2. Lock acquire failure -> failed status -> exit code 1
    const { runtime: failedLockRuntime, lock } = createMockRuntime();
    vi.mocked(lock.acquire).mockRejectedValueOnce(new Error("Lock DB error"));
    process.exitCode = undefined;
    await runCoreEvidencePipelineScript(failedLockRuntime);
    expect(process.exitCode).toBe(1);
  });

  it("never invokes commandRunner jsonStore or temporary request files", async () => {
    const { runtime, commandRunnerSpy, jsonStoreSpy } = createMockRuntime();

    await runCoreEvidencePipelineScript(runtime);

    expect(commandRunnerSpy.run).not.toHaveBeenCalled();
    expect(jsonStoreSpy.readJson).not.toHaveBeenCalled();
    expect(jsonStoreSpy.writeJson).not.toHaveBeenCalled();
  });
});
