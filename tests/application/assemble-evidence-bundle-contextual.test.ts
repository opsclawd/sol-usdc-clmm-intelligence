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
import {
  prepareEvidenceBundle,
  finalizeEvidenceBundle,
  type AssembleEvidenceBundleDeps,
  type AssembleEvidenceBundleRequest,
  type AssembleEvidenceBundleResult,
  type PrepareEvidenceBundleResult,
  type AssembleEvidenceBundleError
} from "../../src/application/assemble-evidence-bundle.js";
import { DEFAULT_CONFIDENCE, DEFAULT_PROVENANCE } from "../helpers/taxonomy-fixtures.js";

async function assembleEvidenceBundle(
  deps: AssembleEvidenceBundleDeps,
  request: AssembleEvidenceBundleRequest
): Promise<AssembleEvidenceBundleResult> {
  const prepared = await prepareEvidenceBundle(deps, request);
  if ("code" in prepared || prepared.outcome !== "prepared") return prepared;
  return finalizeEvidenceBundle(deps, prepared.prepared, undefined);
}
import type { ProvenanceRef, Source } from "../../src/contracts/taxonomy.js";
import { makeClmmBundle, makePoolData, makePositionData } from "../fixtures/clmm-bundle.js";
import type { SupportResistancePayloadV1 } from "../../src/contracts/support-resistance.js";
import type { NewsPayloadV1, RegulatoryPayloadV1 } from "../../src/contracts/news-events.js";
import type { PersistedResearchBrief } from "../../src/contracts/research-brief.js";

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
    sourceObservationKey: overrides.sourceObservationKey ?? `key-${overrides.id}`,
    observedAtUnixMs: overrides.observedAtUnixMs ?? EVAL_MS - 70000,
    fetchedAtUnixMs: overrides.fetchedAtUnixMs ?? EVAL_MS - 65000,
    payloadHash: overrides.payloadHash ?? `raw-hash-${overrides.id}`,
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
    parseStatus: overrides.parseStatus ?? "parsed",
    sourceRequestMeta: null,
    receivedAtUnixMs: overrides.receivedAtUnixMs ?? EVAL_MS - 60000
  };
}

function makeSupportResistancePayload(
  overrides?: Partial<SupportResistancePayloadV1>
): SupportResistancePayloadV1 {
  const base = {
    kind: "support_resistance_level" as const,
    schemaVersion: 1 as const,
    pair: "SOL/USDC" as const,
    unit: "USDC_PER_SOL" as const,
    evidenceSide: "SUPPORT" as const,
    timeframe: "4h",
    levelType: "point" as const,
    levelUsdcPerSol: 120.5,
    thesisCodes: ["MAJOR_SWING_LOW"],
    invalidationConditions: [],
    warnings: [],
    sourceReferences: [],
    sourceQuality: {
      providerId: "technical-analysis-api",
      reliability: 0.9,
      completeness: "complete" as const
    },
    asOfUnixMs: EVAL_MS - 3600000,
    expiresAtUnixMs: EVAL_MS + 86400000
  };
  return { ...base, ...overrides } as SupportResistancePayloadV1;
}

function makeNewsPayload(overrides?: Partial<NewsPayloadV1>): NewsPayloadV1 {
  return {
    evidenceKind: "ecosystem_news",
    articleId: "art-1",
    sourceVersionId: "v1",
    correctsSourceVersionId: null,
    clusterId: "cls-1",
    title: "Solana DeFi Growth",
    factualSummary: "DeFi TVL increases on Solana",
    extractedClaims: ["Solana TVL grew by 20%"],
    topicTags: ["defi", "solana"],
    publishedAtUnixMs: EVAL_MS - 3600000,
    sourceUpdatedAtUnixMs: null,
    retrievedAtUnixMs: EVAL_MS - 3600000,
    asOfUnixMs: EVAL_MS - 3600000,
    expiresAtUnixMs: EVAL_MS + 86400000,
    publisher: {
      publisherId: "pub-1",
      displayName: "Crypto News",
      tier: "official"
    },
    sourceQuality: {
      providerId: "crypto-news-api",
      reliability: 0.9,
      completeness: "complete",
      confirmation: "confirmed",
      isPaywalled: false
    },
    corroborationState: "single_source",
    originatingReportId: "rep-1",
    syndicationId: null,
    affectedAssets: ["SOL"],
    affectedProtocols: [],
    affectedJurisdictions: [],
    sourceReferences: ["https://cryptonews.com/1"],
    rawProvenance: {
      retrievedAtUnixMs: EVAL_MS - 3600000,
      license: "MIT",
      retentionMode: "bounded_factual_extract",
      robotsCompliance: true,
      termsAccepted: true
    },
    warnings: [],
    ...overrides
  };
}

