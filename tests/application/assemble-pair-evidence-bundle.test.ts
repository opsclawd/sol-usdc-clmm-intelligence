import { describe, it, expect } from "vitest";
import type { Clock } from "../../src/ports/clock.js";
import type {
  NormalizedObservationRepo,
  RawObservationRepo,
  EvidenceBundleRepo,
  EvidenceBundleContract,
  NormalizedObservationCandidateQuery,
  EvidenceBundleInsert
} from "../../src/ports/index.js";
import type {
  EvidenceBundleRow,
  EvidenceBundleInsertOutcome
} from "../../src/ports/bundle-repo.js";
import type { CanonicalEvidenceBundle } from "../../src/ports/evidence-bundle-contract.js";
import type {
  Confidence,
  Provenance,
  ProvenanceRef,
  SignalClass,
  EvidenceFamily
} from "../../src/contracts/taxonomy.js";
import type { ScheduledEventPayloadV1 } from "../../src/contracts/context-events.js";
import type { NormalizedObservationRow, RawObservationRow } from "../../src/contracts/index.js";
import type { EvidenceBundleV1 } from "../../src/contracts/generated/evidence-bundle-v1.js";
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
    observedAtUnixMs: overrides.observedAtUnixMs ?? 1000000,
    fetchedAtUnixMs: overrides.fetchedAtUnixMs ?? 1000000,
    payloadHash: overrides.payloadHash ?? `raw-hash-${overrides.id}`,
    payloadCanonical: overrides.payloadCanonical ?? JSON.stringify({ title: "FOMC Meeting" }),
    parseStatus: overrides.parseStatus ?? "parsed",
    sourceRequestMeta: overrides.sourceRequestMeta ?? null,
    receivedAtUnixMs: overrides.receivedAtUnixMs ?? 1000000
  };
}

function makeScheduledEventPayload(
  overrides: Partial<ScheduledEventPayloadV1> = {}
): ScheduledEventPayloadV1 {
  return {
    sourceEventId: overrides.sourceEventId ?? "evt-1",
    eventFamily: "macro_protocol_risk",
    eventType: "scheduled_event",
    title: overrides.title ?? "FOMC Meeting",
    description: "Federal Open Market Committee Meeting",
    asOfUnixMs: overrides.asOfUnixMs ?? 1000000,
    expiresAtUnixMs: overrides.expiresAtUnixMs ?? 2000000,
    scheduledStartUnixMs: 1200000,
    scheduledEndUnixMs: 1400000,
    severity: overrides.severity ?? "HIGH",
    status: overrides.status ?? "SCHEDULED",
    affectedScope: ["SOL/USDC"],
    sourceReferences: [],
    sourceQuality: {
      providerId: "macro-calendar-api",
      reliability: 0.9,
      completeness: "complete",
      confirmation: "official"
    },
    rawProvenance: {
      sourceObservedAtUnixMs: 1000000,
      retrievedAtUnixMs: 1000000,
      retentionMode: "bounded_factual_extract",
      license: "public"
    },
    warnings: [],
    ...overrides
  };
}

function makeNormalizedRow(
  overrides: Partial<NormalizedObservationRow> & { id: number; rawObservationId: number }
): NormalizedObservationRow {
  const rawId = overrides.rawObservationId;
  const source = overrides.source ?? "macro-calendar-api";
  const rawHash = overrides.payloadHash ?? `raw-hash-${rawId}`;

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
    payload: overrides.payload ?? makeScheduledEventPayload(),
    payloadHash: overrides.payloadHash ?? `norm-hash-${overrides.id}`,
    confidence: overrides.confidence ?? DEFAULT_CONFIDENCE,
    confidenceComposite: overrides.confidenceComposite ?? null,
    confidenceLevel: overrides.confidenceLevel ?? null,
    validUntilUnixMs: overrides.validUntilUnixMs ?? null,
    isStale: overrides.isStale ?? false,
    staleBehavior: overrides.staleBehavior ?? null,
    provenance,
    receivedAtUnixMs: overrides.receivedAtUnixMs ?? 1000000
  };
}

function makeCanonicalBundle(): CanonicalEvidenceBundle {
  return {
    schemaVersion: "evidence-bundle.v1",
    payload: {} as unknown as EvidenceBundleV1,
    payloadCanonical: JSON.stringify({ pair: "SOL/USDC" }),
    payloadHash: "canonical-hash-1",
    idempotencyKey: "canonical-idemp-1"
  };
}

