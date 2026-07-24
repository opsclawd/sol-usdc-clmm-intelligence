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
  RawObservationInsert,
  NormalizedObservationCandidateQuery
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
import { makeClmmBundle, makePoolData, makePositionData } from "../fixtures/clmm-bundle.js";
import {
  makeScheduledEventPayload,
  makeProtocolIncidentPayload
} from "../fixtures/context-events.js";

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
    confidence: overrides.confidence ?? DEFAULT_CONFIDENCE,
    confidenceComposite: 1,
    confidenceLevel: "high",
    validUntilUnixMs: EVAL_MS + 3600000,
    isStale: false,
    staleBehavior: null,
    provenance: DEFAULT_PROVENANCE,
    receivedAtUnixMs: overrides.receivedAtUnixMs ?? EVAL_MS - 60000
  };
}

function makeRawRow(
  overrides: Partial<RawObservationRow> & {
    id: number;
    poolId?: string;
    positionId?: string;
    walletId?: string;
  }
): RawObservationRow {
  const poolId = overrides.poolId ?? "pool-abc";
  const positionId = overrides.positionId ?? "pos-1";
  const walletId = overrides.walletId ?? "wallet-123";

  return {
    id: overrides.id,
    source: overrides.source ?? "clmm-v2-bundle",
    sourceObservationKey: `key-${overrides.id}`,
    observedAtUnixMs: overrides.observedAtUnixMs ?? EVAL_MS - 70000,
    fetchedAtUnixMs: overrides.fetchedAtUnixMs ?? EVAL_MS - 65000,
    payloadHash: `raw-hash-${overrides.id}`,
    payloadCanonical:
      overrides.payloadCanonical ??
      JSON.stringify(
        makeClmmBundle({
          pool: makePoolData({ poolId }),
          positions: [
            makePositionData({
              walletId,
              positionId,
              poolId
            })
          ],
          alerts: []
        })
      ),
    parseStatus: "parsed",
    sourceRequestMeta: null,
    receivedAtUnixMs: overrides.receivedAtUnixMs ?? EVAL_MS - 60000
  };
}

function assertSuccess(result: AssembleEvidenceBundleResult): AssembleEvidenceBundleSuccess {
  if ("code" in result) {
    const msg = "message" in result ? result.message : JSON.stringify(result);
    throw new Error(`Unexpected error result: ${result.code}: ${msg}`);
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
  lastListCandidatesQuery: NormalizedObservationCandidateQuery | null = null;
  shouldFailListCandidates: boolean = false;
  listCandidatesError: Error = new Error("listCandidates failed");

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

  async listCandidates(
    query: NormalizedObservationCandidateQuery
  ): Promise<NormalizedObservationRow[]> {
    this.executionLog.push("normalized.listCandidates");
    this.lastListCandidatesQuery = query;
    if (this.shouldFailListCandidates) {
      throw this.listCandidatesError;
    }
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

describe("assembleEvidenceBundle with contextual events", () => {
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

  describe("normalizedRepo.listCandidates is called with correct query", () => {
    it("requests exactly macro-calendar-api scheduled_event and solana-status-api protocol_incident", async () => {
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

      const scheduledPayload = makeScheduledEventPayload({ status: "SCHEDULED" });
      const scheduledNormRow = makeNormalizedRow({
        id: 100,
        source: "macro-calendar-api",
        observationKind: "scheduled_event",
        rawObservationId: 200,
        payload: scheduledPayload
      });

      const incidentPayload = makeProtocolIncidentPayload({ status: "RESOLVED" });
      const incidentNormRow = makeNormalizedRow({
        id: 101,
        source: "solana-status-api",
        observationKind: "protocol_incident",
        rawObservationId: 201,
        payload: incidentPayload
      });

      const scheduledRawRow = makeRawRow({ id: 200, source: "macro-calendar-api" });
      const incidentRawRow = makeRawRow({ id: 201, source: "solana-status-api" });
      seedNormalized([scheduledNormRow, incidentNormRow]);
      seedRaw([scheduledRawRow, incidentRawRow]);

      const request = makeRequest();
      await assembleEvidenceBundle(
        { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
        request
      );

      expect(normalizedRepo.lastListCandidatesQuery).not.toBeNull();
      const query = normalizedRepo.lastListCandidatesQuery!;
      expect(query.sourceKinds).toHaveLength(2);
      expect(query.sourceKinds).toContainEqual({
        source: "macro-calendar-api",
        observationKind: "scheduled_event"
      });
      expect(query.sourceKinds).toContainEqual({
        source: "solana-status-api",
        observationKind: "protocol_incident"
      });
    });

    it("requests receivedAtOrAfterUnixMs as evaluationTimeUnixMs minus 7 days", async () => {
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

      const request = makeRequest({ evaluationTimeUnixMs: EVAL_MS });
      await assembleEvidenceBundle(
        { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
        request
      );

      expect(normalizedRepo.lastListCandidatesQuery).not.toBeNull();
      const query = normalizedRepo.lastListCandidatesQuery!;
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(query.receivedAtOrAfterUnixMs).toBe(EVAL_MS - sevenDaysMs);
    });
  });

  describe("contextual raw/normalized rows are loaded into lineage", () => {
    it("contextual normalized observations are included in lineage before contract validation", async () => {
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

      const scheduledPayload = makeScheduledEventPayload({ status: "SCHEDULED" });
      const scheduledNormRow = makeNormalizedRow({
        id: 100,
        source: "macro-calendar-api",
        observationKind: "scheduled_event",
        rawObservationId: 200,
        payload: scheduledPayload
      });

      const scheduledRawRow = makeRawRow({ id: 200, source: "macro-calendar-api" });
      seedNormalized([scheduledNormRow]);
      seedRaw([scheduledRawRow]);

      const request = makeRequest();
      const result = assertSuccess(
        await assembleEvidenceBundle(
          { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
          request
        )
      );

      expect(result.outcome).toBe("persisted");
      expect(executionLog.indexOf("normalized.listCandidates")).toBeLessThan(
        executionLog.indexOf("contract.validateCanonicalizeAndHash")
      );
    });
  });

  describe("context supplement only", () => {
    it("does not emit a bundle from contextual events alone", async () => {
      const { assembleEvidenceBundle } =
        await import("../../src/application/assemble-evidence-bundle.js");

      seedRaw([]);

      const scheduledPayload = makeScheduledEventPayload({ status: "SCHEDULED" });
      const scheduledNormRow = makeNormalizedRow({
        id: 100,
        source: "macro-calendar-api",
        observationKind: "scheduled_event",
        rawObservationId: 200,
        payload: scheduledPayload
      });

      const scheduledRawRow = makeRawRow({ id: 200, source: "macro-calendar-api" });
      seedNormalized([scheduledNormRow]);
      seedRaw([scheduledRawRow]);

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

  describe("query degradation", () => {
    it("degrades contextual query failure to an empty event list", async () => {
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

      normalizedRepo.shouldFailListCandidates = true;

      const request = makeRequest();
      const result = assertSuccess(
        await assembleEvidenceBundle(
          { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
          request
        )
      );

      expect(result.outcome).toBe("persisted");
      expect((result as { warnings: readonly string[] }).warnings.length).toBeGreaterThan(0);
    });
  });
});
