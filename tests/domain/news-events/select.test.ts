import { describe, it, expect } from "vitest";
import type { NormalizedObservationRow } from "../../../src/contracts/normalized-observation.js";
import type {
  NewsEvidencePayload,
  RegulatoryPayloadV1
} from "../../../src/contracts/news-events.js";
import type { Source, ObservationKind } from "../../../src/contracts/taxonomy.js";
import { makeBoundedNewsSourceRecord } from "../../fixtures/news-events.js";
import { acceptBoundedNewsRecord } from "../../../src/domain/news-events/validate.js";
import { normalizeNewsRecord } from "../../../src/domain/news-events/normalize.js";
import { selectNewsEvidence } from "../../../src/domain/news-events/select.js";

const EVAL_TIME = 1705400000000;

function buildPayload(
  overrides?: Parameters<typeof makeBoundedNewsSourceRecord>[0]
): NewsEvidencePayload {
  const rawRecord = makeBoundedNewsSourceRecord({
    publishedAtUnixMs: EVAL_TIME - 3600000,
    retrievedAtUnixMs: EVAL_TIME - 1800000,
    ...overrides
  });
  const bounded = acceptBoundedNewsRecord(rawRecord);
  return normalizeNewsRecord(bounded, EVAL_TIME);
}

function buildRegulatoryPayload(
  overrides?: Parameters<typeof makeBoundedNewsSourceRecord>[0]
): RegulatoryPayloadV1 {
  const rawRecord = makeBoundedNewsSourceRecord({
    source: "regulatory-monitor-api",
    providerId: "regulatory-monitor-api",
    affectedJurisdictions: ["US"],
    publishedAtUnixMs: EVAL_TIME - 3600000,
    retrievedAtUnixMs: EVAL_TIME - 1800000,
    ...overrides
  });
  const bounded = acceptBoundedNewsRecord(rawRecord);
  return normalizeNewsRecord(bounded, EVAL_TIME) as RegulatoryPayloadV1;
}

function makeRow(
  id: number,
  payload: NewsEvidencePayload,
  overrides?: Partial<NormalizedObservationRow>
): NormalizedObservationRow {
  const source =
    payload.evidenceKind === "regulatory_risk" ? "regulatory-monitor-api" : "crypto-news-api";
  const observationKind = payload.evidenceKind;

  return {
    id,
    rawObservationId: id * 10,
    source,
    observationKind,
    signalClass: "contextual",
    evidenceFamily: "news_evidence",
    payload,
    payloadHash: `hash-${id}-${payload.articleId}-${payload.sourceVersionId}`,
    confidence: {
      components: {
        sourceReliability: 0.8,
        dataCompleteness: 1.0,
        derivationConfidence: 1.0,
        llmConfidence: null
      },
      compositeScore: 0.8,
      level: "medium",
      weightingVersion: "v1",
      reasons: []
    },
    confidenceComposite: 0.8,
    confidenceLevel: "medium",
    validUntilUnixMs: payload.expiresAtUnixMs,
    isStale: false,
    staleBehavior: "exclude",
    provenance: {
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
      codeVersion: "1.0.0",
      runId: null
    },
    receivedAtUnixMs: payload.retrievedAtUnixMs,
    ...overrides
  };
}

