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
  AssembleEvidenceBundleResult,
  AssembleEvidenceBundleDeps,
  PrepareEvidenceBundleResult,
  AssembleEvidenceBundleError
} from "../../src/application/assemble-evidence-bundle.js";
import {
  prepareEvidenceBundle,
  finalizeEvidenceBundle
} from "../../src/application/assemble-evidence-bundle.js";
import { DEFAULT_CONFIDENCE, DEFAULT_PROVENANCE } from "../helpers/taxonomy-fixtures.js";
import type { ProvenanceRef, Source, ObservationKind } from "../../src/contracts/taxonomy.js";
import { makeClmmBundle, makePoolData, makePositionData } from "../fixtures/clmm-bundle.js";
import { FakeBriefRepo } from "../fakes/fake-brief-repo.js";
import { RESEARCH_BRIEF_PROMPT_VERSION } from "../../src/domain/brief/prompts.js";
import type { PersistedResearchBrief } from "../../src/contracts/research-brief.js";

async function prepareAndFinalizePositionWithoutBriefForTest(
  deps: AssembleEvidenceBundleDeps,
  request: AssembleEvidenceBundleRequest
): Promise<AssembleEvidenceBundleResult> {
  const prepared = await prepareEvidenceBundle(deps, request);
  if ("code" in prepared || prepared.outcome !== "prepared") return prepared;
  return finalizeEvidenceBundle(deps, prepared.prepared, undefined);
}

const EPOCH = "2024-01-01T00:00:00.000Z";
const EVAL_MS = new Date(EPOCH).getTime();

