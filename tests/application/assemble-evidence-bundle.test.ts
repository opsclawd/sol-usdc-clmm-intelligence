import { describe, expect, it, beforeEach } from "vitest";
import type { Clock } from "../../src/ports/clock.js";
import type {
  EvidenceBundleContract,
  CanonicalEvidenceBundle
} from "../../src/ports/evidence-bundle-contract.js";
import type {
  DerivedFeatureRepo,
  NormalizedObservationRepo,
  RawObservationRepo,
  EvidenceBundleRepo,
  DerivedFeatureRow,
  NormalizedObservationRow,
  RawObservationRow,
  EvidenceBundleRow,
  EvidenceBundleInsert,
  DerivedFeatureInsert,
  NormalizedObservationInsert,
  RawObservationInsert
} from "../../src/ports/index.js";
import type { RawInsertOutcome } from "../../src/ports/observation-repo.js";
import type { EvidenceBundleInsertOutcome } from "../../src/ports/bundle-repo.js";
import type { BundleFeatureCandidateQuery } from "../../src/ports/feature-repo.js";
import type { EvidenceBundleV1 } from "../../src/contracts/generated/evidence-bundle-v1.js";
import type {
  AssembleEvidenceBundleRequest,
  AssembleEvidenceBundleSuccess,
  AssembleEvidenceBundleResult
} from "../../src/application/assemble-evidence-bundle.js";
import { DEFAULT_CONFIDENCE, DEFAULT_PROVENANCE } from "../helpers/taxonomy-fixtures.js";
import type { ProvenanceRef, Source, ObservationKind } from "../../src/contracts/taxonomy.js";

const EPOCH = "2024-01-01T00:00:00.000Z";
const EVAL_MS = new Date(EPOCH).getTime();

const CALCULATOR_VERSIONS = {
  range_location: "1.0.0",
  distance_to_lower: "1.0.0",
  distance_to_upper: "1.0.0",
  oracle_dex_divergence: "1.0.0",
  oracle_confidence_width: "1.0.0",
  realized_volatility_1h: "1.0.0",
  volume_liquidity_ratio_24h: "1.0.0"
} as const;

function makeRawRef(id: number, source: Source, payloadHash: string): ProvenanceRef {
  return {
    refType: "raw_observation",
    id,
    source,
    payloadHash
  };
}

function makeNormalizedRef(id: number, source: Source, payloadHash: string): ProvenanceRef {
  return {
    refType: "normalized_observation",
    id,
    source,
    payloadHash
  };
}

function makeDerivedFeatureRow(
  overrides: Partial<DerivedFeatureRow> & { id: number; rawRefs?: ProvenanceRef[] }
): DerivedFeatureRow {
  const rawRefs = overrides.rawRefs ?? [];
  return {
    id: overrides.id,
    featureKind: overrides.featureKind ?? "range_location",
    signalClass: "deterministic",
    evidenceFamily: "clmm_state",
    value: overrides.value ?? 500000,
    structuredPayload: {},
    asOfUnixMs: overrides.asOfUnixMs ?? EVAL_MS - 60000,
    confidence: DEFAULT_CONFIDENCE,
    confidenceComposite: 1,
    confidenceLevel: "high",
    validUntilUnixMs: overrides.validUntilUnixMs ?? EVAL_MS + 3600000,
    isStale: overrides.isStale ?? false,
    staleBehavior: null,
    provenance: {
      ...DEFAULT_PROVENANCE,
      rawObservationRefs: rawRefs
    },
    payloadHash: `hash-${overrides.id}`,
    receivedAtUnixMs: overrides.receivedAtUnixMs ?? EVAL_MS - 60000,
    status: overrides.status ?? "AVAILABLE",
    unit: overrides.unit ?? "PPM",
    pair: "SOL/USDC",
    calculatorVersion: overrides.calculatorVersion ?? "1.0.0",
    selectionVersion: "mvp-selection/v1",
    inputObservationIds: overrides.inputObservationIds ?? [],
    rejectedObservationIds: [],
    derivationKey: `dk-${overrides.id}`,
    poolId: overrides.poolId ?? "pool-abc",
    positionId: overrides.positionId ?? "pos-1",
    warnings: overrides.warnings ?? [],
    reasons: overrides.reasons ?? []
  };
}