function makeBundleRow(overrides: Partial<EvidenceBundleRow> = {}): EvidenceBundleRow {
  return {
    id: 100,
    schemaVersion: "evidence-bundle.v1",
    pair: "SOL/USDC",
    asOfUnixMs: 1000000,
    expiresAtUnixMs: 4600000,
    payload: {},
    payloadHash: "canonical-hash-1",
    payloadCanonical: JSON.stringify({ pair: "SOL/USDC" }),
    idempotencyKey: "canonical-idemp-1",
    taxonomySummary: null,
    dominantSignalClass: "contextual",
    confidence: DEFAULT_CONFIDENCE,
    confidenceComposite: 8000,
    confidenceLevel: "high",
    validUntilUnixMs: 8200000,
    isStale: false,
    staleBehavior: null,
    provenance: DEFAULT_PROVENANCE,
    version: 1,
    receivedAtUnixMs: 1000000,
    ...overrides
  };
}

function makeDefaultRequest(): AssemblePairEvidenceBundleRequest {
  return {
    pair: "SOL/USDC",
    pipelineRunId: "pipeline-1",
    correlationId: "corr-1",
    evaluationTimeUnixMs: 1000000,
    createdAtUnixMs: 1000000,
    schemaVersion: "evidence-bundle.v1",
    codeVersion: "1.0.0",
    gitCommit: "9a0c68f4080ec2b934f44b0e3bc0f668d5255171",
    environment: "test"
  };
}

function makeMockNormalizedRepo(
  overrides: Partial<NormalizedObservationRepo> = {}
): NormalizedObservationRepo {
  return {
    insert: async () => {
      throw new Error("not implemented");
    },
    insertMany: async () => {
      throw new Error("not implemented");
    },
    findBySource: async () => [],
    findFreshByKind: async () => [],
    findLatestByKind: async () => null,
    findByRawObservation: async () => null,
    listCandidates: async () => [],
    findByIds: async () => [],
    ...overrides
  };
}

function makeMockRawRepo(overrides: Partial<RawObservationRepo> = {}): RawObservationRepo {
  return {
    insertOrClassify: async () => {
      throw new Error("not implemented");
    },
    findById: async () => undefined,
    findByIds: async () => [],
    findByIdentity: async () => undefined,
    findByHash: async () => undefined,
    findBySource: async () => [],
    updateParseStatus: async () => {
      throw new Error("not implemented");
    },
    ...overrides
  };
}

