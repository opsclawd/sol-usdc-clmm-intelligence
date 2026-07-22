import { describe, it, expect, vi, type Mock, beforeEach } from "vitest";
import type { Clock } from "../../src/ports/clock.js";
import type { RunIdFactory } from "../../src/ports/run-id.js";
import type { EnvReader } from "../../src/ports/env.js";
import type { NodeRuntime } from "../../src/adapters/node/composition-root.js";
import type { EvidenceBundleRepo } from "../../src/ports/bundle-repo.js";
import type { EvidenceBundleContract } from "../../src/ports/evidence-bundle-contract.js";
import type { DerivedFeatureRepo, DerivedFeatureRow } from "../../src/ports/feature-repo.js";
import type { NormalizedObservationRepo } from "../../src/ports/normalized-observation-repo.js";
import type { RawObservationRepo } from "../../src/ports/observation-repo.js";
import type { AssembleEvidenceBundleJobRequest } from "../../src/jobs/assemble-evidence-bundle-job.js";
import type { RetryControl } from "../../src/ports/retry.js";
import { makeClmmBundle, makePoolData, makePositionData } from "../fixtures/clmm-bundle.js";

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

function createMockRawObservationRepo() {
  return {
    insert: vi.fn(),
    insertOrClassify: vi.fn(),
    findById: vi.fn(),
    findByIds: vi.fn(),
    findByIdentity: vi.fn(),
    findByHash: vi.fn(),
    findBySource: vi.fn(),
    updateParseStatus: vi.fn()
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

const VALID_REQUEST: AssembleEvidenceBundleJobRequest = {
  pair: "SOL/USDC",
  poolId: "HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw",
  positionId: "Pos11111111111111111111111111111111111111111",
  walletId: "Wallet1234567890abcdef",
  pipelineRunId: "run-456",
  correlationId: "corr-789",
  evaluationTimeUnixMs: 1700000000000,
  createdAtUnixMs: 1700000000000,
  acceptedCalculatorVersions: {
    range_location: "range-location/v1",
    distance_to_lower: "distance-to-lower/v1",
    distance_to_upper: "distance-to-upper/v1",
    oracle_dex_divergence: "oracle-dex-divergence/v1",
    oracle_confidence_width: "oracle-confidence-width/v1",
    realized_volatility_1h: "realized-volatility-1h/v1",
    volume_liquidity_ratio_24h: "volume-liquidity-ratio-24h/v1"
  },
  schemaVersion: "evidence-bundle.v1",
  assemblySelectionVersion: "selection/v1",
  codeVersion: "1.0.0",
  gitCommit: "abc123def456",
  environment: "test"
};

describe("runtime composes the bundle repository and pinned contract adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("getPersistence() supplies all five repositories without eager database access", async () => {
    const { createNodeRuntime } = await import("../../src/adapters/node/composition-root.js");

    const originalEnvGet = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

    try {
      const runtime = createNodeRuntime();
      const result = await runtime.getPersistence();

      expect(result.rawObservationRepo).toBeDefined();
      expect(result.normalizedObservationRepo).toBeDefined();
      expect(result.featureRepo).toBeDefined();
      expect(result.bundleRepo).toBeDefined();
      expect(result.briefRepo).toBeDefined();
      expect(result.connection).toBeDefined();

      expect(result.rawObservationRepo).not.toBe(result.normalizedObservationRepo);
      expect(result.rawObservationRepo).not.toBe(result.featureRepo);
      expect(result.rawObservationRepo).not.toBe(result.bundleRepo);
      expect(result.normalizedObservationRepo).not.toBe(result.featureRepo);
      expect(result.normalizedObservationRepo).not.toBe(result.bundleRepo);
      expect(result.featureRepo).not.toBe(result.bundleRepo);
      expect(result.bundleRepo).not.toBe(result.briefRepo);
    } finally {
      if (originalEnvGet !== undefined) {
        process.env.DATABASE_URL = originalEnvGet;
      } else {
        delete process.env.DATABASE_URL;
      }
    }
  });

  it("runtime exposes the v1 contract service without eager database access", async () => {
    const { createNodeRuntime } = await import("../../src/adapters/node/composition-root.js");

    const originalEnvGet = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

    try {
      const runtime = createNodeRuntime();

      expect(runtime.getContract).toBeDefined();
      const contract = await runtime.getContract();
      expect(contract).toBeDefined();
      expect(typeof contract.validateCanonicalizeAndHash).toBe("function");
    } finally {
      if (originalEnvGet !== undefined) {
        process.env.DATABASE_URL = originalEnvGet;
      } else {
        delete process.env.DATABASE_URL;
      }
    }
  });

  it("lazy database connection is not accessed until getPersistence is called", async () => {
    const { createNodeRuntime } = await import("../../src/adapters/node/composition-root.js");

    const originalEnvGet = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

    try {
      const runtime = createNodeRuntime();
      expect(runtime.getDb).toBeDefined();

      const dbPromise = runtime.getDb();
      expect(dbPromise).toBeInstanceOf(Promise);

      const persistencePromise = runtime.getPersistence();
      expect(persistencePromise).toBeInstanceOf(Promise);

      const result = await persistencePromise;
      expect(result.connection).toBeDefined();
    } finally {
      if (originalEnvGet !== undefined) {
        process.env.DATABASE_URL = originalEnvGet;
      } else {
        delete process.env.DATABASE_URL;
      }
    }
  });
});

