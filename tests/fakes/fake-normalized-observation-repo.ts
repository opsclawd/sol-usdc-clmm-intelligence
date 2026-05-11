import type {
  NormalizedObservationRepo,
  NormalizedObservationRow,
  NormalizedObservationInsert
} from "../../src/ports/normalized-observation-repo.js";
import type { Source, ObservationKind } from "../../src/contracts/taxonomy.js";

const DEFAULT_CONFIDENCE = {
  components: {
    sourceReliability: 1,
    dataCompleteness: 1,
    derivationConfidence: 1,
    llmConfidence: null
  },
  compositeScore: 1,
  level: "high" as const,
  weightingVersion: "v1",
  reasons: []
};

const DEFAULT_PROVENANCE = {
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

export class FakeNormalizedObservationRepo implements NormalizedObservationRepo {
  private readonly store: NormalizedObservationRow[] = [];
  private nextId = 1;

  async insert(row: NormalizedObservationInsert): Promise<NormalizedObservationRow> {
    const existing = this.store.find(
      (r) =>
        r.source === row.source &&
        r.observationKind === row.observationKind &&
        r.payloadHash === row.payloadHash
    );
    if (existing) return existing;
    const result: NormalizedObservationRow = {
      id: this.nextId++,
      rawObservationId: row.rawObservationId,
      source: row.source,
      observationKind: row.observationKind,
      signalClass: row.signalClass,
      evidenceFamily: row.evidenceFamily,
      payload: row.payload,
      payloadHash: row.payloadHash,
      confidence: row.confidence ?? DEFAULT_CONFIDENCE,
      confidenceComposite: row.confidenceComposite ?? null,
      confidenceLevel: row.confidenceLevel ?? null,
      validUntilUnixMs: row.validUntilUnixMs ?? null,
      isStale: row.isStale ?? false,
      staleBehavior: row.staleBehavior ?? null,
      provenance: row.provenance ?? DEFAULT_PROVENANCE,
      receivedAtUnixMs: row.receivedAtUnixMs
    };
    this.store.push(result);
    return result;
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
}