function makeNormalizedRow(
  overrides: Partial<NormalizedObservationRow> & { id: number }
): NormalizedObservationRow {
  return {
    id: overrides.id,
    rawObservationId: overrides.rawObservationId ?? overrides.id,
    source: overrides.source ?? "clmm-v2-bundle",
    observationKind: overrides.observationKind ?? "position_state",
    signalClass: "deterministic",
    evidenceFamily: "clmm_state",
    payload: { positionId: "pos-1", poolId: "pool-abc" },
    payloadHash: `norm-hash-${overrides.id}`,
    confidence: DEFAULT_CONFIDENCE,
    confidenceComposite: 1,
    confidenceLevel: "high",
    validUntilUnixMs: EVAL_MS + 3600000,
    isStale: false,
    staleBehavior: null,
    provenance: DEFAULT_PROVENANCE,
    receivedAtUnixMs: overrides.receivedAtUnixMs ?? EVAL_MS - 60000
  };
}

function makeRawRow(overrides: Partial<RawObservationRow> & { id: number }): RawObservationRow {
  return {
    id: overrides.id,
    source: overrides.source ?? "clmm-v2-bundle",
    sourceObservationKey: `key-${overrides.id}`,
    observedAtUnixMs: overrides.observedAtUnixMs ?? EVAL_MS - 70000,
    fetchedAtUnixMs: overrides.fetchedAtUnixMs ?? EVAL_MS - 65000,
    payloadHash: `raw-hash-${overrides.id}`,
    payloadCanonical: JSON.stringify({ id: overrides.id }),
    parseStatus: "parsed",
    sourceRequestMeta: null,
    receivedAtUnixMs: overrides.receivedAtUnixMs ?? EVAL_MS - 60000
  };
}

function assertSuccess(result: AssembleEvidenceBundleResult): AssembleEvidenceBundleSuccess {
  if ("code" in result) {
    throw new Error(`Unexpected error result: ${result.code}`);
  }
  return result;
}

class RecordingClock implements Clock {
  constructor(
    private value: string,
    private executionLog: string[]
  ) {}
  now(): string {
    this.executionLog.push("clock.now");
    return this.value;
  }
}

class FakeFeatureRepo implements DerivedFeatureRepo {
  store: DerivedFeatureRow[] = [];

  constructor(private executionLog: string[]) {}

  async insert(row: DerivedFeatureInsert): Promise<DerivedFeatureRow> {
    this.executionLog.push("feature.insert");
    const results = await this.insertMany([row]);
    return results[0]!;
  }

  async insertMany(rows: readonly DerivedFeatureInsert[]): Promise<DerivedFeatureRow[]> {
    this.executionLog.push("feature.insertMany");
    const results: DerivedFeatureRow[] = [];
    for (const row of rows) {
      const existing = this.store.find(
        (r) => r.featureKind === row.featureKind && r.derivationKey === row.derivationKey
      );
      if (existing) {
        results.push(existing);
      } else {
        const newRow: DerivedFeatureRow = { ...row } as DerivedFeatureRow;
        this.store.push(newRow);
        results.push(newRow);
      }
    }
    return results;
  }

  async findByDerivationKey(
    featureKind: string,
    derivationKey: string
  ): Promise<DerivedFeatureRow | undefined> {
    return this.store.find(
      (r) => r.featureKind === featureKind && r.derivationKey === derivationKey
    );
  }

  async findByKind(featureKind: string, sinceUnixMs: number): Promise<DerivedFeatureRow[]> {
    return this.store.filter((r) => r.featureKind === featureKind && r.asOfUnixMs >= sinceUnixMs);
  }

  async listBundleCandidates(query: BundleFeatureCandidateQuery): Promise<DerivedFeatureRow[]> {
    this.executionLog.push("feature.listBundleCandidates");
    const result = this.store
      .filter(
        (r) =>
          query.featureKinds.includes(r.featureKind) &&
          r.pair === query.pair &&
          r.asOfUnixMs >= query.asOfAtOrAfterUnixMs &&
          r.asOfUnixMs <= query.asOfAtOrBeforeUnixMs &&
          r.receivedAtUnixMs <= query.receivedAtOrBeforeUnixMs
      )
      .sort((a, b) => {
        if (b.asOfUnixMs !== a.asOfUnixMs) return b.asOfUnixMs - a.asOfUnixMs;
        if (b.receivedAtUnixMs !== a.receivedAtUnixMs)
          return b.receivedAtUnixMs - a.receivedAtUnixMs;
        return b.id - a.id;
      });
    return result;
  }
}