describe("job forwards an explicit immutable assembly request unchanged", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("job adds no clock, run ID, wallet, version, or timestamp defaults", async () => {
    const { assembleEvidenceBundleJob } =
      await import("../../src/jobs/assemble-evidence-bundle-job.js");

    const rawObservationRepo = createMockRawObservationRepo();
    const normalizedObservationRepo = createMockNormalizedObservationRepo();
    const featureRepo = createMockFeatureRepo();
    const bundleRepo = createMockBundleRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");

    const mockFeature: DerivedFeatureRow = {
      id: 10,
      featureKind: "range_location",
      status: "AVAILABLE",
      pair: "SOL/USDC",
      poolId: "HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw",
      positionId: "Pos11111111111111111111111111111111111111111",
      asOfUnixMs: 1700000000000,
      receivedAtUnixMs: 1700000000000,
      validUntilUnixMs: 1700007200000,
      value: 500000,
      confidence: {
        components: {
          sourceReliability: 10000,
          dataCompleteness: 10000,
          derivationConfidence: 10000,
          llmConfidence: null
        },
        compositeScore: 10000,
        level: "high",
        weightingVersion: "v1",
        reasons: []
      },
      calculatorVersion: "range-location/v1",
      selectionVersion: "selection/v1",
      derivationKey: "key-10",
      inputObservationIds: [100],
      rejectedObservationIds: [],
      provenance: {
        sourceRefs: [],
        rawObservationRefs: [
          {
            refType: "normalized_observation",
            id: 100,
            source: "clmm-v2-bundle",
            payloadHash: "norm-hash-200"
          }
        ],
        derivedFromRefs: [],
        processRef: {
          collector: "test",
          jobName: "test",
          pipelineRunId: null,
          codeVersion: null,
          modelVersion: null
        },
        codeVersion: "1.0.0",
        runId: null
      },
      signalClass: "deterministic",
      evidenceFamily: "clmm_state",
      unit: "PPM",
      structuredPayload: {},
      confidenceComposite: 10000,
      confidenceLevel: "high",
      isStale: false,
      staleBehavior: null,
      payloadHash: "feature-hash-10",
      warnings: [],
      reasons: []
    };

    featureRepo.listBundleCandidates = vi.fn().mockResolvedValue([mockFeature]);
    normalizedObservationRepo.findByIds = vi.fn().mockResolvedValue([
      {
        id: 100,
        rawObservationId: 200,
        source: "clmm-v2-bundle",
        observationKind: "clmm_pool_snapshot",
        sourceObservationKey: "key-200",
        observedAtUnixMs: 1700000000000,
        receivedAtUnixMs: 1700000000000,
        validUntilUnixMs: 1700007200000,
        isStale: false,
        payload: {},
        payloadHash: "norm-hash-200",
        payloadCanonical: "{}",
        idempotencyKey: "idem-200",
        confidenceLevel: "high",
        confidenceScore: 1,
        provenance: {},
        version: 1
      }
    ]);
    rawObservationRepo.findByIds = vi.fn().mockResolvedValue([
      {
        id: 200,
        source: "clmm-v2-bundle",
        sourceObservationKey: "key-200",
        observedAtUnixMs: 1700000000000,
        receivedAtUnixMs: 1700000000000,
        payload: {
          walletId: "Wallet1234567890abcdef",
          positionId: "Pos11111111111111111111111111111111111111111",
          poolId: "HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw"
        },
        payloadHash: "raw-hash-200",
        payloadCanonical: JSON.stringify(
          makeClmmBundle({
            pool: makePoolData({ poolId: "HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw" }),
            positions: [
              makePositionData({
                walletId: "Wallet1234567890abcdef",
                positionId: "Pos11111111111111111111111111111111111111111",
                poolId: "HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw"
              })
            ],
            alerts: []
          })
        ),
        idempotencyKey: "idem-raw-200",
        parseStatus: "parsed"
      }
    ]);
    contract.validateCanonicalizeAndHash = vi.fn().mockImplementation(async (candidate) => ({
      payload: candidate,
      payloadCanonical: JSON.stringify(candidate),
      payloadHash: "hash123",
      idempotencyKey: "idempotency-key-456",
      schemaVersion: "evidence-bundle.v1"
    }));
    (bundleRepo.insertOrClassify as Mock).mockResolvedValue({
      outcome: "inserted",
      row: {
        id: 1,
        schemaVersion: "evidence-bundle.v1",
        pair: "SOL/USDC",
        asOfUnixMs: 1700000000000,
        expiresAtUnixMs: 1700003600000,
        payload: {},
        payloadHash: "hash123",
        payloadCanonical: '{"schemaVersion":"evidence-bundle.v1"}',
        idempotencyKey: "idempotency-key-456",
        taxonomySummary: null,
        dominantSignalClass: "deterministic",
        confidence: {
          components: {},
          compositeScore: 0,
          level: "low",
          weightingVersion: "v1",
          reasons: []
        },
        confidenceComposite: 0,
        confidenceLevel: "low",
        validUntilUnixMs: null,
        isStale: false,
        staleBehavior: null,
        provenance: {},
        version: 1,
        receivedAtUnixMs: 1700000000000
      }
    });

    const job = assembleEvidenceBundleJob({
      clock,
      rawRepo: rawObservationRepo as unknown as RawObservationRepo,
      normalizedRepo: normalizedObservationRepo as unknown as NormalizedObservationRepo,
      featureRepo: featureRepo as unknown as DerivedFeatureRepo,
      bundleRepo,
      contract
    });

    const result = await job(VALID_REQUEST);

    expect(result).toBeDefined();
    if (
      "outcome" in result &&
      (result.outcome === "persisted" || result.outcome === "identical_replay")
    ) {
      expect(result.outcome).toBe("persisted");
      expect(result.rowId).toBe(1);
    }

    const validateFn = contract.validateCanonicalizeAndHash as Mock;
    expect(validateFn).toHaveBeenCalled();
    const passedCandidate = validateFn.mock.calls[0]![0];
    expect(passedCandidate.runId).toBe(VALID_REQUEST.pipelineRunId);
    expect(passedCandidate.correlationId).toBe(VALID_REQUEST.correlationId);
  });

  it("request with all required fields is forwarded without modification", async () => {
    const { assembleEvidenceBundleJob } =
      await import("../../src/jobs/assemble-evidence-bundle-job.js");

    const rawObservationRepo = createMockRawObservationRepo();
    const normalizedObservationRepo = createMockNormalizedObservationRepo();
    const featureRepo = createMockFeatureRepo();
    const bundleRepo = createMockBundleRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");

    const mockFeature: DerivedFeatureRow = {
      id: 10,
      featureKind: "range_location",
      status: "AVAILABLE",
      pair: "SOL/USDC",
      poolId: "HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw",
      positionId: "Pos11111111111111111111111111111111111111111",
      asOfUnixMs: 1700000000000,
      receivedAtUnixMs: 1700000000000,
      validUntilUnixMs: 1700007200000,
      value: 500000,
      confidence: {
        components: {
          sourceReliability: 10000,
          dataCompleteness: 10000,
          derivationConfidence: 10000,
          llmConfidence: null
        },
        compositeScore: 10000,
        level: "high",
        weightingVersion: "v1",
        reasons: []
      },
      calculatorVersion: "range-location/v1",
      selectionVersion: "selection/v1",
      derivationKey: "key-10",
      inputObservationIds: [100],
      rejectedObservationIds: [],
      provenance: {
        sourceRefs: [],
        rawObservationRefs: [
          {
            refType: "normalized_observation",
            id: 100,
            source: "clmm-v2-bundle",
            payloadHash: "norm-hash-200"
          }
        ],
        derivedFromRefs: [],
        processRef: {
          collector: "test",
          jobName: "test",
          pipelineRunId: null,
          codeVersion: null,
          modelVersion: null
        },
        codeVersion: "1.0.0",
        runId: null
      },
      signalClass: "deterministic",
      evidenceFamily: "clmm_state",
      unit: "PPM",
      structuredPayload: {},
      confidenceComposite: 10000,
      confidenceLevel: "high",
      isStale: false,
      staleBehavior: null,
      payloadHash: "feature-hash-10",
      warnings: [],
      reasons: []
    };

    featureRepo.listBundleCandidates = vi.fn().mockResolvedValue([mockFeature]);
    (normalizedObservationRepo.findByIds as Mock).mockResolvedValue([
      {
        id: 100,
        rawObservationId: 200,
        source: "clmm-v2-bundle",
        observationKind: "clmm_pool_snapshot",
        sourceObservationKey: "key-200",
        observedAtUnixMs: 1700000000000,
        receivedAtUnixMs: 1700000000000,
        validUntilUnixMs: 1700007200000,
        isStale: false,
        payload: {},
        payloadHash: "norm-hash-200",
        payloadCanonical: "{}",
        idempotencyKey: "idem-200",
        confidenceLevel: "high",
        confidenceScore: 1,
        provenance: {},
        version: 1
      }
    ]);
    (rawObservationRepo.findByIds as Mock).mockResolvedValue([
      {
        id: 200,
        source: "clmm-v2-bundle",
        sourceObservationKey: "key-200",
        observedAtUnixMs: 1700000000000,
        receivedAtUnixMs: 1700000000000,
        payload: {
          walletId: "Wallet1234567890abcdef",
          positionId: "Pos11111111111111111111111111111111111111111",
          poolId: "HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw"
        },
        payloadCanonical: JSON.stringify(
          makeClmmBundle({
            pool: makePoolData({ poolId: "HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw" }),
            positions: [
              makePositionData({
                walletId: "Wallet1234567890abcdef",
                positionId: "Pos11111111111111111111111111111111111111111",
                poolId: "HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw"
              })
            ],
            alerts: []
          })
        ),
        idempotencyKey: "idem-raw-200",
        parseStatus: "parsed"
      }
    ]);
    contract.validateCanonicalizeAndHash = vi.fn().mockImplementation(async (candidate) => ({
      payload: candidate,
      payloadCanonical: JSON.stringify(candidate),
      payloadHash: "hash789",
      idempotencyKey: "idem-789",
      schemaVersion: "evidence-bundle.v1"
    }));
    (bundleRepo.insertOrClassify as Mock).mockResolvedValue({
      outcome: "identical_replay",
      row: {
        id: 42,
        schemaVersion: "evidence-bundle.v1",
        pair: "SOL/USDC",
        asOfUnixMs: 1700000000000,
        expiresAtUnixMs: 1700003600000,
        payload: {},
        payloadHash: "hash789",
        payloadCanonical: '{"test":true}',
        idempotencyKey: "idem-789",
        taxonomySummary: null,
        dominantSignalClass: "deterministic",
        confidence: {
          components: {},
          compositeScore: 0,
          level: "low",
          weightingVersion: "v1",
          reasons: []
        },
        confidenceComposite: 0,
        confidenceLevel: "low",
        validUntilUnixMs: null,
        isStale: false,
        staleBehavior: null,
        provenance: {},
        version: 1,
        receivedAtUnixMs: 1700000000000
      }
    });

    const job = assembleEvidenceBundleJob({
      clock,
      rawRepo: rawObservationRepo as unknown as RawObservationRepo,
      normalizedRepo: normalizedObservationRepo as unknown as NormalizedObservationRepo,
      featureRepo: featureRepo as unknown as DerivedFeatureRepo,
      bundleRepo,
      contract
    });

    const result = await job(VALID_REQUEST);

    expect(result).toBeDefined();
    expect("outcome" in result && result.outcome).toBe("identical_replay");
    if ("outcome" in result && result.outcome === "identical_replay") {
      expect(result.rowId).toBe(42);
    }

    const candidateCall = (contract.validateCanonicalizeAndHash as Mock).mock.calls[0]![0];
    expect(candidateCall.runId).toBe(VALID_REQUEST.pipelineRunId);
    expect(candidateCall.correlationId).toBe(VALID_REQUEST.correlationId);
    expect(candidateCall.createdAt).toBeDefined();
  });
});