describe("selectNewsEvidence", () => {
  it("excludes stale expired future and malformed news rows", () => {
    const validPayload = buildPayload({ articleId: "art-1", sourceVersionId: "v1" });
    const validRow = makeRow(1, validPayload);

    const validRegPayload = buildRegulatoryPayload({
      articleId: "art-reg-1",
      sourceVersionId: "v1"
    });
    const validRegRow = makeRow(6, validRegPayload);

    // Stale row
    const stalePayload = buildPayload({ articleId: "art-2", sourceVersionId: "v1" });
    const staleRow = makeRow(2, stalePayload, { isStale: true });

    // Expired row (validUntilUnixMs in past)
    const expiredPayload = buildPayload({ articleId: "art-3", sourceVersionId: "v1" });
    const expiredRow = makeRow(3, expiredPayload, { validUntilUnixMs: EVAL_TIME - 100 });

    // Future row (asOfUnixMs in future)
    const futurePayload = buildPayload({
      articleId: "art-4",
      sourceVersionId: "v1",
      publishedAtUnixMs: EVAL_TIME + 3600000
    });
    const futureRow = makeRow(4, futurePayload);

    // Malformed row (disallowed source/kind pair)
    const malformedRow = {
      ...makeRow(5, validPayload),
      source: "coingecko" as unknown as Source,
      observationKind: "ecosystem_news" as unknown as ObservationKind
    };

    const results = selectNewsEvidence({
      evaluationTimeUnixMs: EVAL_TIME,
      candidates: [validRow, validRegRow, staleRow, expiredRow, futureRow, malformedRow],
      maxItems: 10
    });

    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.row.id);
    expect(ids).toContain(1);
    expect(ids).toContain(6);
  });

  it("selects the terminal correction and never revives a corrected version", () => {
    // v1 -> v2 -> v3 chain
    const v1Payload = buildPayload({
      articleId: "art-chain",
      sourceVersionId: "v1",
      correctsSourceVersionId: null
    });
    const v2Payload = buildPayload({
      articleId: "art-chain",
      sourceVersionId: "v2",
      correctsSourceVersionId: "v1"
    });
    const v3Payload = buildPayload({
      articleId: "art-chain",
      sourceVersionId: "v3",
      correctsSourceVersionId: "v2"
    });

    const v1Row = makeRow(1, v1Payload);
    const v2Row = makeRow(2, v2Payload);
    const v3Row = makeRow(3, v3Payload);

    // Terminal selection should pick v3
    const results = selectNewsEvidence({
      evaluationTimeUnixMs: EVAL_TIME,
      candidates: [v1Row, v2Row, v3Row],
      maxItems: 10
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.payload.sourceVersionId).toBe("v3");

    // If v3 is expired, entire article identity is suppressed (no revival of v1 or v2)
    const expiredV3Row = makeRow(3, v3Payload, { validUntilUnixMs: EVAL_TIME - 1000 });
    const suppressedResults = selectNewsEvidence({
      evaluationTimeUnixMs: EVAL_TIME,
      candidates: [v1Row, v2Row, expiredV3Row],
      maxItems: 10
    });

    expect(suppressedResults).toHaveLength(0);
  });

  it("rejects cyclic correction chains and accepts an external predecessor", () => {
    // Cycle: v1 corrects v2, v2 corrects v1
    const cycleV1 = buildPayload({
      articleId: "art-cycle",
      sourceVersionId: "v1",
      correctsSourceVersionId: "v2"
    });
    const cycleV2 = buildPayload({
      articleId: "art-cycle",
      sourceVersionId: "v2",
      correctsSourceVersionId: "v1"
    });

    const cycleRow1 = makeRow(1, cycleV1);
    const cycleRow2 = makeRow(2, cycleV2);

    const cycleResults = selectNewsEvidence({
      evaluationTimeUnixMs: EVAL_TIME,
      candidates: [cycleRow1, cycleRow2],
      maxItems: 10
    });
    expect(cycleResults).toHaveLength(0);

    // External predecessor: v2 corrects v0 (v0 not in candidate list)
    const extV2 = buildPayload({
      articleId: "art-ext",
      sourceVersionId: "v2",
      correctsSourceVersionId: "v0"
    });
    const extRow = makeRow(3, extV2);

    const extResults = selectNewsEvidence({
      evaluationTimeUnixMs: EVAL_TIME,
      candidates: [extRow],
      maxItems: 10
    });
    expect(extResults).toHaveLength(1);
    expect(extResults[0]?.payload.sourceVersionId).toBe("v2");
  });

  it("selects one representative for a non conflicting cluster", () => {
    const clusterId = "cluster-non-conflicting";
    const payload1 = {
      ...buildPayload({ articleId: "art-c1", sourceVersionId: "v1" }),
      clusterId,
      corroborationState: "single_source" as const
    };
    const payload2 = {
      ...buildPayload({ articleId: "art-c2", sourceVersionId: "v1" }),
      clusterId,
      corroborationState: "independently_corroborated" as const
    };

    const row1 = makeRow(1, payload1);
    const row2 = makeRow(2, payload2);

    const results = selectNewsEvidence({
      evaluationTimeUnixMs: EVAL_TIME,
      candidates: [row1, row2],
      maxItems: 10
    });

    expect(results).toHaveLength(1);
    // Independently corroborated ranks higher
    expect(results[0]?.row.id).toBe(2);
  });

  it("retains two stable representatives when a cluster contains conflicting evidence", () => {
    const clusterId = "cluster-conflicting";

    const nonConflictingPayload = {
      ...buildPayload({ articleId: "art-nc", sourceVersionId: "v1" }),
      clusterId,
      corroborationState: "independently_corroborated" as const
    };
    const conflictingPayload1 = {
      ...buildPayload({ articleId: "art-c1", sourceVersionId: "v1" }),
      clusterId,
      corroborationState: "conflicting" as const
    };
    const conflictingPayload2 = {
      ...buildPayload({ articleId: "art-c2", sourceVersionId: "v1" }),
      clusterId,
      corroborationState: "conflicting" as const
    };

    const rowNC = makeRow(1, nonConflictingPayload);
    const rowC1 = makeRow(2, conflictingPayload1);
    const rowC2 = makeRow(3, conflictingPayload2);

    const results = selectNewsEvidence({
      evaluationTimeUnixMs: EVAL_TIME,
      candidates: [rowNC, rowC1, rowC2],
      maxItems: 10
    });

    // Should retain 1 non-conflicting + 1 best conflicting representative = 2
    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.row.id);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
  });

  it("ranks normalized SOL Solana Orca and USDC relevance ahead of unrelated records", () => {
    const unrelatedPayload = buildPayload({
      articleId: "art-btc",
      affectedAssets: ["BTC"],
      affectedProtocols: ["Bitcoin"]
    });
    const solPayload = buildPayload({
      articleId: "art-sol",
      affectedAssets: ["SOL"],
      affectedProtocols: ["Solana"]
    });

    // Unrelated record has higher confidence but is irrelevant to SOL/USDC
    const rowUnrelated = makeRow(1, unrelatedPayload, {
      confidenceComposite: 0.99
    });
    const rowSol = makeRow(2, solPayload, {
      confidenceComposite: 0.5
    });

    const results = selectNewsEvidence({
      evaluationTimeUnixMs: EVAL_TIME,
      candidates: [rowUnrelated, rowSol],
      maxItems: 10
    });

    expect(results).toHaveLength(2);
    expect(results[0]?.payload.articleId).toBe("art-sol");
    expect(results[1]?.payload.articleId).toBe("art-btc");
  });

  it("preserves corroboration state warnings and bounded factual text", () => {
    const payload = buildPayload({
      articleId: "art-preserve",
      title: "Preserved Title",
      factualSummary: "Preserved summary content."
    });
    const row = makeRow(1, payload);

    const results = selectNewsEvidence({
      evaluationTimeUnixMs: EVAL_TIME,
      candidates: [row],
      maxItems: 10
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.payload.title).toBe("Preserved Title");
    expect(results[0]?.payload.factualSummary).toBe("Preserved summary content.");
    expect(results[0]?.payload.corroborationState).toBe(payload.corroborationState);
    expect(results[0]?.payload.warnings).toEqual(payload.warnings);
  });

  it("orders ties by confidence recency source article version hash and row id", () => {
    // Both relevant, same corroboration state
    const baseOverride = {
      affectedAssets: ["SOL"],
      publishedAtUnixMs: EVAL_TIME - 3600000
    };

    // Candidate 1: confidence 0.8
    // Candidate 2: confidence 0.9 (should win tie-break over 1)
    const payload1 = buildPayload({ ...baseOverride, articleId: "art-tie1" });
    const payload2 = buildPayload({ ...baseOverride, articleId: "art-tie2" });

    const row1 = makeRow(1, payload1, { confidenceComposite: 0.8 });
    const row2 = makeRow(2, payload2, { confidenceComposite: 0.9 });

    const results = selectNewsEvidence({
      evaluationTimeUnixMs: EVAL_TIME,
      candidates: [row1, row2],
      maxItems: 10
    });

    expect(results[0]?.row.id).toBe(2);
    expect(results[1]?.row.id).toBe(1);
  });

  it("never returns more than the requested operational cap", () => {
    const rows: NormalizedObservationRow[] = [];
    for (let i = 1; i <= 20; i++) {
      const p = buildPayload({
        articleId: `art-cap-${i}`,
        affectedAssets: ["SOL"]
      });
      rows.push(makeRow(i, p));
    }

    const res5 = selectNewsEvidence({
      evaluationTimeUnixMs: EVAL_TIME,
      candidates: rows,
      maxItems: 5
    });
    expect(res5).toHaveLength(5);

    // Operational cap max is 16 even if maxItems is 20
    const res20 = selectNewsEvidence({
      evaluationTimeUnixMs: EVAL_TIME,
      candidates: rows,
      maxItems: 20
    });
    expect(res20).toHaveLength(16);
  });
});