function makeRegulatoryPayload(overrides?: Partial<RegulatoryPayloadV1>): RegulatoryPayloadV1 {
  return {
    evidenceKind: "regulatory_risk",
    articleId: "reg-1",
    sourceVersionId: "v1",
    correctsSourceVersionId: null,
    clusterId: "cls-reg-1",
    title: "SEC Statement on Crypto",
    factualSummary: "SEC issues new guidance",
    extractedClaims: ["New compliance guidelines released"],
    topicTags: ["regulation", "sec"],
    publishedAtUnixMs: EVAL_MS - 3600000,
    sourceUpdatedAtUnixMs: null,
    retrievedAtUnixMs: EVAL_MS - 3600000,
    asOfUnixMs: EVAL_MS - 3600000,
    expiresAtUnixMs: EVAL_MS + 86400000,
    publisher: {
      publisherId: "pub-reg",
      displayName: "Regulatory Monitor",
      tier: "official"
    },
    sourceQuality: {
      providerId: "regulatory-monitor-api",
      reliability: 0.95,
      completeness: "complete",
      confirmation: "confirmed",
      isPaywalled: false
    },
    corroborationState: "single_source",
    originatingReportId: "rep-reg-1",
    syndicationId: null,
    affectedAssets: ["SOL", "USDC"],
    affectedProtocols: [],
    affectedJurisdictions: ["US"],
    sourceReferences: ["https://sec.gov/news/1"],
    rawProvenance: {
      retrievedAtUnixMs: EVAL_MS - 3600000,
      license: "Public",
      retentionMode: "bounded_factual_extract",
      robotsCompliance: true,
      termsAccepted: true
    },
    warnings: [],
    ...overrides
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

async function prepareAndFinalizePositionWithoutBriefForTest(
  deps: AssembleEvidenceBundleDeps,
  request: AssembleEvidenceBundleRequest
): Promise<AssembleEvidenceBundleResult> {
  const prepared = await prepareEvidenceBundle(deps, request);
  if ("code" in prepared || prepared.outcome !== "prepared") return prepared;
  return finalizeEvidenceBundle(deps, prepared.prepared, undefined);
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
    const results = await this.insertMany([row]);
    return results[0]!;
  }
  async insertMany(rows: readonly DerivedFeatureInsert[]): Promise<DerivedFeatureRow[]> {
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
    return this.store
      .filter(
        (r) =>
          query.featureKinds.includes(r.featureKind) &&
          r.pair === query.pair &&
          r.asOfUnixMs >= query.asOfAtOrAfterUnixMs &&
          r.asOfUnixMs <= query.asOfAtOrBeforeUnixMs &&
          r.receivedAtUnixMs <= query.receivedAtOrBeforeUnixMs
      )
      .sort((a, b) => b.asOfUnixMs - a.asOfUnixMs);
  }
}

class FakeNormalizedRepo implements NormalizedObservationRepo {
  store: NormalizedObservationRow[] = [];
  shouldFailListCandidates = false;
  lastListCandidatesArg: NormalizedObservationCandidateQuery | null = null;
  lastFindByIdsArg: number[] = [];

  constructor(private executionLog: string[]) {}
  async insert(row: NormalizedObservationInsert): Promise<NormalizedObservationRow> {
    return row as NormalizedObservationRow;
  }
  async insertMany(
    rows: readonly NormalizedObservationInsert[]
  ): Promise<NormalizedObservationRow[]> {
    return rows.map((r) => r as NormalizedObservationRow);
  }
  async findBySource(
    source: Source,
    observationKind: NormalizedObservationRow["observationKind"],
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
    observationKind: NormalizedObservationRow["observationKind"]
  ): Promise<NormalizedObservationRow[]> {
    return this.store.filter(
      (r) => r.source === source && r.observationKind === observationKind && !r.isStale
    );
  }
  async findLatestByKind(
    source: Source,
    observationKind: NormalizedObservationRow["observationKind"]
  ): Promise<NormalizedObservationRow | null> {
    const matches = this.store.filter(
      (r) => r.source === source && r.observationKind === observationKind
    );
    return matches.length > 0 ? matches[matches.length - 1]! : null;
  }
  async findByRawObservation(
    rawObservationId: number,
    observationKind: NormalizedObservationRow["observationKind"]
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
    if (this.shouldFailListCandidates) {
      throw new Error("Failed to query normalized candidates");
    }
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
  lastCandidate: EvidenceBundleV1 | null;
}

function createFakeContract(executionLog: string[]): FakeContract {
  const contract: FakeContract = {
    lastCandidate: null,
    async validateCanonicalizeAndHash(candidate: unknown): Promise<CanonicalEvidenceBundle> {
      executionLog.push("contract.validateCanonicalizeAndHash");
      contract.lastCandidate = candidate as EvidenceBundleV1;
      const canonical = JSON.stringify(candidate);
      return {
        payload: candidate as EvidenceBundleV1,
        payloadCanonical: canonical,
        payloadHash: `hash-${canonical.length}`,
        idempotencyKey: "fixed-idempotency-key",
        schemaVersion: "evidence-bundle.v1"
      };
    }
  };
  return contract;
}

describe("assembleEvidenceBundle contextual integration", () => {
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

  it("queries the complete contextual source matrix including support resistance and news", async () => {
    rawRepo.store.push(makeRawRow({ id: 1 }));
    featureRepo.store.push(
      makeDerivedFeatureRow({
        id: 1,
        featureKind: "range_location",
        positionId: "pos-1",
        poolId: "pool-abc",
        inputObservationIds: [1],
        rawRefs: [makeRawRef(1, "clmm-v2-bundle", "raw-hash-1")]
      })
    );

    await prepareAndFinalizePositionWithoutBriefForTest(
      { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
      makeRequest()
    );

    expect(normalizedRepo.lastListCandidatesArg).toEqual({
      sourceKinds: [
        { source: "macro-calendar-api", observationKind: "scheduled_event" },
        { source: "solana-status-api", observationKind: "protocol_incident" },
        { source: "helius-api", observationKind: "whale_transfer" },
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

  it("assembles selected support resistance and news with raw and normalized lineage", async () => {
    const clmmRawRow = makeRawRow({ id: 1 });

    const srRawRow: RawObservationRow = {
      id: 100,
      source: "technical-analysis-api",
      sourceObservationKey: "sr-key-100",
      observedAtUnixMs: EVAL_MS - 3600000,
      fetchedAtUnixMs: EVAL_MS - 3600000,
      payloadHash: "sr-raw-hash-100",
      payloadCanonical: JSON.stringify({ level: 120.5 }),
      parseStatus: "parsed",
      sourceRequestMeta: null,
      receivedAtUnixMs: EVAL_MS - 3600000
    };

    const newsRawRow: RawObservationRow = {
      id: 200,
      source: "crypto-news-api",
      sourceObservationKey: "news-key-200",
      observedAtUnixMs: EVAL_MS - 3600000,
      fetchedAtUnixMs: EVAL_MS - 3600000,
      payloadHash: "news-raw-hash-200",
      payloadCanonical: JSON.stringify({ title: "Solana Growth" }),
      parseStatus: "parsed",
      sourceRequestMeta: null,
      receivedAtUnixMs: EVAL_MS - 3600000
    };

    const regRawRow: RawObservationRow = {
      id: 300,
      source: "regulatory-monitor-api",
      sourceObservationKey: "reg-key-300",
      observedAtUnixMs: EVAL_MS - 3600000,
      fetchedAtUnixMs: EVAL_MS - 3600000,
      payloadHash: "reg-raw-hash-300",
      payloadCanonical: JSON.stringify({ title: "SEC Statement" }),
      parseStatus: "parsed",
      sourceRequestMeta: null,
      receivedAtUnixMs: EVAL_MS - 3600000
    };

    rawRepo.store.push(clmmRawRow, srRawRow, newsRawRow, regRawRow);

    const featureRow = makeDerivedFeatureRow({
      id: 1,
      featureKind: "range_location",
      positionId: "pos-1",
      poolId: "pool-abc",
      inputObservationIds: [1],
      rawRefs: [makeRawRef(1, "clmm-v2-bundle", "raw-hash-1")]
    });
    featureRepo.store.push(featureRow);

    const srNormRow: NormalizedObservationRow = {
      id: 10,
      rawObservationId: 100,
      source: "technical-analysis-api",
      observationKind: "support_resistance_level",
      signalClass: "contextual",
      evidenceFamily: "support_resistance",
      payload: makeSupportResistancePayload(),
      payloadHash: "sr-norm-hash-10",
      confidence: DEFAULT_CONFIDENCE,
      confidenceComposite: 0.85,
      confidenceLevel: "high",
      validUntilUnixMs: EVAL_MS + 86400000,
      isStale: false,
      staleBehavior: null,
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [makeRawRef(100, "technical-analysis-api", "sr-raw-hash-100")]
      },
      receivedAtUnixMs: EVAL_MS - 3600000
    };

    const newsNormRow: NormalizedObservationRow = {
      id: 20,
      rawObservationId: 200,
      source: "crypto-news-api",
      observationKind: "ecosystem_news",
      signalClass: "contextual",
      evidenceFamily: "macro_protocol_risk",
      payload: makeNewsPayload(),
      payloadHash: "news-norm-hash-20",
      confidence: DEFAULT_CONFIDENCE,
      confidenceComposite: 0.9,
      confidenceLevel: "high",
      validUntilUnixMs: EVAL_MS + 86400000,
      isStale: false,
      staleBehavior: null,
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [makeRawRef(200, "crypto-news-api", "news-raw-hash-200")]
      },
      receivedAtUnixMs: EVAL_MS - 3600000
    };

    const regNormRow: NormalizedObservationRow = {
      id: 30,
      rawObservationId: 300,
      source: "regulatory-monitor-api",
      observationKind: "regulatory_risk",
      signalClass: "contextual",
      evidenceFamily: "macro_protocol_risk",
      payload: makeRegulatoryPayload(),
      payloadHash: "reg-norm-hash-30",
      confidence: DEFAULT_CONFIDENCE,
      confidenceComposite: 0.95,
      confidenceLevel: "high",
      validUntilUnixMs: EVAL_MS + 86400000,
      isStale: false,
      staleBehavior: null,
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [makeRawRef(300, "regulatory-monitor-api", "reg-raw-hash-300")]
      },
      receivedAtUnixMs: EVAL_MS - 3600000
    };

    normalizedRepo.store.push(srNormRow, newsNormRow, regNormRow);

    const result = assertSuccess(
      await prepareAndFinalizePositionWithoutBriefForTest(
        { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
        makeRequest()
      )
    );

    expect(result.outcome).toBe("persisted");
    expect(contract.lastCandidate).not.toBeNull();
    const bundle = contract.lastCandidate!;

    expect(bundle.contextualEvidence.supportResistance).toHaveLength(1);
    expect(bundle.contextualEvidence.supportResistance[0]?.claim).toContain(
      "Support at 120.5 USDC/SOL"
    );

    expect(bundle.contextualEvidence.newsRegulatory).toHaveLength(2);
    expect(bundle.contextualEvidence.newsRegulatory.map((n) => n.kind)).toContain("ecosystem_news");
    expect(bundle.contextualEvidence.newsRegulatory.map((n) => n.kind)).toContain(
      "regulatory_update"
    );

    expect(bundle.assessment.coverage.supportResistance).toBe("partial");
    expect(bundle.assessment.coverage.newsRegulatory).toBe("partial");
    expect(bundle.assessment.coverage.flows).toBe("unavailable");
    expect(bundle.assessment.coverage.derivatives).toBe("unavailable");
    expect(bundle.assessment.coverage.events).toBe("unavailable");

    expect(bundle.provenance.upstreamRunIds).toContain("100");
    expect(bundle.provenance.upstreamRunIds).toContain("200");
    expect(bundle.provenance.upstreamRunIds).toContain("300");
  });

  it("excludes stale expired corrected away and ineligible contextual candidates", async () => {
    const clmmRawRow = makeRawRow({ id: 1 });
    const staleRawRow = makeRawRow({ id: 100, source: "technical-analysis-api" });
    rawRepo.store.push(clmmRawRow, staleRawRow);

    featureRepo.store.push(
      makeDerivedFeatureRow({
        id: 1,
        featureKind: "range_location",
        positionId: "pos-1",
        poolId: "pool-abc",
        inputObservationIds: [1],
        rawRefs: [makeRawRef(1, "clmm-v2-bundle", "raw-hash-1")]
      })
    );

    const staleSrRow: NormalizedObservationRow = {
      id: 10,
      rawObservationId: 100,
      source: "technical-analysis-api",
      observationKind: "support_resistance_level",
      signalClass: "contextual",
      evidenceFamily: "support_resistance",
      payload: makeSupportResistancePayload(),
      payloadHash: "stale-sr-hash",
      confidence: DEFAULT_CONFIDENCE,
      confidenceComposite: 0.85,
      confidenceLevel: "high",
      validUntilUnixMs: EVAL_MS + 86400000,
      isStale: true,
      staleBehavior: null,
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [makeRawRef(100, "technical-analysis-api", "raw-hash-100")]
      },
      receivedAtUnixMs: EVAL_MS - 3600000
    };

    normalizedRepo.store.push(staleSrRow);

    const result = assertSuccess(
      await prepareAndFinalizePositionWithoutBriefForTest(
        { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
        makeRequest()
      )
    );

    expect(result.outcome).toBe("persisted");
    expect(contract.lastCandidate?.contextualEvidence.supportResistance).toHaveLength(0);
  });

  it("returns a lineage error when a selected contextual raw parent is missing", async () => {
    const clmmRawRow = makeRawRow({ id: 1 });
    rawRepo.store.push(clmmRawRow);

    featureRepo.store.push(
      makeDerivedFeatureRow({
        id: 1,
        featureKind: "range_location",
        positionId: "pos-1",
        poolId: "pool-abc",
        inputObservationIds: [1],
        rawRefs: [makeRawRef(1, "clmm-v2-bundle", "raw-hash-1")]
      })
    );

    const srNormRow: NormalizedObservationRow = {
      id: 10,
      rawObservationId: 999,
      source: "technical-analysis-api",
      observationKind: "support_resistance_level",
      signalClass: "contextual",
      evidenceFamily: "support_resistance",
      payload: makeSupportResistancePayload(),
      payloadHash: "sr-norm-hash-10",
      confidence: DEFAULT_CONFIDENCE,
      confidenceComposite: 0.85,
      confidenceLevel: "high",
      validUntilUnixMs: EVAL_MS + 86400000,
      isStale: false,
      staleBehavior: null,
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [makeRawRef(999, "technical-analysis-api", "sr-raw-hash-999")]
      },
      receivedAtUnixMs: EVAL_MS - 3600000
    };

    normalizedRepo.store.push(srNormRow);

    const result = await prepareAndFinalizePositionWithoutBriefForTest(
      { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
      makeRequest()
    );

    expect("code" in result).toBe(true);
    if ("code" in result) {
      expect(result.code).toBe("LINEAGE_ERROR");
    }
  });

  it("returns a lineage error when selected contextual source or hash provenance mismatches", async () => {
    const clmmRawRow = makeRawRow({ id: 1 });
    const srRawRow: RawObservationRow = {
      id: 100,
      source: "technical-analysis-api",
      sourceObservationKey: "sr-key-100",
      observedAtUnixMs: EVAL_MS - 3600000,
      fetchedAtUnixMs: EVAL_MS - 3600000,
      payloadHash: "sr-raw-hash-100",
      payloadCanonical: JSON.stringify({ level: 120.5 }),
      parseStatus: "parsed",
      sourceRequestMeta: null,
      receivedAtUnixMs: EVAL_MS - 3600000
    };
    rawRepo.store.push(clmmRawRow, srRawRow);

    featureRepo.store.push(
      makeDerivedFeatureRow({
        id: 1,
        featureKind: "range_location",
        positionId: "pos-1",
        poolId: "pool-abc",
        inputObservationIds: [1],
        rawRefs: [makeRawRef(1, "clmm-v2-bundle", "raw-hash-1")]
      })
    );

    const srNormRow: NormalizedObservationRow = {
      id: 10,
      rawObservationId: 100,
      source: "technical-analysis-api",
      observationKind: "support_resistance_level",
      signalClass: "contextual",
      evidenceFamily: "support_resistance",
      payload: makeSupportResistancePayload(),
      payloadHash: "sr-norm-hash-10",
      confidence: DEFAULT_CONFIDENCE,
      confidenceComposite: 0.85,
      confidenceLevel: "high",
      validUntilUnixMs: EVAL_MS + 86400000,
      isStale: false,
      staleBehavior: null,
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [makeRawRef(100, "technical-analysis-api", "mismatched-hash")]
      },
      receivedAtUnixMs: EVAL_MS - 3600000
    };

    normalizedRepo.store.push(srNormRow);

    const result = await assembleEvidenceBundle(
      { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
      makeRequest()
    );

    expect("code" in result).toBe(true);
    if ("code" in result) {
      expect(result.code).toBe("LINEAGE_ERROR");
    }
  });

  it("continues with empty contextual arrays when contextual querying fails", async () => {
    const clmmRawRow = makeRawRow({ id: 1 });
    rawRepo.store.push(clmmRawRow);

    featureRepo.store.push(
      makeDerivedFeatureRow({
        id: 1,
        featureKind: "range_location",
        positionId: "pos-1",
        poolId: "pool-abc",
        inputObservationIds: [1],
        rawRefs: [makeRawRef(1, "clmm-v2-bundle", "raw-hash-1")]
      })
    );

    normalizedRepo.shouldFailListCandidates = true;

    const result = assertSuccess(
      await assembleEvidenceBundle(
        { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
        makeRequest()
      )
    );

    expect(result.outcome).toBe("persisted");
    expect(contract.lastCandidate?.contextualEvidence.supportResistance).toEqual([]);
    expect(contract.lastCandidate?.contextualEvidence.newsRegulatory).toEqual([]);
    expect(contract.lastCandidate?.contextualEvidence.events).toEqual([]);
  });

  it("persists a contract-valid position bundle with derivative claims", async () => {
    const clmmRawRow = makeRawRow({ id: 1 });
    const fundingRawRow = makeRawRow({
      id: 101,
      source: "binance-fapi",
      payloadHash: "raw-hash-101"
    });
    const oiRawRow = makeRawRow({ id: 102, source: "binance-fapi", payloadHash: "raw-hash-102" });
    const liqRawRow = makeRawRow({ id: 103, source: "drift-api", payloadHash: "raw-hash-103" });

    rawRepo.store.push(clmmRawRow, fundingRawRow, oiRawRow, liqRawRow);

    const clmmFeature = makeDerivedFeatureRow({
      id: 1,
      featureKind: "range_location",
      positionId: "pos-1",
      poolId: "pool-abc",
      inputObservationIds: [1],
      rawRefs: [makeRawRef(1, "clmm-v2-bundle", "raw-hash-1")]
    });

    const fundingFeature = {
      ...makeDerivedFeatureRow({
        id: 2,
        featureKind: "funding_rate_annualized",
        value: 150,
        asOfUnixMs: EVAL_MS - 60000,
        validUntilUnixMs: EVAL_MS + 3600000,
        status: "AVAILABLE",
        calculatorVersion: "1.0.0",
        inputObservationIds: [101],
        rawRefs: [makeRawRef(101, "binance-fapi", "raw-hash-101")]
      }),
      confidence: { ...DEFAULT_CONFIDENCE, compositeScore: 0.81 },
      poolId: null,
      positionId: null
    };

    const oiFeature = {
      ...makeDerivedFeatureRow({
        id: 3,
        featureKind: "oi_trend_4h",
        value: -200,
        asOfUnixMs: EVAL_MS - 60000,
        validUntilUnixMs: EVAL_MS + 3600000,
        status: "AVAILABLE",
        calculatorVersion: "1.0.0",
        inputObservationIds: [102],
        rawRefs: [makeRawRef(102, "binance-fapi", "raw-hash-102")]
      }),
      confidence: { ...DEFAULT_CONFIDENCE, compositeScore: 0.82 },
      poolId: null,
      positionId: null
    };

    const liqFeature = {
      ...makeDerivedFeatureRow({
        id: 4,
        featureKind: "liquidation_cluster_1h",
        value: 50,
        asOfUnixMs: EVAL_MS - 60000,
        validUntilUnixMs: EVAL_MS + 3600000,
        status: "AVAILABLE",
        calculatorVersion: "1.0.0",
        inputObservationIds: [103],
        rawRefs: [makeRawRef(103, "drift-api", "raw-hash-103")]
      }),
      confidence: { ...DEFAULT_CONFIDENCE, compositeScore: 0.83 },
      poolId: null,
      positionId: null
    };

    featureRepo.store.push(clmmFeature, fundingFeature, oiFeature, liqFeature);

    const result = assertSuccess(
      await assembleEvidenceBundle(
        { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
        makeRequest()
      )
    );

    expect(result.outcome).toBe("persisted");
    expect(bundleRepo.store).toHaveLength(1);
    expect(contract.lastCandidate).not.toBeNull();

    const bundle = contract.lastCandidate!;
    const claims = bundle.contextualEvidence.derivatives;
    expect(claims).toHaveLength(3);

    expect(claims[0]!.confidenceBps).toBe(8200); // oi_trend_4h
    expect(claims[1]!.confidenceBps).toBe(8300); // liquidation_cluster_1h
    expect(claims[2]!.confidenceBps).toBe(8100); // funding_rate_annualized

    expect(claims[0]).toEqual({
      evidenceId: "derivative-oi_trend_4h-3",
      kind: "open_interest",
      claim: "oi_trend_4h: -200 BPS (4h)",
      direction: "bearish",
      confidenceBps: 8200,
      observedAt: "2023-12-31T23:59:00.000Z",
      expiresAt: "2024-01-01T01:00:00.000Z",
      sourceReferenceIds: ["raw-102"],
      provenanceMethod: "derived"
    });

    expect(claims[1]).toEqual({
      evidenceId: "derivative-liquidation_cluster_1h-4",
      kind: "liquidation",
      claim: "liquidation_cluster_1h: +50 BPS (1h)",
      direction: "mixed",
      confidenceBps: 8300,
      observedAt: "2023-12-31T23:59:00.000Z",
      expiresAt: "2024-01-01T01:00:00.000Z",
      sourceReferenceIds: ["raw-103"],
      provenanceMethod: "derived"
    });

    expect(claims[2]).toEqual({
      evidenceId: "derivative-funding_rate_annualized-2",
      kind: "funding",
      claim: "funding_rate_annualized: +150 BPS (annualized)",
      direction: "bullish",
      confidenceBps: 8100,
      observedAt: "2023-12-31T23:59:00.000Z",
      expiresAt: "2024-01-01T01:00:00.000Z",
      sourceReferenceIds: ["raw-101"],
      provenanceMethod: "derived"
    });

    expect(bundle.assessment.coverage.derivatives).toBe("partial");
    const warningCodes = bundle.assessment.warnings.map((w) => w.code);
    expect(warningCodes).not.toContain("DERIVATIVES_UNAVAILABLE");
  });

  it("marks derivative coverage present exactly when a derivative claim is eligible", async () => {
    const clmmRawRow = makeRawRow({ id: 1 });
    const basisRawRow = makeRawRow({
      id: 104,
      source: "binance-fapi",
      payloadHash: "raw-hash-104"
    });
    rawRepo.store.push(clmmRawRow, basisRawRow);

    const clmmFeature = makeDerivedFeatureRow({
      id: 1,
      featureKind: "range_location",
      positionId: "pos-1",
      poolId: "pool-abc",
      inputObservationIds: [1],
      rawRefs: [makeRawRef(1, "clmm-v2-bundle", "raw-hash-1")]
    });

    const basisFeature = {
      ...makeDerivedFeatureRow({
        id: 5,
        featureKind: "basis_spread_bps",
        value: 25,
        asOfUnixMs: EVAL_MS - 60000,
        validUntilUnixMs: EVAL_MS + 3600000,
        status: "AVAILABLE",
        calculatorVersion: "1.0.0",
        inputObservationIds: [104],
        rawRefs: [makeRawRef(104, "binance-fapi", "raw-hash-104")]
      }),
      poolId: null,
      positionId: null
    };

    featureRepo.store.push(clmmFeature, basisFeature);

    await assembleEvidenceBundle(
      { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
      makeRequest()
    );

    const bundle = contract.lastCandidate!;
    expect(bundle.contextualEvidence.derivatives).toHaveLength(0);
    expect(bundle.assessment.coverage.derivatives).toBe("unavailable");
    const warningCodes = bundle.assessment.warnings.map((w) => w.code);
    expect(warningCodes).toContain("DERIVATIVES_UNAVAILABLE");
  });

  it("position finalization derives research brief coverage from actual attachment", async () => {
    const { prepareEvidenceBundle, finalizeEvidenceBundle } =
      await import("../../src/application/assemble-evidence-bundle.js");

    rawRepo.store.push(makeRawRow({ id: 1 }));
    featureRepo.store.push(
      makeDerivedFeatureRow({
        id: 1,
        featureKind: "range_location",
        positionId: "pos-1",
        poolId: "pool-abc",
        inputObservationIds: [1],
        rawRefs: [makeRawRef(1, "clmm-v2-bundle", "raw-hash-1")]
      })
    );

    const request = makeRequest();

    const prepareResult = assertSuccess(
      await prepareEvidenceBundle(
        { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
        request
      )
    );
    expect(prepareResult.outcome).toBe("prepared");
    if (prepareResult.outcome !== "prepared") return;

    // Case A: finalize without researchBrief
    const finalizeNoBrief = assertSuccess(
      await finalizeEvidenceBundle(
        { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
        prepareResult.prepared
      )
    );

    expect(finalizeNoBrief.outcome).toBe("persisted");
    const savedNoBrief = bundleRepo.store[0]?.payload as EvidenceBundleV1;
    expect(savedNoBrief.researchBrief).toBeNull();
    expect(savedNoBrief.assessment.coverage.researchBrief).toBe("unavailable");

    // Reset repo store for second test
    bundleRepo.store = [];

    // Case B: finalize with researchBrief
    const mockPersistedBrief: PersistedResearchBrief = {
      briefId: "brief-001",
      pair: "SOL/USDC",
      generationStatus: "complete",
      llmOutput: {
        summary: "Factual summary of position state",
        keyTakeaways: ["Takeaway 1"],
        supportsCurrentRegime: "supports",
        regimeAssessmentReasoning: "Reasoning",
        confidenceScore: 0.9,
        confidenceReasoning: "High confidence",
        sourceEvidenceIds: ["feat-range_location-1"],
        unsupportedOrMissingInputs: []
      },
      sourceRefs: [],
      providerMetadata: { provider: "anthropic", model: "claude-3-5-sonnet-20241022" },
      sourceBundleRef: { bundleId: 1, bundleHash: "hash-1" },
      inputContextHash: "ctx-hash-1",
      priorBriefRef: null,
      generatedAt: "2024-01-01T00:00:00.000Z",
      promptVersion: "v1"
    };

    const finalizeWithBrief = assertSuccess(
      await finalizeEvidenceBundle(
        { clock, featureRepo, normalizedRepo, rawRepo, bundleRepo, contract },
        prepareResult.prepared,
        mockPersistedBrief
      )
    );

    expect(finalizeWithBrief.outcome).toBe("persisted");
    const savedWithBrief = bundleRepo.store[0]?.payload as EvidenceBundleV1;
    expect(savedWithBrief.researchBrief).not.toBeNull();
    expect(savedWithBrief.researchBrief?.briefId).toBe("brief-001");
    expect(savedWithBrief.assessment.coverage.researchBrief).toBe("available");
  });
});
