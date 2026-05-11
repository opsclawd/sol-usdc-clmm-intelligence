import type {
  ResearchBriefRepo,
  ResearchBriefRow,
  ResearchBriefInsert
} from "../../src/ports/brief-repo.js";

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

export class FakeBriefRepo implements ResearchBriefRepo {
  private readonly store: ResearchBriefRow[] = [];
  private nextId = 1;

  async insert(row: ResearchBriefInsert): Promise<ResearchBriefRow> {
    const existing = this.store.find(
      (r) => r.evidenceBundleId === row.evidenceBundleId && r.payloadHash === row.payloadHash
    );
    if (existing) return existing;
    const result: ResearchBriefRow = {
      id: this.nextId++,
      evidenceBundleId: row.evidenceBundleId,
      promptVersion: row.promptVersion,
      modelProvider: row.modelProvider,
      structuredOutput: row.structuredOutput,
      signalClass: row.signalClass,
      evidenceFamily: row.evidenceFamily ?? null,
      taxonomySummary: row.taxonomySummary ?? null,
      confidence: row.confidence ?? DEFAULT_CONFIDENCE,
      confidenceComposite: row.confidenceComposite ?? null,
      confidenceLevel: row.confidenceLevel ?? null,
      validUntilUnixMs: row.validUntilUnixMs ?? null,
      isStale: row.isStale ?? false,
      staleBehavior: row.staleBehavior ?? null,
      provenance: row.provenance ?? DEFAULT_PROVENANCE,
      payloadHash: row.payloadHash,
      receivedAtUnixMs: row.receivedAtUnixMs
    };
    this.store.push(result);
    return result;
  }

  async findByBundleId(evidenceBundleId: number): Promise<ResearchBriefRow[]> {
    return this.store.filter((r) => r.evidenceBundleId === evidenceBundleId);
  }

  async findByHash(
    evidenceBundleId: number,
    payloadHash: string
  ): Promise<ResearchBriefRow | undefined> {
    return this.store.find(
      (r) => r.evidenceBundleId === evidenceBundleId && r.payloadHash === payloadHash
    );
  }
}