describe("script parses required inputs and prints a redacted outcome summary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("output contains outcome, row ID, payload hash, slot count, and warnings", async () => {
    const rawObservationRepo = createMockRawObservationRepo();
    const normalizedObservationRepo = createMockNormalizedObservationRepo();
    const featureRepo = createMockFeatureRepo();
    const bundleRepo = createMockBundleRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");

    const mockFeature: DerivedFeatureRow = {
      id: 10,
      featureKind: "range_location",
      status: "AVAILABLE",
      pair: "SOL/USDC",
      poolId: "HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw",
      positionId: "Pos11111111111111111111111111111111111111111",
      asOfUnixMs: 1700000000000,
      receivedAtUnixMs: 1700000000000,
      validUntilUnixMs: 1700007200000,
      value: 500000,
      confidence: {
        components: {
          sourceReliability: 10000,
          dataCompleteness: 10000,
          derivationConfidence: 10000,
          llmConfidence: null
        },
        compositeScore: 10000,
        level: "high",
        weightingVersion: "v1",
        reasons: []
      },
      calculatorVersion: "range-location/v1",
      selectionVersion: "selection/v1",
      derivationKey: "key-10",
      inputObservationIds: [100],
      rejectedObservationIds: [],
      provenance: {
        sourceRefs: [],
        rawObservationRefs: [
          {
            refType: "normalized_observation",
            id: 100,
            source: "clmm-v2-bundle",
            payloadHash: "norm-hash-200"
          }
        ],
        derivedFromRefs: [],
        processRef: {
          collector: "test",
          jobName: "test",
          pipelineRunId: null,
          codeVersion: null,
          modelVersion: null
        },
        codeVersion: "1.0.0",
        runId: null
      },
      signalClass: "deterministic",
      evidenceFamily: "clmm_state",
      unit: "PPM",
      structuredPayload: {},
      confidenceComposite: 10000,
      confidenceLevel: "high",
      isStale: false,
      staleBehavior: null,
      payloadHash: "feature-hash-10",
      warnings: [],
      reasons: []
    };

    featureRepo.listBundleCandidates = vi.fn().mockResolvedValue([mockFeature]);
    normalizedObservationRepo.findByIds = vi.fn().mockResolvedValue([
      {
        id: 100,
        rawObservationId: 200,
        source: "clmm-v2-bundle",
        observationKind: "clmm_pool_snapshot",
        sourceObservationKey: "key-200",
        observedAtUnixMs: 1700000000000,
        receivedAtUnixMs: 1700000000000,
        validUntilUnixMs: 1700007200000,
        isStale: false,
        payload: {},
        payloadHash: "norm-hash-200",
        payloadCanonical: "{}",
        idempotencyKey: "idem-200",
        confidenceLevel: "high",
        confidenceScore: 1,
        provenance: {},
        version: 1
      }
    ]);
    rawObservationRepo.findByIds = vi.fn().mockResolvedValue([
      {
        id: 200,
        source: "clmm-v2-bundle",
        sourceObservationKey: "key-200",
        observedAtUnixMs: 1700000000000,
        receivedAtUnixMs: 1700000000000,
        payload: {
          walletId: "Wallet1234567890abcdef",
          positionId: "Pos11111111111111111111111111111111111111111",
          poolId: "HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw"
        },
        payloadHash: "raw-hash-200",
        payloadCanonical: JSON.stringify(
          makeClmmBundle({
            pool: makePoolData({ poolId: "HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw" }),
            positions: [
              makePositionData({
                walletId: "Wallet1234567890abcdef",
                positionId: "Pos11111111111111111111111111111111111111111",
                poolId: "HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw"
              })
            ],
            alerts: []
          })
        ),
        idempotencyKey: "idem-raw-200",
        parseStatus: "parsed"
      }
    ]);
    contract.validateCanonicalizeAndHash = vi.fn().mockImplementation(async (candidate) => ({
      payload: candidate,
      payloadCanonical: JSON.stringify(candidate),
      payloadHash: "hash-abc",
      idempotencyKey: "idem-abc",
      schemaVersion: "evidence-bundle.v1"
    }));
    (bundleRepo.insertOrClassify as Mock).mockResolvedValue({
      outcome: "inserted",
      row: {
        id: 99,
        schemaVersion: "evidence-bundle.v1",
        pair: "SOL/USDC",
        asOfUnixMs: 1700000000000,
        expiresAtUnixMs: 1700003600000,
        payload: {},
        payloadHash: "hash-abc",
        payloadCanonical: '{"test":true}',
        idempotencyKey: "idem-abc",
        taxonomySummary: null,
        dominantSignalClass: "deterministic",
        confidence: {
          components: {},
          compositeScore: 5000,
          level: "high",
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
      }
    });

    const consoleLogSpy = vi.spyOn(console, "log").mockReturnValue(undefined);
    const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as () => never);

    const runtime: NodeRuntime = {
      http: { getJson: vi.fn() } as unknown as NodeRuntime["http"],
      jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env: createMockEnvReader({
        DATABASE_URL: "postgresql://test:test@localhost:5432/test"
      }),
      clock,
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: createMockRunIdFactory(),
      retryControl: createMockRetryControl(),
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: vi.fn().mockResolvedValue(undefined) },
        rawObservationRepo: rawObservationRepo as unknown as RawObservationRepo,
        normalizedObservationRepo:
          normalizedObservationRepo as unknown as NormalizedObservationRepo,
        featureRepo: featureRepo as unknown as DerivedFeatureRepo,
        bundleRepo,
        briefRepo: { insert: vi.fn(), findByBundleId: vi.fn(), findByHash: vi.fn() }
      }),
      getContract: vi.fn().mockResolvedValue(contract)
    };

    const { runAssembleEvidenceBundleScript } =
      await import("../../scripts/collectors/assemble-evidence-bundle.js");

    (runtime.jsonStore.readJson as Mock).mockResolvedValue(VALID_REQUEST);

    await runAssembleEvidenceBundleScript(runtime, "data/assembly-request.json");

    expect(consoleLogSpy).toHaveBeenCalled();
    const loggedOutput = JSON.parse(
      consoleLogSpy.mock.calls[consoleLogSpy.mock.calls.length - 1]![0] as string
    );

    expect(loggedOutput.outcome).toBeDefined();
    expect(loggedOutput.rowId).toBeDefined();
    expect(loggedOutput.payloadHash).toBeDefined();
    expect(loggedOutput.slotCount).toBeDefined();
    expect(loggedOutput.warnings).toBeDefined();
    expect(Array.isArray(loggedOutput.warnings)).toBe(true);

    expect(loggedOutput.outcome).toBe("persisted");
    expect(loggedOutput.rowId).toBe(99);
    expect(loggedOutput.payloadHash).toBe("hash-abc");

    expect(processExitSpy).not.toHaveBeenCalledWith(1);

    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it("output does not contain wallet ID or canonical payload", async () => {
    const rawObservationRepo = createMockRawObservationRepo();
    const normalizedObservationRepo = createMockNormalizedObservationRepo();
    const featureRepo = createMockFeatureRepo();
    const bundleRepo = createMockBundleRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");

    (featureRepo.listBundleCandidates as Mock).mockResolvedValue([]);
    (bundleRepo.insertOrClassify as Mock).mockResolvedValue({
      outcome: "inserted",
      row: {
        id: 99,
        schemaVersion: "evidence-bundle.v1",
        pair: "SOL/USDC",
        asOfUnixMs: 1700000000000,
        expiresAtUnixMs: 1700003600000,
        payload: { secret: "should-not-appear" },
        payloadHash: "hash-xyz",
        payloadCanonical: '{"should-not-appear":"in-output"}',
        idempotencyKey: "idem-xyz",
        taxonomySummary: null,
        dominantSignalClass: "deterministic",
        confidence: {
          components: {},
          compositeScore: 5000,
          level: "high",
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
      }
    });

    const consoleLogSpy = vi.spyOn(console, "log").mockReturnValue(undefined);
    const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as () => never);

    const runtime: NodeRuntime = {
      http: { getJson: vi.fn() } as unknown as NodeRuntime["http"],
      jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env: createMockEnvReader({
        DATABASE_URL: "postgresql://test:test@localhost:5432/test"
      }),
      clock,
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: createMockRunIdFactory(),
      retryControl: createMockRetryControl(),
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: vi.fn().mockResolvedValue(undefined) },
        rawObservationRepo: rawObservationRepo as unknown as RawObservationRepo,
        normalizedObservationRepo:
          normalizedObservationRepo as unknown as NormalizedObservationRepo,
        featureRepo: featureRepo as unknown as DerivedFeatureRepo,
        bundleRepo,
        briefRepo: { insert: vi.fn(), findByBundleId: vi.fn(), findByHash: vi.fn() }
      }),
      getContract: vi.fn().mockResolvedValue(contract)
    };

    const { runAssembleEvidenceBundleScript } =
      await import("../../scripts/collectors/assemble-evidence-bundle.js");

    (runtime.jsonStore.readJson as Mock).mockResolvedValue(VALID_REQUEST);

    await runAssembleEvidenceBundleScript(runtime, "data/assembly-request.json");

    expect(consoleLogSpy).toHaveBeenCalled();
    const loggedOutput = JSON.parse(
      consoleLogSpy.mock.calls[consoleLogSpy.mock.calls.length - 1]![0] as string
    );
    const outputString = JSON.stringify(loggedOutput);

    expect(outputString).not.toContain("Wallet1234567890abcdef");
    expect(outputString).not.toContain("secret");
    expect(outputString).not.toContain("should-not-appear");
    expect(outputString).not.toContain("payloadCanonical");

    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });
});