describe("assemblePairEvidenceBundle", () => {
  it("selects only the pair-safe contextual source matrix and never queries derived features", async () => {
    let capturedQuery: NormalizedObservationCandidateQuery | null = null;
    const rawRow = makeRawObservationRow({
      id: 1,
      source: "macro-calendar-api",
      payloadHash: "raw-hash-1"
    });
    const normRow = makeNormalizedRow({
      id: 10,
      rawObservationId: 1,
      source: "macro-calendar-api"
    });

    const normalizedRepo = makeMockNormalizedRepo({
      listCandidates: async (q) => {
        capturedQuery = q;
        return [normRow];
      },
      findByIds: async () => [normRow]
    });

    const rawRepo = makeMockRawRepo({
      findByIds: async () => [rawRow],
      findById: async () => rawRow
    });

    const bundleRepo: EvidenceBundleRepo = {
      insertOrClassify: async () => ({ outcome: "inserted", row: makeBundleRow() }),
      findById: async () => undefined,
      findByPair: async () => [],
      findLatestByPair: async () => undefined
    };

    const contract: EvidenceBundleContract = {
      validateCanonicalizeAndHash: async () => makeCanonicalBundle()
    };

    const clock: Clock = { now: () => "2026-05-10T12:00:00.000Z" };

    const deps: AssemblePairEvidenceBundleDeps = {
      clock,
      normalizedRepo,
      rawRepo,
      bundleRepo,
      contract
    };

    expect("featureRepo" in (deps as unknown as Record<string, unknown>)).toBe(false);

    const result = await assemblePairEvidenceBundle(deps, makeDefaultRequest());
    expect("outcome" in result && result.outcome).toBe("persisted");

    expect(capturedQuery).not.toBeNull();
    if (capturedQuery) {
      const sources = (capturedQuery as NormalizedObservationCandidateQuery).sourceKinds.map(
        (sk) => `${sk.source}:${sk.observationKind}`
      );
      expect(sources).toEqual([
        "macro-calendar-api:scheduled_event",
        "solana-status-api:protocol_incident",
        "helius-api:whale_transfer",
        "helius-api:whale_swap",
        "birdeye-api:whale_swap",
        "helius-api:stablecoin_flow",
        "helius-api:cex_flow_proxy",
        "birdeye-api:dex_net_flow",
        "technical-analysis-api:support_resistance_level",
        "crypto-news-api:ecosystem_news",
        "regulatory-monitor-api:regulatory_risk"
      ]);
    }
  });

  it("persists a canonical pair bundle with only contextual lineage and unavailable MVP slots", async () => {
    const rawRow = makeRawObservationRow({
      id: 1,
      source: "macro-calendar-api",
      payloadHash: "raw-hash-1"
    });
    const normRow = makeNormalizedRow({
      id: 10,
      rawObservationId: 1,
      source: "macro-calendar-api",
      observationKind: "scheduled_event",
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          {
            refType: "raw_observation",
            id: 1,
            source: "macro-calendar-api",
            payloadHash: "raw-hash-1"
          }
        ]
      }
    });

    let capturedCandidate: unknown = null;
    let capturedInsert: EvidenceBundleInsert | null = null;

    const deps: AssemblePairEvidenceBundleDeps = {
      clock: { now: () => "2026-05-10T12:00:00.000Z" },
      normalizedRepo: makeMockNormalizedRepo({
        listCandidates: async () => [normRow],
        findByIds: async () => [normRow]
      }),
      rawRepo: makeMockRawRepo({
        findByIds: async () => [rawRow],
        findById: async () => rawRow
      }),
      contract: {
        validateCanonicalizeAndHash: async (candidate) => {
          capturedCandidate = candidate;
          return makeCanonicalBundle();
        }
      },
      bundleRepo: {
        insertOrClassify: async (insert) => {
          capturedInsert = insert;
          return { outcome: "inserted", row: makeBundleRow() };
        },
        findById: async () => undefined,
        findByPair: async () => [],
        findLatestByPair: async () => undefined
      }
    };

    const result = await assemblePairEvidenceBundle(deps, makeDefaultRequest());

    expect("outcome" in result && result.outcome).toBe("persisted");
    if ("outcome" in result && result.outcome === "persisted") {
      expect(result.rowId).toBe(100);
      expect(result.payloadHash).toBe("canonical-hash-1");
    }

    expect(capturedCandidate).toMatchObject({
      scope: { kind: "pair" },
      runId: "pipeline-1:pair"
    });

    const features = (capturedCandidate as { deterministicFeatures: Array<{ status: string }> })
      .deterministicFeatures;
    expect(features).toHaveLength(11);
    for (const feat of features) {
      expect(feat.status).toBe("unavailable");
    }

    const insert = capturedInsert as EvidenceBundleInsert | null;
    expect(insert).not.toBeNull();
    if (insert) {
      expect(insert.pair).toBe("SOL/USDC");
      expect(insert.dominantSignalClass).toBe("contextual");
      expect(insert.confidenceComposite).toBeGreaterThanOrEqual(0);
      expect(insert.confidenceComposite).toBeLessThanOrEqual(1);
      expect(
        (insert.confidence as { compositeScore: number })?.compositeScore
      ).toBeGreaterThanOrEqual(0);
      expect((insert.confidence as { compositeScore: number })?.compositeScore).toBeLessThanOrEqual(
        1
      );
    }
  });

  it("returns no_bundle without validating or writing when no contextual evidence is selected", async () => {
    let contractCalled = false;
    let bundleRepoCalled = false;

    const deps: AssemblePairEvidenceBundleDeps = {
      clock: { now: () => "2026-05-10T12:00:00.000Z" },
      normalizedRepo: makeMockNormalizedRepo({
        listCandidates: async () => [],
        findByIds: async () => []
      }),
      rawRepo: makeMockRawRepo({
        findByIds: async () => [],
        findById: async () => undefined
      }),
      contract: {
        validateCanonicalizeAndHash: async () => {
          contractCalled = true;
          return makeCanonicalBundle();
        }
      },
      bundleRepo: {
        insertOrClassify: async () => {
          bundleRepoCalled = true;
          return { outcome: "inserted", row: makeBundleRow() };
        },
        findById: async () => undefined,
        findByPair: async () => [],
        findLatestByPair: async () => undefined
      }
    };

    const result = await assemblePairEvidenceBundle(deps, makeDefaultRequest());

    expect("outcome" in result && result.outcome).toBe("no_bundle");
    expect(contractCalled).toBe(false);
    expect(bundleRepoCalled).toBe(false);
  });

  it("rejects a selected contextual row whose raw parent source or payload hash disagrees", async () => {
    const rawRow = makeRawObservationRow({
      id: 1,
      source: "macro-calendar-api",
      payloadHash: "raw-hash-1"
    });
    const normRow = makeNormalizedRow({
      id: 10,
      rawObservationId: 1,
      source: "macro-calendar-api",
      observationKind: "scheduled_event",
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          {
            refType: "raw_observation",
            id: 1,
            source: "macro-calendar-api",
            payloadHash: "MISMASHED_HASH"
          }
        ]
      }
    });

    let contractCalled = false;
    let bundleRepoCalled = false;

    const deps: AssemblePairEvidenceBundleDeps = {
      clock: { now: () => "2026-05-10T12:00:00.000Z" },
      normalizedRepo: makeMockNormalizedRepo({
        listCandidates: async () => [normRow],
        findByIds: async () => [normRow]
      }),
      rawRepo: makeMockRawRepo({
        findByIds: async () => [rawRow],
        findById: async () => rawRow
      }),
      contract: {
        validateCanonicalizeAndHash: async () => {
          contractCalled = true;
          return makeCanonicalBundle();
        }
      },
      bundleRepo: {
        insertOrClassify: async () => {
          bundleRepoCalled = true;
          return { outcome: "inserted", row: makeBundleRow() };
        },
        findById: async () => undefined,
        findByPair: async () => [],
        findLatestByPair: async () => undefined
      }
    };

    const result = await assemblePairEvidenceBundle(deps, makeDefaultRequest());

    expect("code" in result && result.code).toBe("LINEAGE_ERROR");
    expect(contractCalled).toBe(false);
    expect(bundleRepoCalled).toBe(false);
  });

  it("returns identical_replay for the same pair run identity and canonical content", async () => {
    const rawRow = makeRawObservationRow({
      id: 1,
      source: "macro-calendar-api",
      payloadHash: "raw-hash-1"
    });
    const normRow = makeNormalizedRow({
      id: 10,
      rawObservationId: 1,
      source: "macro-calendar-api",
      observationKind: "scheduled_event",
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          {
            refType: "raw_observation",
            id: 1,
            source: "macro-calendar-api",
            payloadHash: "raw-hash-1"
          }
        ]
      }
    });

    const deps: AssemblePairEvidenceBundleDeps = {
      clock: { now: () => "2026-05-10T12:00:00.000Z" },
      normalizedRepo: makeMockNormalizedRepo({
        listCandidates: async () => [normRow],
        findByIds: async () => [normRow]
      }),
      rawRepo: makeMockRawRepo({
        findByIds: async () => [rawRow],
        findById: async () => rawRow
      }),
      contract: {
        validateCanonicalizeAndHash: async () => makeCanonicalBundle()
      },
      bundleRepo: {
        insertOrClassify: async () => ({
          outcome: "identical_replay",
          row: makeBundleRow({ id: 200, payloadHash: "canonical-hash-1" })
        }),
        findById: async () => undefined,
        findByPair: async () => [],
        findLatestByPair: async () => undefined
      }
    };

    const result = await assemblePairEvidenceBundle(deps, makeDefaultRequest());

    expect("outcome" in result && result.outcome).toBe("identical_replay");
    if ("outcome" in result && result.outcome === "identical_replay") {
      expect(result.rowId).toBe(200);
      expect(result.payloadHash).toBe("canonical-hash-1");
    }
  });

  it("returns conflict for the same pair run identity with different canonical content", async () => {
    const rawRow = makeRawObservationRow({
      id: 1,
      source: "macro-calendar-api",
      payloadHash: "raw-hash-1"
    });
    const normRow = makeNormalizedRow({
      id: 10,
      rawObservationId: 1,
      source: "macro-calendar-api",
      observationKind: "scheduled_event",
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          {
            refType: "raw_observation",
            id: 1,
            source: "macro-calendar-api",
            payloadHash: "raw-hash-1"
          }
        ]
      }
    });

    const deps: AssemblePairEvidenceBundleDeps = {
      clock: { now: () => "2026-05-10T12:00:00.000Z" },
      normalizedRepo: makeMockNormalizedRepo({
        listCandidates: async () => [normRow],
        findByIds: async () => [normRow]
      }),
      rawRepo: makeMockRawRepo({
        findByIds: async () => [rawRow],
        findById: async () => rawRow
      }),
      contract: {
        validateCanonicalizeAndHash: async () => makeCanonicalBundle()
      },
      bundleRepo: {
        insertOrClassify: async (): Promise<EvidenceBundleInsertOutcome> => ({
          outcome: "conflict",
          row: makeBundleRow({ id: 300, payloadHash: "existing-different-hash" }),
          incomingPayloadHash: "canonical-hash-1"
        }),
        findById: async () => undefined,
        findByPair: async () => [],
        findLatestByPair: async () => undefined
      }
    };

    const result = await assemblePairEvidenceBundle(deps, makeDefaultRequest());

    expect("outcome" in result && result.outcome).toBe("conflict");
    if ("outcome" in result && result.outcome === "conflict") {
      expect(result.rowId).toBe(300);
      expect(result.incomingPayloadHash).toBe("canonical-hash-1");
    }
  });

  it("converts contract and repository exceptions into typed errors without partial persistence", async () => {
    const rawRow = makeRawObservationRow({
      id: 1,
      source: "macro-calendar-api",
      payloadHash: "raw-hash-1"
    });
    const normRow = makeNormalizedRow({
      id: 10,
      rawObservationId: 1,
      source: "macro-calendar-api",
      observationKind: "scheduled_event",
      provenance: {
        ...DEFAULT_PROVENANCE,
        rawObservationRefs: [
          {
            refType: "raw_observation",
            id: 1,
            source: "macro-calendar-api",
            payloadHash: "raw-hash-1"
          }
        ]
      }
    });

    let bundleRepoCalled = false;

    // 1. Contract failure
    const contractErrorDeps: AssemblePairEvidenceBundleDeps = {
      clock: { now: () => "2026-05-10T12:00:00.000Z" },
      normalizedRepo: makeMockNormalizedRepo({
        listCandidates: async () => [normRow],
        findByIds: async () => [normRow]
      }),
      rawRepo: makeMockRawRepo({
        findByIds: async () => [rawRow],
        findById: async () => rawRow
      }),
      contract: {
        validateCanonicalizeAndHash: async () => {
          throw { code: "VALIDATION_ERROR", errors: ["Invalid schema"] };
        }
      },
      bundleRepo: {
        insertOrClassify: async () => {
          bundleRepoCalled = true;
          return { outcome: "inserted", row: makeBundleRow() };
        },
        findById: async () => undefined,
        findByPair: async () => [],
        findLatestByPair: async () => undefined
      }
    };

    const contractResult = await assemblePairEvidenceBundle(
      contractErrorDeps,
      makeDefaultRequest()
    );
    expect("code" in contractResult && contractResult.code).toBe("CONTRACT_ERROR");
    expect(bundleRepoCalled).toBe(false);

    // 2. Persistence failure
    const persistenceErrorDeps: AssemblePairEvidenceBundleDeps = {
      clock: { now: () => "2026-05-10T12:00:00.000Z" },
      normalizedRepo: makeMockNormalizedRepo({
        listCandidates: async () => [normRow],
        findByIds: async () => [normRow]
      }),
      rawRepo: makeMockRawRepo({
        findByIds: async () => [rawRow],
        findById: async () => rawRow
      }),
      contract: {
        validateCanonicalizeAndHash: async () => makeCanonicalBundle()
      },
      bundleRepo: {
        insertOrClassify: async () => {
          throw new Error("DB connection lost");
        },
        findById: async () => undefined,
        findByPair: async () => [],
        findLatestByPair: async () => undefined
      }
    };

    const persistenceResult = await assemblePairEvidenceBundle(
      persistenceErrorDeps,
      makeDefaultRequest()
    );
    expect("code" in persistenceResult && persistenceResult.code).toBe("PERSISTENCE_ERROR");
  });
});
