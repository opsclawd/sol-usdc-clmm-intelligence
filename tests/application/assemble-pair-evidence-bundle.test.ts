import { describe, it, expect, vi } from "vitest";
import type {
  SignalClass,
  EvidenceFamily,
  Confidence,
  Provenance,
  ProvenanceRef
} from "../../src/contracts/taxonomy.js";
import type {
  NormalizedObservationRow,
  RawObservationRow,
  CanonicalEvidenceBundle
} from "../../src/ports/index.js";
import {
  assemblePairEvidenceBundle,
  type AssemblePairEvidenceBundleRequest,
  type AssemblePairEvidenceBundleDeps
} from "../../src/application/assemble-pair-evidence-bundle.js";

const DEFAULT_CONFIDENCE: Confidence = {
  components: {
    sourceReliability: 1,
    dataCompleteness: 1,
    derivationConfidence: 1,
    llmConfidence: null
  },
  compositeScore: 1,
  level: "high",
  weightingVersion: "v1",
  reasons: []
};

const DEFAULT_PROVENANCE: Provenance = {
  sourceRefs: [],
  rawObservationRefs: [],
  derivedFromRefs: [],
  processRef: {
    collector: "test",
    jobName: "test",
    pipelineRunId: null,
    codeVersion: null,
    modelVersion: null
  },
  codeVersion: "test",
  runId: null
};

function makeRawObservationRow(
  overrides: Partial<RawObservationRow> & { id: number }
): RawObservationRow {
  return {
    id: overrides.id,
    source: (overrides.source ?? "macro-calendar-api") as RawObservationRow["source"],
    sourceObservationKey: overrides.sourceObservationKey ?? `key-${overrides.id}`,
    observedAtUnixMs: overrides.observedAtUnixMs ?? 1700000000000,
    fetchedAtUnixMs: overrides.fetchedAtUnixMs ?? 1700000000000,
    payloadHash: overrides.payloadHash ?? `raw-hash-${overrides.id}`,
    payloadCanonical: overrides.payloadCanonical ?? JSON.stringify({ title: "FOMC Meeting" }),
    parseStatus: overrides.parseStatus ?? "parsed",
    sourceRequestMeta: overrides.sourceRequestMeta ?? null,
    receivedAtUnixMs: overrides.receivedAtUnixMs ?? 1700000000000
  };
}

function makeNormalizedRow(
  overrides: Partial<NormalizedObservationRow> & { id: number; rawObservationId: number }
): NormalizedObservationRow {
  const rawId = overrides.rawObservationId;
  const source = overrides.source ?? "macro-calendar-api";
  const rawHash = overrides.rawPayloadHash ?? `raw-hash-${rawId}`;

  const provenance: Provenance = overrides.provenance ?? {
    ...DEFAULT_PROVENANCE,
    rawObservationRefs: [
      {
        refType: "raw_observation",
        id: rawId,
        source: source as ProvenanceRef["source"],
        payloadHash: rawHash
      }
    ]
  };

  return {
    id: overrides.id,
    rawObservationId: rawId,
    source: source as NormalizedObservationRow["source"],
    observationKind: (overrides.observationKind ??
      "scheduled_event") as NormalizedObservationRow["observationKind"],
    signalClass: (overrides.signalClass ?? "contextual") as SignalClass,
    evidenceFamily: (overrides.evidenceFamily ?? "macro_events") as EvidenceFamily,
    payload: overrides.payload ?? {
      sourceEventId: `event-${overrides.id}`,
      eventFamily: "macro_protocol_risk",
      eventType: "scheduled_event",
      title: "FOMC Rate Decision",
      description: "FOMC rate decision meeting",
      asOfUnixMs: 1700000000000,
      expiresAtUnixMs: 1700086400000,
      scheduledStartUnixMs: 1700000000000,
      scheduledEndUnixMs: 1700086400000,
      severity: "HIGH",
      status: "CONFIRMED",
      affectedScope: ["SOL/USDC"],
      sourceReferences: [],
      sourceQuality: { reliabilityScore: 1, freshnessScore: 1 },
      rawProvenance: {
        sourceObservedAtUnixMs: 1700000000000,
        retrievedAtUnixMs: 1700000000000,
        retentionMode: "bounded_factual_extract",
        license: "MIT"
      },
      warnings: []
    },
    payloadHash: overrides.payloadHash ?? `norm-hash-${overrides.id}`,
    confidence: overrides.confidence ?? DEFAULT_CONFIDENCE,
    confidenceComposite: overrides.confidenceComposite ?? null,
    confidenceLevel: overrides.confidenceLevel ?? null,
    validUntilUnixMs: overrides.validUntilUnixMs ?? null,
    isStale: overrides.isStale ?? false,
    staleBehavior: overrides.staleBehavior ?? null,
    provenance,
    receivedAtUnixMs: overrides.receivedAtUnixMs ?? 1700000000000
  };
}