describe("replaying the same input file preserves run and creation identity", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("script sends the same request values for identical replay", async () => {
    const rawObservationRepo = createMockRawObservationRepo();
    const normalizedObservationRepo = createMockNormalizedObservationRepo();
    const featureRepo = createMockFeatureRepo();
    const bundleRepo = createMockBundleRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");

    const mockFeature: DerivedFeatureRow = {
      id: 10,
      featureKind: "range_location",
      status: "AVAILABLE",
      pair: "SOL/USDC",
      poolId: "HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw",
      positionId: "Pos11111111111111111111111111111111111111111",
      asOfUnixMs: 1700000000000,
      receivedAtUnixMs: 1700000000000,
      validUntilUnixMs: 1700007200000,
      value: 500000,
      confidence: {
        components: {
          sourceReliability: 10000,
          dataCompleteness: 10000,
          derivationConfidence: 10000,
          llmConfidence: null
        },
        compositeScore: 10000,
        level: "high",
        weightingVersion: "v1",
        reasons: []
      },
      calculatorVersion: "range-location/v1",
      selectionVersion: "selection/v1",
      derivationKey: "key-10",
      inputObservationIds: [100],
      rejectedObservationIds: [],
      provenance: {
        sourceRefs: [],
        rawObservationRefs: [
          {
            refType: "normalized_observation",
            id: 100,
            source: "clmm-v2-bundle",
            payloadHash: "norm-hash-200"
          }
        ],
        derivedFromRefs: [],
        processRef: {
          collector: "test",
          jobName: "test",
          pipelineRunId: null,
          codeVersion: null,
          modelVersion: null
        },
        codeVersion: "1.0.0",
        runId: null
      },
      signalClass: "deterministic",
      evidenceFamily: "clmm_state",
      unit: "PPM",
      structuredPayload: {},
      confidenceComposite: 10000,
      confidenceLevel: "high",
      isStale: false,
      staleBehavior: null,
      payloadHash: "feature-hash-10",
      warnings: [],
      reasons: []
    };

    featureRepo.listBundleCandidates = vi.fn().mockResolvedValue([mockFeature]);
    normalizedObservationRepo.findByIds = vi.fn().mockResolvedValue([
      {
        id: 100,
        rawObservationId: 200,
        source: "clmm-v2-bundle",
        observationKind: "clmm_pool_snapshot",
        sourceObservationKey: "key-200",
        observedAtUnixMs: 1700000000000,
        receivedAtUnixMs: 1700000000000,
        validUntilUnixMs: 1700007200000,
        isStale: false,
        payload: {},
        payloadHash: "norm-hash-200",
        payloadCanonical: "{}",
        idempotencyKey: "idem-200",
        confidenceLevel: "high",
        confidenceScore: 1,
        provenance: {},
        version: 1
      }
    ]);
    rawObservationRepo.findByIds = vi.fn().mockResolvedValue([
      {
        id: 200,
        source: "clmm-v2-bundle",
        sourceObservationKey: "key-200",
        observedAtUnixMs: 1700000000000,
        receivedAtUnixMs: 1700000000000,
        payload: {
          walletId: "Wallet1234567890abcdef",
          positionId: "Pos11111111111111111111111111111111111111111",
          poolId: "HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw"
        },
        payloadHash: "raw-hash-200",
        payloadCanonical: JSON.stringify(
          makeClmmBundle({
            pool: makePoolData({ poolId: "HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw" }),
            positions: [
              makePositionData({
                walletId: "Wallet1234567890abcdef",
                positionId: "Pos11111111111111111111111111111111111111111",
                poolId: "HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw"
              })
            ],
            alerts: []
          })
        ),
        idempotencyKey: "idem-raw-200",
        parseStatus: "parsed"
      }
    ]);
    contract.validateCanonicalizeAndHash = vi.fn().mockImplementation(async (candidate) => ({
      payload: candidate,
      payloadCanonical: JSON.stringify(candidate),
      payloadHash: "identical-hash",
      idempotencyKey: "identical-idem",
      schemaVersion: "evidence-bundle.v1"
    }));
    (bundleRepo.insertOrClassify as Mock).mockResolvedValue({
      outcome: "identical_replay",
      row: {
        id: 42,
        schemaVersion: "evidence-bundle.v1",
        pair: "SOL/USDC",
        asOfUnixMs: 1700000000000,
        expiresAtUnixMs: 1700003600000,
        payload: {},
        payloadHash: "identical-hash",
        payloadCanonical: '{"identical":true}',
        idempotencyKey: "identical-idem",
        taxonomySummary: null,
        dominantSignalClass: "deterministic",
        confidence: {
          components: {},
          compositeScore: 0,
          level: "low",
          weightingVersion: "v1",
          reasons: []
        },
        confidenceComposite: 0,
        confidenceLevel: "low",
        validUntilUnixMs: null,
        isStale: false,
        staleBehavior: null,
        provenance: {},
        version: 1,
        receivedAtUnixMs: 1700000000000
      }
    });

    const consoleLogSpy = vi.spyOn(console, "log").mockReturnValue(undefined);
    const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as () => never);

    const runtime: NodeRuntime = {
      http: { getJson: vi.fn() } as unknown as NodeRuntime["http"],
      jsonStore: { readJson: vi.fn(), writeJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env: createMockEnvReader({
        DATABASE_URL: "postgresql://test:test@localhost:5432/test"
      }),
      clock,
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: createMockRunIdFactory(),
      retryControl: createMockRetryControl(),
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: vi.fn().mockResolvedValue(undefined) },
        rawObservationRepo: rawObservationRepo as unknown as RawObservationRepo,
        normalizedObservationRepo:
          normalizedObservationRepo as unknown as NormalizedObservationRepo,
        featureRepo: featureRepo as unknown as DerivedFeatureRepo,
        bundleRepo,
        briefRepo: { insert: vi.fn(), findByBundleId: vi.fn(), findByHash: vi.fn() }
      }),
      getContract: vi.fn().mockResolvedValue(contract)
    };

    const { runAssembleEvidenceBundleScript } =
      await import("../../scripts/collectors/assemble-evidence-bundle.js");

    (runtime.jsonStore.readJson as Mock).mockResolvedValue(VALID_REQUEST);

    const result1 = await runAssembleEvidenceBundleScript(runtime, "data/assembly-request.json");
    const result2 = await runAssembleEvidenceBundleScript(runtime, "data/assembly-request.json");

    expect(result1.outcome).toBe("identical_replay");
    expect(result2.outcome).toBe("identical_replay");

    if (result1.outcome === "identical_replay" && result2.outcome === "identical_replay") {
      expect(result1.rowId).toBe(result2.rowId);
      expect(result1.payloadHash).toBe(result2.payloadHash);
    }

    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });
});

