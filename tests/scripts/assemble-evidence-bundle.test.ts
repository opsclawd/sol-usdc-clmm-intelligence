import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
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
import { runAssembleEvidenceBundleScript } from "../../scripts/collectors/assemble-evidence-bundle.js";

const originalProcessExitCode = process.exitCode;

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

function createMockBundleRepo() {
  return {
    insertOrClassify: vi.fn(),
    findById: vi.fn(),
    findByPair: vi.fn(),
    findLatestByPair: vi.fn()
  };
}

function createMockContract() {
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
  poolId: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
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
    volume_liquidity_ratio_24h: "volume-liquidity-ratio-24h/v1",
    oi_trend_4h: "oi-trend-4h/v1",
    liquidation_cluster_1h: "liquidation-cluster-1h/v1",
    funding_rate_annualized: "funding-rate-annualized/v1",
    basis_spread_bps: "basis-spread-bps/v1"
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
      poolId: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
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
          poolId: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE"
        },
        payloadHash: "raw-hash-200",
        payloadCanonical: JSON.stringify(
          makeClmmBundle({
            pool: makePoolData({ poolId: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE" }),
            positions: [
              makePositionData({
                walletId: "Wallet1234567890abcdef",
                positionId: "Pos11111111111111111111111111111111111111111",
                poolId: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE"
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
      poolId: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
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
          poolId: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE"
        },
        payloadCanonical: JSON.stringify(
          makeClmmBundle({
            pool: makePoolData({ poolId: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE" }),
            positions: [
              makePositionData({
                walletId: "Wallet1234567890abcdef",
                positionId: "Pos11111111111111111111111111111111111111111",
                poolId: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE"
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
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalProcessExitCode;
  });

  it("persisted leaves process.exitCode unset while returning and printing the redacted success", async () => {
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
      poolId: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
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
          poolId: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE"
        },
        payloadHash: "raw-hash-200",
        payloadCanonical: JSON.stringify(
          makeClmmBundle({
            pool: makePoolData({ poolId: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE" }),
            positions: [
              makePositionData({
                walletId: "Wallet1234567890abcdef",
                positionId: "Pos11111111111111111111111111111111111111111",
                poolId: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE"
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

    const result = await runAssembleEvidenceBundleScript(runtime, "data/assembly-request.json");

    expect(consoleLogSpy).toHaveBeenCalled();
    const loggedOutput = JSON.parse(
      consoleLogSpy.mock.calls[consoleLogSpy.mock.calls.length - 1]![0] as string
    );

    expect(result).toEqual({
      outcome: "persisted",
      rowId: 99,
      payloadHash: "hash-abc",
      slotCount: 11,
      warnings: expect.any(Array)
    });
    expect(loggedOutput).toEqual(result);
    expect(process.exitCode).toBeUndefined();
    expect(processExitSpy).not.toHaveBeenCalled();

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
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalProcessExitCode;
  });

  it("identical_replay leaves process.exitCode unset while returning and printing the redacted replay", async () => {
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
      poolId: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
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
          poolId: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE"
        },
        payloadHash: "raw-hash-200",
        payloadCanonical: JSON.stringify(
          makeClmmBundle({
            pool: makePoolData({ poolId: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE" }),
            positions: [
              makePositionData({
                walletId: "Wallet1234567890abcdef",
                positionId: "Pos11111111111111111111111111111111111111111",
                poolId: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE"
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

    expect(result1).toEqual(result2);
    expect(result1).toMatchObject({
      outcome: "identical_replay",
      rowId: 42,
      payloadHash: "identical-hash"
    });
    expect(process.exitCode).toBeUndefined();
    expect(processExitSpy).not.toHaveBeenCalled();

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

interface ScriptHarnessOptions {
  featureCandidates?: DerivedFeatureRow[];
  request?: AssembleEvidenceBundleJobRequest;
}

interface ScriptHarness {
  runtime: NodeRuntime;
  rawRepo: ReturnType<typeof createMockRawObservationRepo>;
  normalizedRepo: ReturnType<typeof createMockNormalizedObservationRepo>;
  featureRepo: ReturnType<typeof createMockFeatureRepo>;
  bundleRepo: ReturnType<typeof createMockBundleRepo>;
  contract: ReturnType<typeof createMockContract>;
  clock: Clock;
  connection: { close: Mock };
  setRequest: (req: AssembleEvidenceBundleJobRequest) => void;
}

function createScriptHarness(options?: ScriptHarnessOptions): ScriptHarness {
  const rawRepo = createMockRawObservationRepo();
  const normalizedRepo = createMockNormalizedObservationRepo();
  const featureRepo = createMockFeatureRepo();
  const bundleRepo = createMockBundleRepo();
  const contract = createMockContract();
  const clock = createMockClock("2024-01-01T00:00:00.000Z");
  const connection = { close: vi.fn().mockResolvedValue(undefined) };

  const mockFeature: DerivedFeatureRow = {
    id: 10,
    featureKind: "range_location",
    status: "AVAILABLE",
    pair: "SOL/USDC",
    poolId: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
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

  featureRepo.listBundleCandidates = vi
    .fn()
    .mockResolvedValue(options?.featureCandidates ?? [mockFeature]);

  normalizedRepo.findByIds = vi.fn().mockResolvedValue([
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

  rawRepo.findByIds = vi.fn().mockResolvedValue([
    {
      id: 200,
      source: "clmm-v2-bundle",
      sourceObservationKey: "key-200",
      observedAtUnixMs: 1700000000000,
      receivedAtUnixMs: 1700000000000,
      payload: {
        walletId: "Wallet1234567890abcdef",
        positionId: "Pos11111111111111111111111111111111111111111",
        poolId: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE"
      },
      payloadHash: "raw-hash-200",
      payloadCanonical: JSON.stringify(
        makeClmmBundle({
          pool: makePoolData({ poolId: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE" }),
          positions: [
            makePositionData({
              walletId: "Wallet1234567890abcdef",
              positionId: "Pos11111111111111111111111111111111111111111",
              poolId: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE"
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

  const readJsonMock = vi.fn().mockResolvedValue(options?.request ?? VALID_REQUEST);

  const runtime: NodeRuntime = {
    http: { getJson: vi.fn() } as unknown as NodeRuntime["http"],
    jsonStore: {
      readJson: readJsonMock,
      writeJson: vi.fn()
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
      connection,
      rawObservationRepo: rawRepo as unknown as RawObservationRepo,
      normalizedObservationRepo: normalizedRepo as unknown as NormalizedObservationRepo,
      featureRepo: featureRepo as unknown as DerivedFeatureRepo,
      bundleRepo: bundleRepo as unknown as EvidenceBundleRepo,
      briefRepo: { insert: vi.fn(), findByBundleId: vi.fn(), findByHash: vi.fn() }
    }),
    getContract: vi.fn().mockResolvedValue(contract as unknown as EvidenceBundleContract)
  };

  return {
    runtime,
    rawRepo,
    normalizedRepo,
    featureRepo,
    bundleRepo,
    contract,
    clock,
    connection,
    setRequest: (req: AssembleEvidenceBundleJobRequest) => {
      readJsonMock.mockResolvedValue(req);
    }
  };
}

describe("CLI terminal outcomes set exit status", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalProcessExitCode;
  });

  it("no_bundle emits redacted JSON and sets process.exitCode to 1", async () => {
    const { runtime } = createScriptHarness({
      featureCandidates: []
    });
    const consoleLogSpy = vi.spyOn(console, "log").mockReturnValue(undefined);

    const result = await runAssembleEvidenceBundleScript(runtime, "data/assembly-request.json");

    expect(result).toEqual({ outcome: "no_bundle", warnings: [] });
    expect(JSON.parse(consoleLogSpy.mock.lastCall![0] as string)).toEqual(result);
    expect(process.exitCode).toBe(1);
  });

  it("conflict emits redacted JSON and sets process.exitCode to 1", async () => {
    const harness = createScriptHarness();
    (harness.bundleRepo.insertOrClassify as Mock).mockResolvedValue({
      outcome: "conflict",
      row: {
        id: 99,
        schemaVersion: "evidence-bundle.v1",
        pair: "SOL/USDC",
        asOfUnixMs: 1700000000000,
        expiresAtUnixMs: 1700003600000,
        payload: {},
        payloadHash: "existing-hash",
        payloadCanonical: "{}",
        idempotencyKey: "idem-99",
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
      },
      incomingPayloadHash: "incoming-hash"
    });

    const consoleLogSpy = vi.spyOn(console, "log").mockReturnValue(undefined);

    const result = await runAssembleEvidenceBundleScript(
      harness.runtime,
      "data/assembly-request.json"
    );

    expect(result).toEqual({
      outcome: "conflict",
      rowId: 99,
      incomingPayloadHash: "incoming-hash",
      warnings: []
    });
    expect(JSON.parse(consoleLogSpy.mock.lastCall![0] as string)).toEqual(result);
    expect(process.exitCode).toBe(1);
  });

  const structuredErrorCases = [
    {
      name: "structured validation errors emit the error code and set process.exitCode to 1",
      configure: (harness: ScriptHarness) =>
        harness.setRequest({
          ...VALID_REQUEST,
          acceptedCalculatorVersions:
            {} as AssembleEvidenceBundleJobRequest["acceptedCalculatorVersions"]
        }),
      warning: "REQUEST_VALIDATION_ERROR"
    },
    {
      name: "structured lineage errors emit the error code and set process.exitCode to 1",
      configure: (harness: ScriptHarness) =>
        harness.featureRepo.listBundleCandidates.mockRejectedValue(
          new Error("candidate query failed")
        ),
      warning: "LINEAGE_ERROR"
    },
    {
      name: "structured contract errors emit the error code and set process.exitCode to 1",
      configure: (harness: ScriptHarness) =>
        harness.contract.validateCanonicalizeAndHash.mockRejectedValue({
          code: "VALIDATION_ERROR",
          errors: ["invalid candidate"]
        }),
      warning: "CONTRACT_ERROR"
    },
    {
      name: "structured persistence errors emit the error code and set process.exitCode to 1",
      configure: (harness: ScriptHarness) =>
        harness.bundleRepo.insertOrClassify.mockRejectedValue(new Error("insert failed")),
      warning: "PERSISTENCE_ERROR"
    }
  ] as const;

  for (const testCase of structuredErrorCases) {
    it(testCase.name, async () => {
      const harness = createScriptHarness();
      testCase.configure(harness);
      const consoleLogSpy = vi.spyOn(console, "log").mockReturnValue(undefined);

      const result = await runAssembleEvidenceBundleScript(
        harness.runtime,
        "data/assembly-request.json"
      );

      expect(result).toEqual({ outcome: "error", warnings: [testCase.warning] });
      expect(JSON.parse(consoleLogSpy.mock.lastCall![0] as string)).toEqual(result);
      expect(process.exitCode).toBe(1);
    });
  }

  it("thrown assembly errors return redacted diagnostics and set process.exitCode to 1", async () => {
    const harness = createScriptHarness();
    harness.clock.now = vi.fn(() => {
      throw new Error("clock failed");
    });

    const consoleErrorSpy = vi.spyOn(console, "error").mockReturnValue(undefined);

    const result = await runAssembleEvidenceBundleScript(
      harness.runtime,
      "data/assembly-request.json"
    );

    expect(result).toEqual({
      outcome: "error",
      warnings: ["Evidence bundle assembly failed: Error: clock failed"]
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Evidence bundle assembly failed:",
      expect.any(Error)
    );
    expect(harness.connection.close).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });
});
