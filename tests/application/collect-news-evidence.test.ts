import { describe, it, expect, beforeEach } from "vitest";
import {
  collectNewsEvidence,
  type CollectNewsEvidenceDeps
} from "../../src/application/collect-news-evidence.js";
import type { NewsEvidencePayload } from "../../src/contracts/news-events.js";
import type { NormalizedObservationCandidateQuery } from "../../src/ports/normalized-observation-repo.js";
import type { CollectionRunContext } from "../../src/application/create-collection-run-context.js";
import { acceptBoundedNewsRecord } from "../../src/domain/news-events/validate.js";
import { FakeNewsSource } from "../fakes/fake-news-source.js";
import { FakeObservationRepo } from "../fakes/fake-observation-repo.js";
import { FakeNormalizedObservationRepo } from "../fakes/fake-normalized-observation-repo.js";
import type { NewsSourceSnapshot } from "../../src/ports/news-source.js";

describe("collectNewsEvidence", () => {
  let fakeNewsSource: FakeNewsSource;
  let fakeRawRepo: FakeObservationRepo;
  let fakeNormalizedRepo: FakeNormalizedObservationRepo;
  let deps: CollectNewsEvidenceDeps;
  const startedAt = 1715340000000;
  const context: CollectionRunContext = { runId: "test-run-1", startedAtUnixMs: startedAt };

  const sampleCryptoNewsArticle = acceptBoundedNewsRecord({
    source: "crypto-news-api" as const,
    providerId: "crypto-news-provider",
    providerRunId: "run-100",
    retrievedAtUnixMs: startedAt,
    articleId: "art-1",
    sourceVersionId: "v1",
    correctsSourceVersionId: null,
    title: "Solana DeFi Activity Surges",
    factualSummary: "Solana total value locked increased by 15% this week.",
    extractedClaims: ["TVL increased by 15%"],
    topicTags: ["solana", "defi"],
    publishedAtUnixMs: startedAt - 1000,
    sourceUpdatedAtUnixMs: startedAt - 1000,
    publisher: {
      publisherId: "coindesk",
      displayName: "CoinDesk",
      tier: "official" as const
    },
    sourceQuality: {
      providerId: "crypto-news-provider",
      reliability: 0.9,
      completeness: "complete" as const,
      confirmation: "confirmed" as const,
      isPaywalled: false
    },
    originatingReportId: "rep-1",
    syndicationId: null,
    affectedAssets: ["SOL"],
    affectedProtocols: ["orca"],
    affectedJurisdictions: [],
    sourceReferences: ["https://example.com/art-1"],
    license: "CC-BY-4.0",
    retentionMode: "bounded_factual_extract" as const,
    robotsAllowed: true,
    termsAllowRetention: true
  });

  const sampleRegArticle = acceptBoundedNewsRecord({
    source: "regulatory-monitor-api" as const,
    providerId: "reg-provider",
    providerRunId: "run-200",
    retrievedAtUnixMs: startedAt,
    articleId: "reg-1",
    sourceVersionId: "v1",
    correctsSourceVersionId: null,
    title: "SEC Clarifies Staking Guidance",
    factualSummary: "SEC released updated guidance regarding liquid staking.",
    extractedClaims: ["Updated guidance released"],
    topicTags: ["sec", "staking"],
    publishedAtUnixMs: startedAt - 1000,
    sourceUpdatedAtUnixMs: startedAt - 1000,
    publisher: {
      publisherId: "sec-gov",
      displayName: "SEC",
      tier: "official" as const
    },
    sourceQuality: {
      providerId: "reg-provider",
      reliability: 0.95,
      completeness: "complete" as const,
      confirmation: "confirmed" as const,
      isPaywalled: false
    },
    originatingReportId: "rep-2",
    syndicationId: null,
    affectedAssets: ["SOL"],
    affectedProtocols: [],
    affectedJurisdictions: ["US"],
    sourceReferences: ["https://sec.gov/guidance"],
    license: "public_domain",
    retentionMode: "bounded_factual_extract" as const,
    robotsAllowed: true,
    termsAllowRetention: true
  });

  beforeEach(() => {
    fakeNewsSource = new FakeNewsSource();
    fakeRawRepo = new FakeObservationRepo();
    fakeNormalizedRepo = new FakeNormalizedObservationRepo();
    deps = {
      newsSource: fakeNewsSource,
      rawObservationRepo: fakeRawRepo,
      normalizedObservationRepo: fakeNormalizedRepo
    };
  });

  // Named requirement tests
  it("exact article version replay writes no duplicate rows", async () => {
    const snapshot: NewsSourceSnapshot = {
      source: "crypto-news-api",
      providerId: "crypto-news-provider",
      providerRunId: "run-100",
      retrievedAtUnixMs: startedAt,
      records: [sampleCryptoNewsArticle]
    };
    fakeNewsSource.setResponse(snapshot);

    const firstResult = await collectNewsEvidence(deps, context, "crypto-news-api");
    expect(firstResult.status).toBe("accepted");
    expect(firstResult.rawObservationIds.length).toBe(1);
    expect(firstResult.normalizedCount).toBe(1);

    const initialRawCount = (await fakeRawRepo.findBySource("crypto-news-api", 0)).length;
    const initialNormalizedCount = fakeNormalizedRepo.count;

    // Replay exact same article version
    fakeNewsSource.setResponse(snapshot);
    const secondResult = await collectNewsEvidence(deps, context, "crypto-news-api");

    expect(secondResult.status).toBe("identical_replay");
    expect(secondResult.normalizedCount).toBe(0);

    const finalRawCount = (await fakeRawRepo.findBySource("crypto-news-api", 0)).length;
    const finalNormalizedCount = fakeNormalizedRepo.count;

    expect(finalRawCount).toBe(initialRawCount);
    expect(finalNormalizedCount).toBe(initialNormalizedCount);
  });

  it("reused article version with changed content is a conflict", async () => {
    const originalSnapshot: NewsSourceSnapshot = {
      source: "crypto-news-api",
      providerId: "crypto-news-provider",
      providerRunId: "run-100",
      retrievedAtUnixMs: startedAt,
      records: [sampleCryptoNewsArticle]
    };
    fakeNewsSource.setResponse(originalSnapshot);

    const firstResult = await collectNewsEvidence(deps, context, "crypto-news-api");
    expect(firstResult.status).toBe("accepted");
    expect(fakeNormalizedRepo.count).toBe(1);

    // Reused articleId and sourceVersionId with changed title
    const changedArticle = acceptBoundedNewsRecord({
      ...sampleCryptoNewsArticle,
      title: "Solana DeFi Activity Crashes Entirely",
      license: "CC-BY-4.0",
      retentionMode: "bounded_factual_extract" as const,
      robotsAllowed: true,
      termsAllowRetention: true
    });
    const changedSnapshot: NewsSourceSnapshot = {
      source: "crypto-news-api",
      providerId: "crypto-news-provider",
      providerRunId: "run-101",
      retrievedAtUnixMs: startedAt + 5000,
      records: [changedArticle]
    };
    fakeNewsSource.setResponse(changedSnapshot);

    const conflictResult = await collectNewsEvidence(deps, context, "crypto-news-api");
    expect(conflictResult.status).toBe("conflict");
    expect(conflictResult.failedArticleIds).toEqual(["art-1"]);
    // Changed version must NOT be normalized
    expect(fakeNormalizedRepo.count).toBe(1);
  });

  it("correction appends a linked version without overwriting history", async () => {
    const originalSnapshot: NewsSourceSnapshot = {
      source: "crypto-news-api",
      providerId: "crypto-news-provider",
      providerRunId: "run-100",
      retrievedAtUnixMs: startedAt,
      records: [sampleCryptoNewsArticle]
    };
    fakeNewsSource.setResponse(originalSnapshot);

    await collectNewsEvidence(deps, context, "crypto-news-api");

    const correctedArticle = acceptBoundedNewsRecord({
      ...sampleCryptoNewsArticle,
      sourceVersionId: "v2",
      correctsSourceVersionId: "v1",
      factualSummary: "Solana total value locked increased by 18% (corrected).",
      license: "CC-BY-4.0",
      retentionMode: "bounded_factual_extract" as const,
      robotsAllowed: true,
      termsAllowRetention: true
    });

    const correctionSnapshot: NewsSourceSnapshot = {
      source: "crypto-news-api",
      providerId: "crypto-news-provider",
      providerRunId: "run-102",
      retrievedAtUnixMs: startedAt + 10000,
      records: [correctedArticle]
    };
    fakeNewsSource.setResponse(correctionSnapshot);

    const correctionResult = await collectNewsEvidence(deps, context, "crypto-news-api");
    expect(correctionResult.status).toBe("accepted");
    expect(correctionResult.normalizedCount).toBe(1);

    const rawRows = await fakeRawRepo.findBySource("crypto-news-api", 0);
    expect(rawRows.length).toBe(2); // History preserved + new appended version

    const normalizedRows = await fakeNormalizedRepo.findBySource(
      "crypto-news-api",
      "ecosystem_news",
      0
    );
    const p1 = normalizedRows[0]!.payload as NewsEvidencePayload;
    const p2 = normalizedRows[1]!.payload as NewsEvidencePayload;
    expect(p1.sourceVersionId).toBe("v1");
    expect(p2.sourceVersionId).toBe("v2");
    expect(p2.correctsSourceVersionId).toBe("v1");
  });

  it("unavailable sources create no no-risk observation", async () => {
    fakeNewsSource.setError({
      kind: "unavailable",
      diagnostic: "API endpoint down for maintenance"
    });

    const result = await collectNewsEvidence(deps, context, "crypto-news-api");

    expect(result.status).toBe("unavailable");
    expect(result.rawObservationIds).toEqual([]);
    expect(result.normalizedCount).toBe(0);
    expect(result.diagnostic).toContain("API endpoint down for maintenance");

    const rawRows = await fakeRawRepo.findBySource("crypto-news-api", 0);
    expect(rawRows.length).toBe(0);
    expect(fakeNormalizedRepo.count).toBe(0);
  });

  it("successful articles remain committed when a later article fails", async () => {
    const badArticle = {
      ...sampleCryptoNewsArticle,
      articleId: "art-2",
      rawProvenance: {
        ...sampleCryptoNewsArticle.rawProvenance,
        robotsCompliance: false
      }
    };

    const snapshot: NewsSourceSnapshot = {
      source: "crypto-news-api",
      providerId: "crypto-news-provider",
      providerRunId: "run-100",
      retrievedAtUnixMs: startedAt,
      records: [sampleCryptoNewsArticle, badArticle]
    };
    fakeNewsSource.setResponse(snapshot);

    const result = await collectNewsEvidence(deps, context, "crypto-news-api");

    expect(result.status).toBe("partial");
    expect(result.failedArticleIds).toEqual(["art-2"]);
    expect(result.rawObservationIds.length).toBe(1);
    expect(result.normalizedCount).toBe(1);

    // Article 1 remains committed
    const rawRows = await fakeRawRepo.findBySource("crypto-news-api", 0);
    expect(rawRows.length).toBe(1);
    expect(rawRows[0]!.sourceObservationKey).toBeDefined();
  });

  // Additional behavior proof tests
  it("source collection happens before persistence", async () => {
    const callOrder: string[] = [];
    const origCollect = fakeNewsSource.collect.bind(fakeNewsSource);
    fakeNewsSource.collect = async (req) => {
      callOrder.push("source_collect");
      return origCollect(req);
    };

    const origInsert = fakeRawRepo.insertOrClassify.bind(fakeRawRepo);
    fakeRawRepo.insertOrClassify = async (row) => {
      callOrder.push("raw_insert");
      return origInsert(row);
    };

    fakeNewsSource.setResponse({
      source: "crypto-news-api",
      providerId: "provider",
      providerRunId: "run-1",
      retrievedAtUnixMs: startedAt,
      records: [sampleCryptoNewsArticle]
    });

    await collectNewsEvidence(deps, context, "crypto-news-api");

    expect(callOrder[0]).toBe("source_collect");
    expect(callOrder[1]).toBe("raw_insert");
  });

  it("malformed source snapshots write nothing", async () => {
    fakeNewsSource.setError({
      kind: "malformed",
      diagnostic: "JSON syntax error in stream"
    });

    const result = await collectNewsEvidence(deps, context, "crypto-news-api");
    expect(result.status).toBe("malformed");
    expect(result.rawObservationIds).toEqual([]);
    expect(result.normalizedCount).toBe(0);

    const rawRows = await fakeRawRepo.findBySource("crypto-news-api", 0);
    expect(rawRows.length).toBe(0);
    expect(fakeNormalizedRepo.count).toBe(0);
  });

  it("raw insert precedes history lookup and normalized insert for each record", async () => {
    const callOrder: string[] = [];
    const origRawInsert = fakeRawRepo.insertOrClassify.bind(fakeRawRepo);
    fakeRawRepo.insertOrClassify = async (row) => {
      callOrder.push("raw_insert");
      return origRawInsert(row);
    };

    const origListCandidates = fakeNormalizedRepo.listCandidates.bind(fakeNormalizedRepo);
    fakeNormalizedRepo.listCandidates = async (query) => {
      callOrder.push("list_candidates");
      return origListCandidates(query);
    };

    const origInsertMany = fakeNormalizedRepo.insertMany.bind(fakeNormalizedRepo);
    fakeNormalizedRepo.insertMany = async (rows) => {
      callOrder.push("normalized_insert");
      return origInsertMany(rows);
    };

    fakeNewsSource.setResponse({
      source: "crypto-news-api",
      providerId: "crypto-news-provider",
      providerRunId: "run-100",
      retrievedAtUnixMs: startedAt,
      records: [sampleCryptoNewsArticle]
    });

    await collectNewsEvidence(deps, context, "crypto-news-api");

    expect(callOrder).toEqual(["raw_insert", "list_candidates", "normalized_insert"]);
  });

  it("both new observation kinds query seven days of existing candidates across both allowlisted sources", async () => {
    let queriedQuery: NormalizedObservationCandidateQuery | null = null;
    fakeNormalizedRepo.listCandidates = async (query) => {
      queriedQuery = query;
      return [];
    };

    fakeNewsSource.setResponse({
      source: "crypto-news-api",
      providerId: "crypto-news-provider",
      providerRunId: "run-100",
      retrievedAtUnixMs: startedAt,
      records: [sampleCryptoNewsArticle]
    });

    await collectNewsEvidence(deps, context, "crypto-news-api");

    expect(queriedQuery).not.toBeNull();
    expect(queriedQuery!.receivedAtOrAfterUnixMs).toBe(startedAt - 7 * 86_400_000);
    expect(queriedQuery!.sourceKinds).toEqual([
      { source: "crypto-news-api", observationKind: "ecosystem_news" },
      { source: "crypto-news-api", observationKind: "regulatory_risk" },
      { source: "regulatory-monitor-api", observationKind: "ecosystem_news" },
      { source: "regulatory-monitor-api", observationKind: "regulatory_risk" }
    ]);
  });

  it("normalized rows carry the raw parent, payload hash, contextual class/family, freshness, confidence, stale behavior, and provenance", async () => {
    fakeNewsSource.setResponse({
      source: "regulatory-monitor-api",
      providerId: "reg-provider",
      providerRunId: "run-200",
      retrievedAtUnixMs: startedAt,
      records: [sampleRegArticle]
    });

    const result = await collectNewsEvidence(deps, context, "regulatory-monitor-api");
    expect(result.status).toBe("accepted");

    const rawRows = await fakeRawRepo.findBySource("regulatory-monitor-api", 0);
    expect(rawRows.length).toBe(1);
    const parentRawId = rawRows[0]!.id;

    const normRows = await fakeNormalizedRepo.findBySource(
      "regulatory-monitor-api",
      "regulatory_risk",
      0
    );
    expect(normRows.length).toBe(1);
    const row = normRows[0]!;

    expect(row.rawObservationId).toBe(parentRawId);
    expect(row.payloadHash).toBeDefined();
    expect(row.signalClass).toBe("contextual");
    expect(row.evidenceFamily).toBe("news_evidence");
    expect(row.validUntilUnixMs).toBeGreaterThan(0);
    expect(row.confidence).toBeDefined();
    expect(row.confidenceComposite).toBeGreaterThan(0);
    expect(row.staleBehavior).toBe("allow_context_only");
    expect(row.provenance.sourceRefs[0]!.id).toBe(parentRawId);
  });

  it("diagnostics redact secret-like values", async () => {
    fakeNewsSource.setError({
      kind: "network",
      diagnostic: "Connection failed using api_key=secret_12345_abc to server"
    });

    const result = await collectNewsEvidence(deps, context, "crypto-news-api");
    expect(result.status).toBe("network");
    expect(result.diagnostic).not.toContain("secret_12345_abc");
    expect(result.diagnostic).toContain("[REDACTED]");
  });

  it("an empty successful source response returns accepted with zero rows but no absence claim", async () => {
    fakeNewsSource.setResponse({
      source: "crypto-news-api",
      providerId: "crypto-news-provider",
      providerRunId: "run-100",
      retrievedAtUnixMs: startedAt,
      records: []
    });

    const result = await collectNewsEvidence(deps, context, "crypto-news-api");
    expect(result.status).toBe("accepted");
    expect(result.rawObservationIds).toEqual([]);
    expect(result.normalizedCount).toBe(0);
    expect(result.failedArticleIds).toEqual([]);
    expect(result.diagnostic).toBeNull();

    expect(await fakeRawRepo.findBySource("crypto-news-api", 0)).toEqual([]);
    expect(fakeNormalizedRepo.count).toBe(0);
  });
});