function makeMockCanonicalBundle(): CanonicalEvidenceBundle {
  return {
    schemaVersion: "evidence-bundle.v1",
    payload: {},
    payloadHash: "canonical-hash-123",
    payloadCanonical: "{}",
    idempotencyKey: "idem-123"
  };
}

function makeDefaultRequest(): AssemblePairEvidenceBundleRequest {
  return {
    pair: "SOL/USDC",
    pipelineRunId: "run-123",
    correlationId: "corr-123",
    evaluationTimeUnixMs: 1700000000000,
    createdAtUnixMs: 1700000000000,
    schemaVersion: "evidence-bundle.v1",
    assemblySelectionVersion: "v1",
    codeVersion: "1.0.0",
    gitCommit: "abc1234",
    environment: "test"
  };
}

function createMockDeps() {
  return {
    clock: { now: () => "2026-05-10T12:00:00.000Z" },
    normalizedRepo: {
      listCandidates: vi.fn(),
      findByIds: vi.fn()
    },
    rawRepo: {
      findByIds: vi.fn()
    },
    bundleRepo: {
      insertOrClassify: vi.fn()
    },
    contract: {
      validateCanonicalizeAndHash: vi.fn()
    }
  };
}

describe("assemblePairEvidenceBundle", () => {
  it("selects only the pair-safe contextual source matrix and never queries derived features", async () => {
    const deps = createMockDeps();
    const req = makeDefaultRequest();
    deps.normalizedRepo.listCandidates.mockResolvedValue([]);

    const result = await assemblePairEvidenceBundle(
      deps as unknown as AssemblePairEvidenceBundleDeps,
      req
    );

    expect(result).toEqual({ outcome: "no_bundle" });
    expect(deps.normalizedRepo.listCandidates).toHaveBeenCalledWith({
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
      receivedAtOrAfterUnixMs: req.evaluationTimeUnixMs - 7 * 24 * 60 * 60 * 1000
    });
    // Verify featureRepo is not part of deps interface
    expect((deps as Record<string, unknown>).featureRepo).toBeUndefined();
  });

  it("persists a canonical pair bundle with only contextual lineage and unavailable MVP slots", async () => {
    const deps = createMockDeps();
    const req = makeDefaultRequest();

    const normRow = makeNormalizedRow({ id: 10, rawObservationId: 1 });
    const rawRow = makeRawObservationRow({ id: 1, payloadHash: "raw-hash-1" });

    deps.normalizedRepo.listCandidates.mockResolvedValue([normRow]);
    deps.rawRepo.findByIds.mockResolvedValue([rawRow]);
    const mockCanonical = makeMockCanonicalBundle();
    deps.contract.validateCanonicalizeAndHash.mockResolvedValue(mockCanonical);
    deps.bundleRepo.insertOrClassify.mockResolvedValue({
      outcome: "inserted",
      row: { id: 42, payloadHash: "canonical-hash-123" }
    });

    const result = await assemblePairEvidenceBundle(
      deps as unknown as AssemblePairEvidenceBundleDeps,
      req
    );

    expect(result).toEqual({
      outcome: "persisted",
      rowId: 42,
      payloadHash: "canonical-hash-123",
      slotCount: 11,
      warnings: expect.any(Array)
    });

    expect(deps.contract.validateCanonicalizeAndHash).toHaveBeenCalledTimes(1);
    const candidateArg = deps.contract.validateCanonicalizeAndHash.mock.calls[0][0];
    expect(candidateArg.scope).toEqual({ kind: "pair" });
    expect(candidateArg.runId).toBe("run-123:pair");
    expect(candidateArg.provenance.upstreamRunIds).toEqual(["1"]);
    expect(candidateArg.sourceReferences).toEqual(
      expect.arrayContaining([expect.objectContaining({ referenceId: "raw-1" })])
    );
    expect(candidateArg.deterministicFeatures).toHaveLength(11);
  });

  it("returns no_bundle without validating or writing when no contextual evidence is selected", async () => {
    const deps = createMockDeps();
    const req = makeDefaultRequest();
    deps.normalizedRepo.listCandidates.mockResolvedValue([]);

    const result = await assemblePairEvidenceBundle(
      deps as unknown as AssemblePairEvidenceBundleDeps,
      req
    );

    expect(result).toEqual({ outcome: "no_bundle" });
    expect(deps.rawRepo.findByIds).not.toHaveBeenCalled();
    expect(deps.contract.validateCanonicalizeAndHash).not.toHaveBeenCalled();
    expect(deps.bundleRepo.insertOrClassify).not.toHaveBeenCalled();
  });

  it("rejects a selected contextual row whose raw parent source or payload hash disagrees", async () => {
    const deps = createMockDeps();
    const req = makeDefaultRequest();

    const normRow = makeNormalizedRow({
      id: 10,
      rawObservationId: 1,
      rawPayloadHash: "expected-hash"
    });
    const rawRow = makeRawObservationRow({ id: 1, payloadHash: "disagreeing-hash" });

    deps.normalizedRepo.listCandidates.mockResolvedValue([normRow]);
    deps.rawRepo.findByIds.mockResolvedValue([rawRow]);

    const result = await assemblePairEvidenceBundle(
      deps as unknown as AssemblePairEvidenceBundleDeps,
      req
    );

    expect(result.outcome).toBeUndefined();
    expect(result).toEqual({
      code: "LINEAGE_ERROR",
      message: expect.any(String)
    });
    expect(deps.contract.validateCanonicalizeAndHash).not.toHaveBeenCalled();
    expect(deps.bundleRepo.insertOrClassify).not.toHaveBeenCalled();
  });

  it("returns identical_replay for the same pair run identity and canonical content", async () => {
    const deps = createMockDeps();
    const req = makeDefaultRequest();

    const normRow = makeNormalizedRow({ id: 10, rawObservationId: 1 });
    const rawRow = makeRawObservationRow({ id: 1, payloadHash: "raw-hash-1" });

    deps.normalizedRepo.listCandidates.mockResolvedValue([normRow]);
    deps.rawRepo.findByIds.mockResolvedValue([rawRow]);
    const mockCanonical = makeMockCanonicalBundle();
    deps.contract.validateCanonicalizeAndHash.mockResolvedValue(mockCanonical);
    deps.bundleRepo.insertOrClassify.mockResolvedValue({
      outcome: "identical_replay",
      row: { id: 42, payloadHash: "canonical-hash-123" }
    });

    const result = await assemblePairEvidenceBundle(
      deps as unknown as AssemblePairEvidenceBundleDeps,
      req
    );

    expect(result).toEqual({
      outcome: "identical_replay",
      rowId: 42,
      payloadHash: "canonical-hash-123",
      slotCount: 11,
      warnings: expect.any(Array)
    });
  });

  it("returns conflict for the same pair run identity with different canonical content", async () => {
    const deps = createMockDeps();
    const req = makeDefaultRequest();

    const normRow = makeNormalizedRow({ id: 10, rawObservationId: 1 });
    const rawRow = makeRawObservationRow({ id: 1, payloadHash: "raw-hash-1" });

    deps.normalizedRepo.listCandidates.mockResolvedValue([normRow]);
    deps.rawRepo.findByIds.mockResolvedValue([rawRow]);
    const mockCanonical = makeMockCanonicalBundle();
    deps.contract.validateCanonicalizeAndHash.mockResolvedValue(mockCanonical);
    deps.bundleRepo.insertOrClassify.mockResolvedValue({
      outcome: "conflict",
      row: { id: 42, payloadHash: "existing-hash" },
      incomingPayloadHash: "incoming-hash"
    });

    const result = await assemblePairEvidenceBundle(
      deps as unknown as AssemblePairEvidenceBundleDeps,
      req
    );

    expect(result).toEqual({
      outcome: "conflict",
      rowId: 42,
      incomingPayloadHash: "incoming-hash"
    });
  });

  it("converts contract and repository exceptions into typed errors without partial persistence", async () => {
    const deps = createMockDeps();
    const req = makeDefaultRequest();

    const normRow = makeNormalizedRow({ id: 10, rawObservationId: 1 });
    const rawRow = makeRawObservationRow({ id: 1, payloadHash: "raw-hash-1" });

    deps.normalizedRepo.listCandidates.mockResolvedValue([normRow]);
    deps.rawRepo.findByIds.mockResolvedValue([rawRow]);

    // Contract failure
    deps.contract.validateCanonicalizeAndHash.mockRejectedValue({
      code: "VALIDATION_ERROR",
      errors: ["Invalid candidate"]
    });

    const contractResult = await assemblePairEvidenceBundle(
      deps as unknown as AssemblePairEvidenceBundleDeps,
      req
    );
    expect(contractResult).toEqual({
      code: "CONTRACT_ERROR",
      error: { code: "VALIDATION_ERROR", errors: ["Invalid candidate"] }
    });
    expect(deps.bundleRepo.insertOrClassify).not.toHaveBeenCalled();

    // Persistence failure
    deps.contract.validateCanonicalizeAndHash.mockResolvedValue(makeMockCanonicalBundle());
    deps.bundleRepo.insertOrClassify.mockRejectedValue(new Error("DB Connection failed"));

    const persistResult = await assemblePairEvidenceBundle(
      deps as unknown as AssemblePairEvidenceBundleDeps,
      req
    );
    expect(persistResult).toEqual({
      code: "PERSISTENCE_ERROR",
      message: expect.stringContaining("DB Connection failed")
    });
    expect(deps.bundleRepo.insertOrClassify).toHaveBeenCalledTimes(1);
  });
});