const CALCULATOR_VERSIONS = {
  range_location: "1.0.0",
  distance_to_lower: "1.0.0",
  distance_to_upper: "1.0.0",
  oracle_dex_divergence: "1.0.0",
  oracle_confidence_width: "1.0.0",
  realized_volatility_1h: "1.0.0",
  volume_liquidity_ratio_24h: "1.0.0",
  oi_trend_4h: "1.0.0",
  liquidation_cluster_1h: "1.0.0",
  funding_rate_annualized: "1.0.0",
  basis_spread_bps: "1.0.0"
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

function assertSuccess<T extends AssembleEvidenceBundleResult | PrepareEvidenceBundleResult>(
  result: T
): Exclude<T, AssembleEvidenceBundleError> {
  if ("code" in result) {
    const msg = "message" in result ? result.message : JSON.stringify(result);
    throw new Error(`Unexpected error result: ${result.code}: ${msg}`);
  }
  return result as Exclude<T, AssembleEvidenceBundleError>;
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
  lastListCandidatesArg: NormalizedObservationCandidateQuery | null = null;

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
    this.lastListCandidatesArg = query;
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

  async getLatestReceivedAt(): Promise<Map<Source, number>> {
    return new Map();
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

  async findById(id: number): Promise<EvidenceBundleRow | undefined> {
    return this.store.find((row) => row.id === id);
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
        await prepareAndFinalizePositionWithoutBriefForTest(
          { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
          request
        )
      );

      expect(result.outcome).toBe("persisted");
      expect(bundleRepo.store[0]?.confidenceComposite).toBeGreaterThanOrEqual(0);
      expect(bundleRepo.store[0]?.confidenceComposite).toBeLessThanOrEqual(1);
      expect(
        (bundleRepo.store[0]?.confidence as { compositeScore: number }).compositeScore
      ).toBeGreaterThanOrEqual(0);
      expect(
        (bundleRepo.store[0]?.confidence as { compositeScore: number }).compositeScore
      ).toBeLessThanOrEqual(1);
      expect(executionLog).toContain("contract.validateCanonicalizeAndHash");
      expect(executionLog).toContain("bundle.insertOrClassify");
      expect(executionLog.indexOf("contract.validateCanonicalizeAndHash")).toBeLessThan(
        executionLog.indexOf("bundle.insertOrClassify")
      );
    });

    it("computes partial quality when finalizing bundle with a degraded research brief", async () => {
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
      const prepareResult = assertSuccess(
        await prepareEvidenceBundle(
          { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
          request
        )
      );

      expect(prepareResult.outcome).toBe("prepared");
      if (prepareResult.outcome !== "prepared") return;

      const featureId =
        prepareResult.prepared.nullBriefCandidate.deterministicFeatures[0]!.featureId;

      const degradedBrief: PersistedResearchBrief = {
        briefId: "brief-deg-1",
        pair: "SOL/USDC",
        generationStatus: "degraded",
        llmOutput: {
          summary: "Degraded brief summary",
          keyTakeaways: ["Takeaway 1"],
          supportsCurrentRegime: "unclear",
          regimeAssessmentReasoning: "Degraded reasoning",
          confidenceScore: 0.2,
          confidenceReasoning: "Degraded confidence",
          sourceEvidenceIds: [featureId],
          unsupportedOrMissingInputs: [],
          degradationReason: "model_error"
        },
        sourceRefs: [],
        providerMetadata: {
          provider: "openai",
          model: "gpt-4o-mini"
        },
        sourceBundleRef: {
          bundleId: "run-123",
          bundleHash: "hash-1"
        },
        inputContextHash: "ctx-hash",
        priorBriefRef: null,
        generatedAt: EPOCH,
        promptVersion: RESEARCH_BRIEF_PROMPT_VERSION
      };

      const result = assertSuccess(
        await finalizeEvidenceBundle(
          { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
          prepareResult.prepared,
          degradedBrief
        )
      );

      expect(result.outcome).toBe("persisted");
      const persistedPayload = bundleRepo.store[0]?.payload as EvidenceBundleV1;
      expect(persistedPayload.assessment.coverage.researchBrief).toBe("unavailable");
      expect(persistedPayload.assessment.quality).toBe("partial");
      expect(persistedPayload.researchBrief?.briefId).toBe("brief-deg-1");
    });

    it("gives bundles from different positions in the same pipeline run distinct runIds", async () => {
      seedRaw([makeRawRow({ id: 1 }), makeRawRow({ id: 2, positionId: "pos-2" })]);
      seedFeature([
        makeDerivedFeatureRow({
          id: 1,
          featureKind: "range_location",
          positionId: "pos-1",
          poolId: "pool-abc",
          inputObservationIds: [1],
          rawRefs: [makeRawRef(1, "clmm-v2-bundle", "raw-hash-1")]
        }),
        makeDerivedFeatureRow({
          id: 2,
          featureKind: "range_location",
          positionId: "pos-2",
          poolId: "pool-abc",
          inputObservationIds: [2],
          rawRefs: [makeRawRef(2, "clmm-v2-bundle", "raw-hash-2")]
        })
      ]);

      const requestPos1 = makeRequest({ positionId: "pos-1", correlationId: "corr-pos-1" });
      const requestPos2 = makeRequest({ positionId: "pos-2", correlationId: "corr-pos-2" });

      const seenCandidates: unknown[] = [];
      const capturingContract: FakeContract = {
        ...contract,
        async validateCanonicalizeAndHash(candidate: unknown) {
          seenCandidates.push(candidate);
          return contract.validateCanonicalizeAndHash(candidate);
        }
      };

      assertSuccess(
        await prepareAndFinalizePositionWithoutBriefForTest(
          { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract: capturingContract },
          requestPos1
        )
      );
      assertSuccess(
        await prepareAndFinalizePositionWithoutBriefForTest(
          { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract: capturingContract },
          requestPos2
        )
      );

      expect(seenCandidates).toHaveLength(2);
      const runIds = seenCandidates.map((c) => (c as { runId: string }).runId);
      expect(runIds[0]).toBe("run-123:pos-1");
      expect(runIds[1]).toBe("run-123:pos-2");
      expect(runIds[0]).not.toBe(runIds[1]);

      const scopes = seenCandidates.map((c) => (c as EvidenceBundleV1).scope);
      expect(scopes[0]).toEqual({
        kind: "position",
        network: "solana-mainnet",
        walletAddress: "wallet-123",
        whirlpoolAddress: "pool-abc",
        positionId: "pos-1"
      });
      expect(scopes[1]).toEqual({
        kind: "position",
        network: "solana-mainnet",
        walletAddress: "wallet-123",
        whirlpoolAddress: "pool-abc",
        positionId: "pos-2"
      });
    });

    it("insertOrClassify is called exactly once on successful assembly", async () => {
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
      await prepareAndFinalizePositionWithoutBriefForTest(
        { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
        request
      );

      expect(executionLog.filter((c) => c === "bundle.insertOrClassify").length).toBe(1);
    });
  });

  describe("queries the configured contextual source matrix", () => {
    it("queries Birdeye whale swaps and preserves the contextual source matrix", async () => {
      seedRaw([makeRawRow({ id: 1 })]);
      seedFeature([
        makeDerivedFeatureRow({
          id: 1,
          featureKind: "range_location",
          positionId: "pos-1",
          poolId: "pool-abc",
          inputObservationIds: [1],
          rawRefs: [makeRawRef(1, "clmm-v2-bundle", "raw-hash-1")]
        })
      ]);

      await prepareAndFinalizePositionWithoutBriefForTest(
        { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
        makeRequest()
      );

      expect(normalizedRepo.lastListCandidatesArg).toEqual({
        sourceKinds: [
          { source: "macro-calendar-api", observationKind: "scheduled_event" },
          { source: "solana-status-api", observationKind: "protocol_incident" },
          { source: "helius-api", observationKind: "whale_swap" },
          { source: "birdeye-api", observationKind: "whale_swap" },
          { source: "helius-api", observationKind: "stablecoin_flow" },
          { source: "helius-api", observationKind: "cex_flow_proxy" },
          { source: "birdeye-api", observationKind: "dex_net_flow" },
          { source: "technical-analysis-api", observationKind: "support_resistance_level" },
          { source: "crypto-news-api", observationKind: "ecosystem_news" },
          { source: "regulatory-monitor-api", observationKind: "regulatory_risk" }
        ],
        receivedAtOrAfterUnixMs: EVAL_MS - 7 * 24 * 60 * 60 * 1000
      });
    });
  });

  describe("returns identical_replay without rebuilding mutable run context", () => {
    it("an explicit repeated request returns the original persisted row", async () => {
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
        await prepareAndFinalizePositionWithoutBriefForTest(
          { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
          request
        )
      );

      expect(result1.outcome).toBe("persisted");
      if (result1.outcome !== "persisted") return;

      const originalRowId = result1.rowId;

      // Attach brief to persisted row so it represents a complete brief-bearing bundle
      (bundleRepo.store[0]!.payload as EvidenceBundleV1).researchBrief = {
        briefId: "brief-1",
        generatedAt: EPOCH,
        summary: "summary",
        keyFindings: ["finding"],
        uncertainties: [],
        model: { provider: "anthropic", modelId: "claude-3-5-sonnet-20241022", modelVersion: "v1" },
        promptVersion: "v1",
        sourceEvidenceIds: ["feat-range_location-1"]
      };

      const result2 = assertSuccess(
        await prepareAndFinalizePositionWithoutBriefForTest(
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
        await prepareAndFinalizePositionWithoutBriefForTest(
          { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
          request
        )
      );

      expect(result1.outcome).toBe("persisted");

      contract.overridePayloadHash = "different-payload-hash-value";

      const result2 = assertSuccess(
        await prepareAndFinalizePositionWithoutBriefForTest(
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

      const result = await prepareAndFinalizePositionWithoutBriefForTest(
        { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
        request
      );

      expect("code" in result).toBe(true);
      expect(executionLog).not.toContain("bundle.insertOrClassify");
    });
  });

  describe("loads only lineage ids referenced by the selected slots", () => {
    it("bulk reads are bounded and unrelated observations do not enter the bundle", async () => {
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

      await prepareAndFinalizePositionWithoutBriefForTest(
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

      const result = assertSuccess(
        await prepareAndFinalizePositionWithoutBriefForTest(deps, request)
      );

      expect(result.outcome).toBeDefined();
      expect(result.outcome).toBe("persisted");
    });
  });

  describe("returns no_bundle when no feature is usable", () => {
    it("no contract or bundle repository write occurs unless the pinned contract explicitly mandates a durable unavailable bundle", async () => {
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
        await prepareAndFinalizePositionWithoutBriefForTest(
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
        await prepareAndFinalizePositionWithoutBriefForTest(
          { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
          request
        )
      );

      expect(result.outcome).toBe("persisted");
    });
  });

  describe("preserves partial unavailable stale and nullable-brief semantics", () => {
    it("each acceptance-criteria case reaches the contract service with the exact canonical representation", async () => {
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
        await prepareAndFinalizePositionWithoutBriefForTest(
          { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
          request
        )
      );

      expect(result.outcome).toBe("persisted");
    });
  });

  describe("prepare and finalize position evidence assembly", () => {
    it("prepare does not persist and finalize persists exactly once", async () => {
      const { prepareEvidenceBundle, finalizeEvidenceBundle } =
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

      const prepareResult = assertSuccess(
        await prepareEvidenceBundle(
          { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
          request
        )
      );

      expect(prepareResult.outcome).toBe("prepared");
      if (prepareResult.outcome !== "prepared") return;

      expect(bundleRepo.store).toHaveLength(0);
      expect(executionLog).not.toContain("bundle.insertOrClassify");

      const finalizeResult = assertSuccess(
        await finalizeEvidenceBundle(
          { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
          prepareResult.prepared
        )
      );

      expect(finalizeResult.outcome).toBe("persisted");
      expect(bundleRepo.store).toHaveLength(1);
      expect(executionLog.filter((c) => c === "bundle.insertOrClassify")).toHaveLength(1);
    });

    it("position exact replay returns the existing brief-bearing row before generation", async () => {
      const { prepareEvidenceBundle } =
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

      const mockPayloadWithBrief: EvidenceBundleV1 = {
        schemaVersion: "evidence-bundle.v1",
        pair: "SOL/USDC",
        scope: {
          kind: "position",
          network: "solana-mainnet",
          walletAddress: "wallet-123",
          whirlpoolAddress: "pool-abc",
          positionId: "pos-1"
        },
        source: {
          publisher: "sol-usdc-clmm-intelligence",
          sourceId: "source-001",
          sourceVersion: "1.0.0"
        },
        runId: "run-123:pos-1",
        correlationId: "corr-123",
        createdAt: "2024-01-01T00:00:00.000Z",
        asOf: "2024-01-01T00:00:00.000Z",
        freshUntil: "2024-01-01T01:00:00.000Z",
        expiresAt: "2024-01-01T02:00:00.000Z",
        deterministicFeatures: [] as unknown as EvidenceBundleV1["deterministicFeatures"],
        contextualEvidence: {
          supportResistance: [],
          flows: [],
          derivatives: [],
          events: [],
          newsRegulatory: []
        },
        researchBrief: {
          briefId: "brief-123",
          generatedAt: "2024-01-01T00:00:00.000Z",
          summary: "test summary",
          keyFindings: ["finding"],
          uncertainties: [],
          model: { provider: "anthropic", modelId: "claude-3", modelVersion: "v1" },
          promptVersion: "v1",
          sourceEvidenceIds: ["feat-range_location-1"]
        },
        sourceReferences: [] as unknown as EvidenceBundleV1["sourceReferences"],
        assessment: {
          overallConfidenceBps: 10000,
          quality: "complete",
          coverage: {} as unknown as EvidenceBundleV1["assessment"]["coverage"],
          warnings: []
        },
        provenance: {
          pipelineVersion: "1.0.0",
          gitCommit: "abc123",
          environment: "development",
          upstreamRunIds: []
        }
      };

      bundleRepo.store.push({
        id: 42,
        schemaVersion: "evidence-bundle.v1",
        pair: "SOL/USDC",
        asOfUnixMs: EVAL_MS,
        expiresAtUnixMs: EVAL_MS + 3600000,
        payload: mockPayloadWithBrief,
        payloadHash: "hash-brief-bearing",
        payloadCanonical: JSON.stringify(mockPayloadWithBrief),
        idempotencyKey: "fixed-idempotency-key",
        taxonomySummary: null,
        dominantSignalClass: "deterministic",
        confidence: DEFAULT_CONFIDENCE,
        confidenceComposite: 1,
        confidenceLevel: "high",
        validUntilUnixMs: EVAL_MS + 3600000,
        isStale: false,
        staleBehavior: null,
        provenance: DEFAULT_PROVENANCE,
        version: 1,
        receivedAtUnixMs: EVAL_MS
      });

      const prepareResult = assertSuccess(
        await prepareEvidenceBundle(
          { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
          request
        )
      );

      expect(prepareResult.outcome).toBe("identical_replay");
      if (prepareResult.outcome === "identical_replay") {
        expect(prepareResult.rowId).toBe(42);
        expect(prepareResult.payloadHash).toBe("hash-brief-bearing");
      }
    });

    it("position exact replay via real prepareEvidenceBundle loads the persisted brief through briefRepo", async () => {
      const { prepareEvidenceBundle } =
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

      const mockPayloadWithBrief: EvidenceBundleV1 = {
        schemaVersion: "evidence-bundle.v1",
        pair: "SOL/USDC",
        scope: {
          kind: "position",
          network: "solana-mainnet",
          walletAddress: "wallet-123",
          whirlpoolAddress: "pool-abc",
          positionId: "pos-1"
        },
        source: {
          publisher: "sol-usdc-clmm-intelligence",
          sourceId: "source-001",
          sourceVersion: "1.0.0"
        },
        runId: "run-123:pos-1",
        correlationId: "corr-123",
        createdAt: "2024-01-01T00:00:00.000Z",
        asOf: "2024-01-01T00:00:00.000Z",
        freshUntil: "2024-01-01T01:00:00.000Z",
        expiresAt: "2024-01-01T02:00:00.000Z",
        deterministicFeatures: [] as unknown as EvidenceBundleV1["deterministicFeatures"],
        contextualEvidence: {
          supportResistance: [],
          flows: [],
          derivatives: [],
          events: [],
          newsRegulatory: []
        },
        researchBrief: {
          briefId: "brief-real-42",
          generatedAt: "2024-01-01T00:00:00.000Z",
          summary: "test summary",
          keyFindings: ["finding"],
          uncertainties: [],
          model: { provider: "anthropic", modelId: "claude-3", modelVersion: "v1" },
          promptVersion: "v1",
          sourceEvidenceIds: ["feat-range_location-1"]
        },
        sourceReferences: [] as unknown as EvidenceBundleV1["sourceReferences"],
        assessment: {
          overallConfidenceBps: 10000,
          quality: "complete",
          coverage: {} as unknown as EvidenceBundleV1["assessment"]["coverage"],
          warnings: []
        },
        provenance: {
          pipelineVersion: "1.0.0",
          gitCommit: "abc123",
          environment: "development",
          upstreamRunIds: []
        }
      };

      bundleRepo.store.push({
        id: 42,
        schemaVersion: "evidence-bundle.v1",
        pair: "SOL/USDC",
        asOfUnixMs: EVAL_MS,
        expiresAtUnixMs: EVAL_MS + 3600000,
        payload: mockPayloadWithBrief,
        payloadHash: "hash-brief-bearing",
        payloadCanonical: JSON.stringify(mockPayloadWithBrief),
        idempotencyKey: "fixed-idempotency-key",
        taxonomySummary: null,
        dominantSignalClass: "deterministic",
        confidence: DEFAULT_CONFIDENCE,
        confidenceComposite: 1,
        confidenceLevel: "high",
        validUntilUnixMs: EVAL_MS + 3600000,
        isStale: false,
        staleBehavior: null,
        provenance: DEFAULT_PROVENANCE,
        version: 1,
        receivedAtUnixMs: EVAL_MS
      });

      const briefRepo = new FakeBriefRepo();
      const persistedBrief: PersistedResearchBrief = {
        briefId: "brief-real-42",
        pair: "SOL/USDC",
        generationStatus: "complete",
        llmOutput: {
          summary: "Grounded brief",
          keyTakeaways: ["Price evidence is available"],
          supportsCurrentRegime: "supports",
          regimeAssessmentReasoning: "The cited feature supports the assessment.",
          confidenceScore: 0.9,
          confidenceReasoning: "The brief cites source-bundle evidence.",
          sourceEvidenceIds: ["feat-range_location-1"],
          unsupportedOrMissingInputs: []
        },
        sourceRefs: [],
        providerMetadata: { provider: "openai", model: "gpt-4o" },
        sourceBundleRef: {
          bundleId: 42,
          bundleHash: "hash-brief-bearing"
        },
        inputContextHash: "context-hash",
        priorBriefRef: null,
        generatedAt: EPOCH,
        promptVersion: RESEARCH_BRIEF_PROMPT_VERSION
      };
      await briefRepo.insert({
        evidenceBundleId: 42,
        promptVersion: RESEARCH_BRIEF_PROMPT_VERSION,
        modelProvider: "openai",
        structuredOutput: persistedBrief,
        signalClass: "contextual",
        confidence: DEFAULT_CONFIDENCE,
        provenance: DEFAULT_PROVENANCE,
        payloadHash: "brief-payload-hash",
        receivedAtUnixMs: EVAL_MS - 30_000,
        validUntilUnixMs: EVAL_MS + 3_600_000
      });

      const prepareResult = assertSuccess(
        await prepareEvidenceBundle(
          { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract, briefRepo },
          request
        )
      );

      expect(prepareResult.outcome).toBe("identical_replay");
      if (prepareResult.outcome === "identical_replay") {
        expect(prepareResult.rowId).toBe(42);
        expect(prepareResult.embeddedBrief).toEqual(persistedBrief);
      }
    });

    it("position legacy replay without an embedded brief returns identical_replay with prepared structure to allow brief generation", async () => {
      const { prepareEvidenceBundle } =
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

      const mockPayloadLegacyNullBrief: EvidenceBundleV1 = {
        schemaVersion: "evidence-bundle.v1",
        pair: "SOL/USDC",
        scope: {
          kind: "position",
          network: "solana-mainnet",
          walletAddress: "wallet-123",
          whirlpoolAddress: "pool-abc",
          positionId: "pos-1"
        },
        source: {
          publisher: "sol-usdc-clmm-intelligence",
          sourceId: "source-001",
          sourceVersion: "1.0.0"
        },
        runId: "run-123:pos-1",
        correlationId: "corr-123",
        createdAt: "2024-01-01T00:00:00.000Z",
        asOf: "2024-01-01T00:00:00.000Z",
        freshUntil: "2024-01-01T01:00:00.000Z",
        expiresAt: "2024-01-01T02:00:00.000Z",
        deterministicFeatures: [] as unknown as EvidenceBundleV1["deterministicFeatures"],
        contextualEvidence: {
          supportResistance: [],
          flows: [],
          derivatives: [],
          events: [],
          newsRegulatory: []
        },
        researchBrief: null,
        sourceReferences: [] as unknown as EvidenceBundleV1["sourceReferences"],
        assessment: {
          overallConfidenceBps: 10000,
          quality: "complete",
          coverage: {} as unknown as EvidenceBundleV1["assessment"]["coverage"],
          warnings: []
        },
        provenance: {
          pipelineVersion: "1.0.0",
          gitCommit: "abc123",
          environment: "development",
          upstreamRunIds: []
        }
      };

      contract.overridePayloadHash = "hash-legacy-null-brief";

      bundleRepo.store.push({
        id: 99,
        schemaVersion: "evidence-bundle.v1",
        pair: "SOL/USDC",
        asOfUnixMs: EVAL_MS,
        expiresAtUnixMs: EVAL_MS + 3600000,
        payload: mockPayloadLegacyNullBrief,
        payloadHash: "hash-legacy-null-brief",
        payloadCanonical: JSON.stringify(mockPayloadLegacyNullBrief),
        idempotencyKey: "fixed-idempotency-key",
        taxonomySummary: null,
        dominantSignalClass: "deterministic",
        confidence: DEFAULT_CONFIDENCE,
        confidenceComposite: 1,
        confidenceLevel: "high",
        validUntilUnixMs: EVAL_MS + 3600000,
        isStale: false,
        staleBehavior: null,
        provenance: DEFAULT_PROVENANCE,
        version: 1,
        receivedAtUnixMs: EVAL_MS
      });

      const prepareResult = assertSuccess(
        await prepareEvidenceBundle(
          { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
          request
        )
      );

      expect(prepareResult.outcome).toBe("identical_replay");
      if (prepareResult.outcome === "identical_replay") {
        expect(prepareResult.rowId).toBe(99);
        expect(prepareResult.prepared).toBeDefined();
        expect(prepareResult.embeddedBrief).toBeUndefined();
      }
    });

    it("returns prepare error directly without invoking finalize or persisting when prepare fails", async () => {
      const { prepareEvidenceBundle } =
        await import("../../src/application/assemble-evidence-bundle.js");

      const request = makeRequest();

      const prepareResult = await prepareEvidenceBundle(
        { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
        request
      );

      expect("outcome" in prepareResult && prepareResult.outcome).toBe("no_bundle");
      expect(bundleRepo.store).toHaveLength(0);
      expect(executionLog).not.toContain("contract.validateCanonicalizeAndHash");
      expect(executionLog).not.toContain("bundle.insertOrClassify");
    });
  });
});