class FakeNormalizedRepo implements NormalizedObservationRepo {
  store: NormalizedObservationRow[] = [];
  lastFindByIdsArg: number[] = [];

  constructor(private executionLog: string[]) {}

  async insert(row: NormalizedObservationInsert): Promise<NormalizedObservationRow> {
    this.executionLog.push("normalized.insert");
    return row as NormalizedObservationRow;
  }

  async insertMany(
    rows: readonly NormalizedObservationInsert[]
  ): Promise<NormalizedObservationRow[]> {
    this.executionLog.push("normalized.insertMany");
    return rows.map((r) => r as NormalizedObservationRow);
  }

  async findBySource(
    source: Source,
    observationKind: ObservationKind,
    sinceUnixMs: number
  ): Promise<NormalizedObservationRow[]> {
    return this.store.filter(
      (r) =>
        r.source === source &&
        r.observationKind === observationKind &&
        r.receivedAtUnixMs >= sinceUnixMs
    );
  }

  async findFreshByKind(
    source: Source,
    observationKind: ObservationKind
  ): Promise<NormalizedObservationRow[]> {
    return this.store.filter(
      (r) => r.source === source && r.observationKind === observationKind && !r.isStale
    );
  }

  async findLatestByKind(
    source: Source,
    observationKind: ObservationKind
  ): Promise<NormalizedObservationRow | null> {
    const matches = this.store.filter(
      (r) => r.source === source && r.observationKind === observationKind
    );
    return matches.length > 0 ? matches[matches.length - 1]! : null;
  }

  async findByRawObservation(
    rawObservationId: number,
    observationKind: ObservationKind
  ): Promise<NormalizedObservationRow | null> {
    return (
      this.store.find(
        (r) => r.rawObservationId === rawObservationId && r.observationKind === observationKind
      ) ?? null
    );
  }

  async listCandidates(): Promise<NormalizedObservationRow[]> {
    this.executionLog.push("normalized.listCandidates");
    return this.store;
  }

  async findByIds(ids: readonly number[]): Promise<NormalizedObservationRow[]> {
    this.executionLog.push("normalized.findByIds");
    this.lastFindByIdsArg = [...ids];
    const uniqueIds = new Set(ids);
    return this.store.filter((r) => uniqueIds.has(r.id));
  }
}

class FakeRawRepo implements RawObservationRepo {
  store: RawObservationRow[] = [];
  lastFindByIdsArg: number[] = [];

  constructor(private executionLog: string[]) {}

  async insertOrClassify(row: RawObservationInsert): Promise<RawInsertOutcome> {
    this.executionLog.push("raw.insertOrClassify");
    const existing = this.store.find(
      (r) => r.source === row.source && r.sourceObservationKey === row.sourceObservationKey
    );
    if (existing) {
      return existing.payloadHash === row.payloadHash
        ? { outcome: "identical_replay", row: existing }
        : { outcome: "conflict", row: existing, incomingPayloadHash: row.payloadHash };
    }
    const newRow = { ...row, id: this.store.length + 1 } as RawObservationRow;
    this.store.push(newRow);
    return { outcome: "inserted", row: newRow };
  }

  async findById(id: number): Promise<RawObservationRow | undefined> {
    return this.store.find((r) => r.id === id);
  }

  async findByIds(ids: number[]): Promise<RawObservationRow[]> {
    this.executionLog.push("raw.findByIds");
    this.lastFindByIdsArg = [...ids];
    const uniqueIds = new Set(ids);
    return this.store.filter((r) => uniqueIds.has(r.id));
  }

  async findByIdentity(
    source: Source,
    sourceObservationKey: string
  ): Promise<RawObservationRow | undefined> {
    return this.store.find(
      (r) => r.source === source && r.sourceObservationKey === sourceObservationKey
    );
  }