describe("invalid input exits before database composition", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("malformed JSON produces non-zero exit without repository access", async () => {
    const rawObservationRepo = createMockRawObservationRepo();
    const normalizedObservationRepo = createMockNormalizedObservationRepo();
    const featureRepo = createMockFeatureRepo();
    const bundleRepo = createMockBundleRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");

    const consoleErrorSpy = vi.spyOn(console, "error").mockReturnValue(undefined);
    const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as () => never);

    const runtime: NodeRuntime = {
      http: { getJson: vi.fn() } as unknown as NodeRuntime["http"],
      jsonStore: {
        readJson: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token"))
      } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env: createMockEnvReader({
        DATABASE_URL: "postgresql://test:test@localhost:5432/test"
      }),
      clock,
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: createMockRunIdFactory(),
      retryControl: createMockRetryControl(),
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: vi.fn().mockResolvedValue(undefined) },
        rawObservationRepo: rawObservationRepo as unknown as RawObservationRepo,
        normalizedObservationRepo:
          normalizedObservationRepo as unknown as NormalizedObservationRepo,
        featureRepo: featureRepo as unknown as DerivedFeatureRepo,
        bundleRepo,
        briefRepo: { insert: vi.fn(), findByBundleId: vi.fn(), findByHash: vi.fn() }
      }),
      getContract: vi.fn().mockResolvedValue(contract)
    };

    const { runAssembleEvidenceBundleScript } =
      await import("../../scripts/collectors/assemble-evidence-bundle.js");

    await runAssembleEvidenceBundleScript(runtime, "data/malformed.json");

    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(runtime.getPersistence).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it("missing required identity/version fields produces non-zero exit", async () => {
    const rawObservationRepo = createMockRawObservationRepo();
    const normalizedObservationRepo = createMockNormalizedObservationRepo();
    const featureRepo = createMockFeatureRepo();
    const bundleRepo = createMockBundleRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");

    const consoleErrorSpy = vi.spyOn(console, "error").mockReturnValue(undefined);
    const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as () => never);

    const runtime: NodeRuntime = {
      http: { getJson: vi.fn() } as unknown as NodeRuntime["http"],
      jsonStore: { readJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env: createMockEnvReader({
        DATABASE_URL: "postgresql://test:test@localhost:5432/test"
      }),
      clock,
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: createMockRunIdFactory(),
      retryControl: createMockRetryControl(),
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: vi.fn().mockResolvedValue(undefined) },
        rawObservationRepo: rawObservationRepo as unknown as RawObservationRepo,
        normalizedObservationRepo:
          normalizedObservationRepo as unknown as NormalizedObservationRepo,
        featureRepo: featureRepo as unknown as DerivedFeatureRepo,
        bundleRepo,
        briefRepo: { insert: vi.fn(), findByBundleId: vi.fn(), findByHash: vi.fn() }
      }),
      getContract: vi.fn().mockResolvedValue(contract)
    };

    const { runAssembleEvidenceBundleScript } =
      await import("../../scripts/collectors/assemble-evidence-bundle.js");

    const invalidRequest = { ...VALID_REQUEST };
    delete (invalidRequest as Record<string, unknown>)["pipelineRunId"];
    delete (invalidRequest as Record<string, unknown>)["schemaVersion"];

    (runtime.jsonStore.readJson as Mock).mockResolvedValue(invalidRequest);

    await runAssembleEvidenceBundleScript(runtime, "data/invalid-request.json");

    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(runtime.getPersistence).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it("wrong pair produces non-zero exit without repository access", async () => {
    const rawObservationRepo = createMockRawObservationRepo();
    const normalizedObservationRepo = createMockNormalizedObservationRepo();
    const featureRepo = createMockFeatureRepo();
    const bundleRepo = createMockBundleRepo();
    const contract = createMockContract();
    const clock = createMockClock("2024-01-01T00:00:00.000Z");

    const consoleErrorSpy = vi.spyOn(console, "error").mockReturnValue(undefined);
    const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as () => never);

    const runtime: NodeRuntime = {
      http: { getJson: vi.fn() } as unknown as NodeRuntime["http"],
      jsonStore: { readJson: vi.fn() } as unknown as NodeRuntime["jsonStore"],
      textReader: { readText: vi.fn() } as unknown as NodeRuntime["textReader"],
      env: createMockEnvReader({
        DATABASE_URL: "postgresql://test:test@localhost:5432/test"
      }),
      clock,
      commandRunner: { run: vi.fn() } as unknown as NodeRuntime["commandRunner"],
      runIdFactory: createMockRunIdFactory(),
      retryControl: createMockRetryControl(),
      getDb: vi.fn(),
      getPersistence: vi.fn().mockResolvedValue({
        connection: { close: vi.fn().mockResolvedValue(undefined) },
        rawObservationRepo: rawObservationRepo as unknown as RawObservationRepo,
        normalizedObservationRepo:
          normalizedObservationRepo as unknown as NormalizedObservationRepo,
        featureRepo: featureRepo as unknown as DerivedFeatureRepo,
        bundleRepo,
        briefRepo: { insert: vi.fn(), findByBundleId: vi.fn(), findByHash: vi.fn() }
      }),
      getContract: vi.fn().mockResolvedValue(contract)
    };

    const { runAssembleEvidenceBundleScript } =
      await import("../../scripts/collectors/assemble-evidence-bundle.js");

    const wrongPairRequest = { ...VALID_REQUEST, pair: "SOL/USDT" };

    (runtime.jsonStore.readJson as Mock).mockResolvedValue(wrongPairRequest);

    await runAssembleEvidenceBundleScript(runtime, "data/wrong-pair.json");

    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(runtime.getPersistence).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });
});