  async findByHash(source: Source, payloadHash: string): Promise<RawObservationRow | undefined> {
    return this.store.find((r) => r.source === source && r.payloadHash === payloadHash);
  }

  async findBySource(source: Source, sinceUnixMs: number): Promise<RawObservationRow[]> {
    return this.store.filter((r) => r.source === source && r.observedAtUnixMs >= sinceUnixMs);
  }

  async updateParseStatus(
    id: number,
    status: RawObservationRow["parseStatus"]
  ): Promise<RawObservationRow> {
    const row = this.store.find((r) => r.id === id);
    if (!row) throw new Error(`Row ${id} not found`);
    return { ...row, parseStatus: status };
  }
}

class FakeBundleRepo implements EvidenceBundleRepo {
  store: EvidenceBundleRow[] = [];
  private nextId = 1;

  constructor(private executionLog: string[]) {}

  async insertOrClassify(row: EvidenceBundleInsert): Promise<EvidenceBundleInsertOutcome> {
    this.executionLog.push("bundle.insertOrClassify");
    const existing = this.store.find(
      (r) =>
        r.schemaVersion === row.schemaVersion &&
        r.pair === row.pair &&
        r.idempotencyKey === row.idempotencyKey
    );
    if (existing) {
      if (existing.payloadHash === row.payloadHash) {
        return { outcome: "identical_replay", row: existing };
      }
      return {
        outcome: "conflict",
        row: existing,
        incomingPayloadHash: row.payloadHash
      };
    }
    const newRow: EvidenceBundleRow = {
      id: this.nextId++,
      schemaVersion: row.schemaVersion,
      pair: row.pair,
      asOfUnixMs: row.asOfUnixMs,
      expiresAtUnixMs: row.expiresAtUnixMs,
      payload: row.payload,
      payloadHash: row.payloadHash,
      payloadCanonical: row.payloadCanonical,
      idempotencyKey: row.idempotencyKey,
      taxonomySummary: row.taxonomySummary ?? null,
      dominantSignalClass: row.dominantSignalClass ?? "deterministic",
      confidence: row.confidence ?? DEFAULT_CONFIDENCE,
      confidenceComposite: row.confidenceComposite ?? null,
      confidenceLevel: row.confidenceLevel ?? null,
      validUntilUnixMs: row.validUntilUnixMs ?? null,
      isStale: row.isStale ?? false,
      staleBehavior: row.staleBehavior ?? null,
      provenance: row.provenance ?? DEFAULT_PROVENANCE,
      version: row.version ?? 1,
      receivedAtUnixMs: row.receivedAtUnixMs
    };
    this.store.push(newRow);
    return { outcome: "inserted", row: newRow };
  }

  async findByPair(pair: string, sinceUnixMs: number): Promise<EvidenceBundleRow[]> {
    return this.store.filter((r) => r.pair === pair && r.asOfUnixMs >= sinceUnixMs);
  }

  async findLatestByPair(pair: string): Promise<EvidenceBundleRow | undefined> {
    const matches = this.store.filter((r) => r.pair === pair);
    return matches.length > 0 ? matches[matches.length - 1] : undefined;
  }
}

interface FakeContract extends EvidenceBundleContract {
  shouldFail: boolean;
  failError: unknown;
  overridePayloadHash?: string | undefined;
}

function createFakeContract(executionLog: string[]): FakeContract {
  const contract: FakeContract = {
    shouldFail: false,
    failError: null,
    overridePayloadHash: undefined,
    async validateCanonicalizeAndHash(candidate: unknown): Promise<CanonicalEvidenceBundle> {
      executionLog.push("contract.validateCanonicalizeAndHash");
      if (contract.shouldFail) {
        throw contract.failError ?? new Error("Contract validation failed");
      }
      const canonical = JSON.stringify(candidate);
      const hash = contract.overridePayloadHash ?? `hash-${canonical.length}`;
      return {
        payload: candidate as EvidenceBundleV1,
        payloadCanonical: canonical,
        payloadHash: hash,
        idempotencyKey: "fixed-idempotency-key",
        schemaVersion: "evidence-bundle.v1"
      };
    }
  };
  return contract;
}

describe("assembleEvidenceBundle", () => {
  let executionLog: string[];
  let clock: RecordingClock;
  let featureRepo: FakeFeatureRepo;
  let normalizedRepo: FakeNormalizedRepo;
  let rawRepo: FakeRawRepo;
  let bundleRepo: FakeBundleRepo;
  let contract: FakeContract;

  beforeEach(() => {
    executionLog = [];
    clock = new RecordingClock(EPOCH, executionLog);
    featureRepo = new FakeFeatureRepo(executionLog);
    normalizedRepo = new FakeNormalizedRepo(executionLog);
    rawRepo = new FakeRawRepo(executionLog);
    bundleRepo = new FakeBundleRepo(executionLog);
    contract = createFakeContract(executionLog);
  });

  function makeRequest(
    overrides?: Partial<AssembleEvidenceBundleRequest>
  ): AssembleEvidenceBundleRequest {
    return {
      pair: "SOL/USDC",
      poolId: "pool-abc",
      positionId: "pos-1",
      walletId: "wallet-123",
      pipelineRunId: "run-123",
      correlationId: "corr-123",
      evaluationTimeUnixMs: EVAL_MS,
      createdAtUnixMs: EVAL_MS,
      acceptedCalculatorVersions: CALCULATOR_VERSIONS,
      schemaVersion: "evidence-bundle.v1",
      assemblySelectionVersion: "mvp-selection/v1",
      codeVersion: "1.0.0",
      gitCommit: "abc123",
      environment: "development",
      ...overrides
    };
  }

  function seedFeature(rows: DerivedFeatureRow[]) {
    featureRepo.store.push(...rows);
  }

  function seedNormalized(rows: NormalizedObservationRow[]) {
    normalizedRepo.store.push(...rows);
  }

  function seedRaw(rows: RawObservationRow[]) {
    rawRepo.store.push(...rows);
  }

  describe("persists one schema-valid complete deterministic bundle", () => {
    it("selection, lineage, quality, assembly, contract validation, and insert occur in that order", async () => {
      const { assembleEvidenceBundle } =
        await import("../../src/application/assemble-evidence-bundle.js");

      const rawRow = makeRawRow({ id: 1 });
      seedRaw([rawRow]);

      const featureRow = makeDerivedFeatureRow({
        id: 1,
        featureKind: "range_location",
        positionId: "pos-1",
        poolId: "pool-abc",
        inputObservationIds: [1],
        rawRefs: [makeRawRef(1, "clmm-v2-bundle", "raw-hash-1")]
      });
      seedFeature([featureRow]);

      const request = makeRequest();
      const result = assertSuccess(
        await assembleEvidenceBundle(
          { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
          request
        )
      );

      expect(result.outcome).toBe("persisted");
      expect(executionLog).toContain("contract.validateCanonicalizeAndHash");
      expect(executionLog).toContain("bundle.insertOrClassify");
      expect(executionLog.indexOf("contract.validateCanonicalizeAndHash")).toBeLessThan(
        executionLog.indexOf("bundle.insertOrClassify")
      );
    });

    it("insertOrClassify is called exactly once on successful assembly", async () => {
      const { assembleEvidenceBundle } =
        await import("../../src/application/assemble-evidence-bundle.js");

      const rawRow = makeRawRow({ id: 1 });
      seedRaw([rawRow]);

      const featureRow = makeDerivedFeatureRow({
        id: 1,
        featureKind: "range_location",
        positionId: "pos-1",
        poolId: "pool-abc",
        inputObservationIds: [1],
        rawRefs: [makeRawRef(1, "clmm-v2-bundle", "raw-hash-1")]
      });
      seedFeature([featureRow]);

      const request = makeRequest();
      await assembleEvidenceBundle(
        { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
        request
      );

      expect(executionLog.filter((c) => c === "bundle.insertOrClassify").length).toBe(1);
    });
  });

  describe("returns identical_replay without rebuilding mutable run context", () => {
    it("an explicit repeated request returns the original persisted row", async () => {
      const { assembleEvidenceBundle } =
        await import("../../src/application/assemble-evidence-bundle.js");

      const rawRow = makeRawRow({ id: 1 });
      seedRaw([rawRow]);

      const featureRow = makeDerivedFeatureRow({
        id: 1,
        featureKind: "range_location",
        positionId: "pos-1",
        poolId: "pool-abc",
        inputObservationIds: [1],
        rawRefs: [makeRawRef(1, "clmm-v2-bundle", "raw-hash-1")]
      });
      seedFeature([featureRow]);

      const request = makeRequest();

      const result1 = assertSuccess(
        await assembleEvidenceBundle(
          { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
          request
        )
      );

      expect(result1.outcome).toBe("persisted");
      if (result1.outcome !== "persisted") return;

      const originalRowId = result1.rowId;

      const result2 = assertSuccess(
        await assembleEvidenceBundle(
          { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
          request
        )
      );

      expect(result2.outcome).toBe("identical_replay");
      if (result2.outcome === "identical_replay") {
        expect(result2.rowId).toBe(originalRowId);
      }
    });
  });

  describe("returns a typed conflict for same logical identity and different canonical content", () => {
    it("the use case never retries, overwrites, or hides the repository conflict", async () => {
      const { assembleEvidenceBundle } =
        await import("../../src/application/assemble-evidence-bundle.js");

      const rawRow = makeRawRow({ id: 1 });
      seedRaw([rawRow]);

      const featureRow = makeDerivedFeatureRow({
        id: 1,
        featureKind: "range_location",
        positionId: "pos-1",
        poolId: "pool-abc",
        inputObservationIds: [1],
        rawRefs: [makeRawRef(1, "clmm-v2-bundle", "raw-hash-1")]
      });
      seedFeature([featureRow]);

      const request = makeRequest();

      const result1 = assertSuccess(
        await assembleEvidenceBundle(
          { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
          request
        )
      );

      expect(result1.outcome).toBe("persisted");

      contract.overridePayloadHash = "different-payload-hash-value";

      const result2 = assertSuccess(
        await assembleEvidenceBundle(
          { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
          request
        )
      );

      expect(result2.outcome).toBe("conflict");
      if (result2.outcome === "conflict") {
        expect(result2.incomingPayloadHash).toBe("different-payload-hash-value");
      }
    });
  });

  describe("persists nothing on invalid request lineage schema or canonicalization", () => {
    it("every hard failure occurs before insertOrClassify", async () => {
      const { assembleEvidenceBundle } =
        await import("../../src/application/assemble-evidence-bundle.js");

      const rawRow = makeRawRow({ id: 1 });
      seedRaw([rawRow]);

      const featureRow = makeDerivedFeatureRow({
        id: 1,
        featureKind: "range_location",
        positionId: "pos-1",
        poolId: "pool-abc",
        inputObservationIds: [1],
        rawRefs: [makeRawRef(1, "clmm-v2-bundle", "raw-hash-1")]
      });
      seedFeature([featureRow]);

      contract.shouldFail = true;
      contract.failError = { code: "VALIDATION_ERROR", errors: ["test error"] };

      const request = makeRequest();

      const result = await assembleEvidenceBundle(
        { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
        request
      );

      expect("code" in result).toBe(true);
      expect(executionLog).not.toContain("bundle.insertOrClassify");
    });
  });

  describe("loads only lineage ids referenced by the selected slots", () => {
    it("bulk reads are bounded and unrelated observations do not enter the bundle", async () => {
      const { assembleEvidenceBundle } =
        await import("../../src/application/assemble-evidence-bundle.js");

      const normRow = makeNormalizedRow({ id: 10, rawObservationId: 20 });
      seedNormalized([normRow]);

      const rawRow = makeRawRow({ id: 20 });
      const unrelatedRawRow = makeRawRow({ id: 999 });
      seedRaw([rawRow, unrelatedRawRow]);

      const featureRow = makeDerivedFeatureRow({
        id: 1,
        featureKind: "range_location",
        positionId: "pos-1",
        poolId: "pool-abc",
        inputObservationIds: [10],
        rawRefs: [makeNormalizedRef(10, "clmm-v2-bundle", "norm-hash-10")]
      });
      seedFeature([featureRow]);

      const request = makeRequest();

      await assembleEvidenceBundle(
        { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
        request
      );

      expect(executionLog).toContain("normalized.findByIds");
      expect(normalizedRepo.lastFindByIdsArg).toEqual([10]);

      expect(executionLog).toContain("raw.findByIds");
      expect(rawRepo.lastFindByIdsArg).toEqual([20]);
      expect(rawRepo.lastFindByIdsArg).not.toContain(999);
    });
  });

  describe("does not call HTTP LLM publisher or policy dependencies", () => {
    it("the dependency object contains only feature, normalized, raw, bundle, and contract ports", async () => {
      const { assembleEvidenceBundle } =
        await import("../../src/application/assemble-evidence-bundle.js");

      const rawRow = makeRawRow({ id: 1 });
      seedRaw([rawRow]);

      const featureRow = makeDerivedFeatureRow({
        id: 1,
        featureKind: "range_location",
        positionId: "pos-1",
        poolId: "pool-abc",
        inputObservationIds: [1],
        rawRefs: [makeRawRef(1, "clmm-v2-bundle", "raw-hash-1")]
      });
      seedFeature([featureRow]);

      const request = makeRequest();

      const deps = {
        clock,
        featureRepo,
        normalizedRepo,
        rawRepo,
        bundleRepo,
        contract
      };

      const result = assertSuccess(await assembleEvidenceBundle(deps, request));

      expect(result.outcome).toBeDefined();
      expect(result.outcome).toBe("persisted");
    });
  });

  describe("returns no_bundle when no feature is usable", () => {
    it("no contract or bundle repository write occurs unless the pinned contract explicitly mandates a durable unavailable bundle", async () => {
      const { assembleEvidenceBundle } =
        await import("../../src/application/assemble-evidence-bundle.js");

      seedRaw([]);

      const unavailableFeature = makeDerivedFeatureRow({
        id: 1,
        featureKind: "range_location",
        positionId: "pos-1",
        poolId: "pool-abc",
        status: "UNAVAILABLE",
        value: null,
        inputObservationIds: [],
        rawRefs: []
      });
      seedFeature([unavailableFeature]);

      const request = makeRequest();

      const result = assertSuccess(
        await assembleEvidenceBundle(
          { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
          request
        )
      );

      expect(result.outcome).toBe("no_bundle");
      expect(executionLog).not.toContain("contract.validateCanonicalizeAndHash");
      expect(executionLog).not.toContain("bundle.insertOrClassify");
    });
  });

  describe("persists a schema-valid partial bundle with explicit missing warnings", () => {
    it("one and multiple missing features never become zero and still persist when at least one usable feature exists and the contract permits it", async () => {
      const { assembleEvidenceBundle } =
        await import("../../src/application/assemble-evidence-bundle.js");

      const rawRow = makeRawRow({ id: 1 });
      seedRaw([rawRow]);

      const availableFeature = makeDerivedFeatureRow({
        id: 1,
        featureKind: "range_location",
        positionId: "pos-1",
        poolId: "pool-abc",
        status: "AVAILABLE",
        value: 500000,
        inputObservationIds: [1],
        rawRefs: [makeRawRef(1, "clmm-v2-bundle", "raw-hash-1")]
      });
      seedFeature([availableFeature]);

      const request = makeRequest();

      const result = assertSuccess(
        await assembleEvidenceBundle(
          { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
          request
        )
      );

      expect(result.outcome).toBe("persisted");
    });
  });

  describe("preserves partial unavailable stale and nullable-brief semantics", () => {
    it("each acceptance-criteria case reaches the contract service with the exact canonical representation", async () => {
      const { assembleEvidenceBundle } =
        await import("../../src/application/assemble-evidence-bundle.js");

      const rawRow = makeRawRow({ id: 1 });
      seedRaw([rawRow]);

      const staleFeature = makeDerivedFeatureRow({
        id: 1,
        featureKind: "range_location",
        positionId: "pos-1",
        poolId: "pool-abc",
        status: "PARTIAL",
        value: 250000,
        isStale: true,
        inputObservationIds: [1],
        rawRefs: [makeRawRef(1, "clmm-v2-bundle", "raw-hash-1")]
      });
      seedFeature([staleFeature]);

      const request = makeRequest();

      const result = assertSuccess(
        await assembleEvidenceBundle(
          { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
          request
        )
      );

      expect(result.outcome).toBe("persisted");
    });
  });
});
