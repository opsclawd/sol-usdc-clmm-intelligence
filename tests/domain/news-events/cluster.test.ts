import { describe, it, expect } from "vitest";
import type { NewsEvidencePayload } from "../../../src/contracts/news-events.js";
import type { UnclusteredNewsEvidencePayload } from "../../../src/domain/news-events/normalize.js";
import type { ClusterNewsEvidenceInput } from "../../../src/domain/news-events/cluster.js";
import { clusterNewsEvidence } from "../../../src/domain/news-events/cluster.js";
import { makeBoundedNewsSourceRecord } from "../../fixtures/news-events.js";
import { acceptBoundedNewsRecord } from "../../../src/domain/news-events/validate.js";
import { normalizeNewsRecord } from "../../../src/domain/news-events/normalize.js";

function buildPayload(
  overrides?: Parameters<typeof makeBoundedNewsSourceRecord>[0]
): NewsEvidencePayload {
  const rawRecord = makeBoundedNewsSourceRecord(overrides);
  const bounded = acceptBoundedNewsRecord(rawRecord);
  return normalizeNewsRecord(bounded, 1705400000000);
}

function buildClusterInput(
  historical: readonly NewsEvidencePayload[],
  incoming: readonly UnclusteredNewsEvidencePayload[]
): ClusterNewsEvidenceInput {
  return { historical, incoming };
}

describe("clusterNewsEvidence", () => {
  describe("syndication grouping", () => {
    it("provider syndication id groups copies without corroboration", async () => {
      const syndicationId = "synd-12345";
      const original = buildPayload({
        articleId: "article-001",
        sourceVersionId: "v1",
        syndicationId,
        originatingReportId: "report-001",
        publisher: { publisherId: "pub-1", displayName: "Primary Source", tier: "primary" },
        title: "Solana Network Upgrade Announced"
      });

      const copy1 = buildPayload({
        articleId: "article-002",
        sourceVersionId: "v1",
        syndicationId,
        originatingReportId: "report-002",
        publisher: { publisherId: "pub-2", displayName: "Aggregator A", tier: "aggregator" },
        title: "Solana Network Upgrade Announced"
      });

      const copy2 = buildPayload({
        articleId: "article-003",
        sourceVersionId: "v1",
        syndicationId,
        originatingReportId: "report-003",
        publisher: { publisherId: "pub-3", displayName: "Aggregator B", tier: "aggregator" },
        title: "Solana Network Upgrade Announced"
      });

      const input = buildClusterInput([], [original, copy1, copy2]);
      const result = await clusterNewsEvidence(input);

      expect(result).toHaveLength(3);
      const clusterIds = result.map((r) => r.clusterId);
      const uniqueClusterIds = new Set(clusterIds);
      expect(uniqueClusterIds).toHaveLength(1);

      const allSingleSource = result.every((r) => r.corroborationState === "single_source");
      expect(allSingleSource).toBe(true);
    });

    it("same-publisher rewrites do not corroborate", async () => {
      const v1 = buildPayload({
        articleId: "article-001",
        sourceVersionId: "v1",
        syndicationId: null,
        originatingReportId: "report-001",
        publisher: { publisherId: "pub-1", displayName: "Primary Source", tier: "primary" },
        title: "Solana Price at $100"
      });

      const v2 = buildPayload({
        articleId: "article-001",
        sourceVersionId: "v2",
        syndicationId: null,
        originatingReportId: "report-001",
        publisher: { publisherId: "pub-1", displayName: "Primary Source", tier: "primary" },
        title: "Solana Price at $105"
      });

      const input = buildClusterInput([], [v1, v2]);
      const result = await clusterNewsEvidence(input);

      expect(result).toHaveLength(2);
      const clusterIds = result.map((r) => r.clusterId);
      expect(new Set(clusterIds)).toHaveLength(2);
      expect(result.every((r) => r.corroborationState === "single_source")).toBe(true);
    });
  });

  describe("determinism", () => {
    it("near duplicate clustering is deterministic across input order", async () => {
      const article1 = buildPayload({
        articleId: "article-001",
        sourceVersionId: "v1",
        syndicationId: null,
        originatingReportId: "report-001",
        publisher: { publisherId: "pub-1", displayName: "Source A", tier: "primary" },
        title: "Solana DeFi Protocol Launches New Feature",
        factualSummary: "A new feature was launched on the Solana blockchain.",
        extractedClaims: ["Feature launched on Solana", "DeFi protocol announced"],
        sourceReferences: ["https://example.com/1"]
      });

      const article2 = buildPayload({
        articleId: "article-002",
        sourceVersionId: "v1",
        syndicationId: null,
        originatingReportId: "report-002",
        publisher: { publisherId: "pub-2", displayName: "Source B", tier: "secondary" },
        title: "Solana DeFi Protocol Launches New Feature",
        factualSummary: "A new feature was launched on the Solana blockchain.",
        extractedClaims: ["Feature launched on Solana", "DeFi protocol announced"],
        sourceReferences: ["https://example.com/2"]
      });

      const input1 = buildClusterInput([], [article1, article2]);
      const input2 = buildClusterInput([], [article2, article1]);

      const [result1, result2] = await Promise.all([
        clusterNewsEvidence(input1),
        clusterNewsEvidence(input2)
      ]);

      const sorted1 = [...result1].sort((a, b) => a.articleId.localeCompare(b.articleId));
      const sorted2 = [...result2].sort((a, b) => a.articleId.localeCompare(b.articleId));

      expect(sorted1.map((r) => r.clusterId)).toEqual(sorted2.map((r) => r.clusterId));
      expect(sorted1.map((r) => r.corroborationState)).toEqual(
        sorted2.map((r) => r.corroborationState)
      );
    });
  });

  describe("corroboration", () => {
    it("independent publishers with distinct originating reports corroborate", async () => {
      const article1 = buildPayload({
        articleId: "article-001",
        sourceVersionId: "v1",
        syndicationId: null,
        originatingReportId: "report-001",
        publisher: { publisherId: "pub-1", displayName: "Source A", tier: "primary" },
        title: "Major Protocol Update Deployed on Solana Blockchain",
        factualSummary: "A major protocol update was deployed on the Solana blockchain today.",
        extractedClaims: [
          "Major protocol update deployed on Solana",
          "Hundreds of early adopters have already migrated"
        ],
        sourceReferences: ["https://example.com/1"]
      });

      const article2 = buildPayload({
        articleId: "article-002",
        sourceVersionId: "v1",
        syndicationId: null,
        originatingReportId: "report-002",
        publisher: { publisherId: "pub-2", displayName: "Source B", tier: "secondary" },
        title: "Major Protocol Update Deployed on Solana Blockchain",
        factualSummary: "A major protocol update was deployed on the Solana blockchain today.",
        extractedClaims: [
          "Major protocol update deployed on Solana",
          "Hundreds of early adopters have already migrated"
        ],
        sourceReferences: ["https://example.com/2"]
      });

      const input = buildClusterInput([], [article1, article2]);
      const result = await clusterNewsEvidence(input);

      expect(result).toHaveLength(2);
      const clusterIds = new Set(result.map((r) => r.clusterId));
      expect(clusterIds).toHaveLength(1);

      const corroborationStates = new Set(result.map((r) => r.corroborationState));
      expect(corroborationStates).toContain("independently_corroborated");

      const allRefs = result.flatMap((r) => r.sourceReferences).sort();
      expect(allRefs).toEqual(["https://example.com/1", "https://example.com/2"]);
    });

    it("corroboration requires distinct publisher AND originating report pairs", async () => {
      const article1 = buildPayload({
        articleId: "article-001",
        sourceVersionId: "v1",
        syndicationId: null,
        originatingReportId: "report-001",
        publisher: { publisherId: "pub-1", displayName: "Source A", tier: "primary" },
        title: "Solana DeFi Protocol Launches New Feature",
        factualSummary: "A DeFi protocol on Solana has launched a new feature.",
        extractedClaims: ["New feature launched on Solana DeFi"],
        sourceReferences: ["https://example.com/1"]
      });

      const article2 = buildPayload({
        articleId: "article-002",
        sourceVersionId: "v2",
        syndicationId: null,
        originatingReportId: "report-001",
        publisher: { publisherId: "pub-1", displayName: "Source A", tier: "primary" },
        title: "Solana DeFi Protocol Launches New Feature",
        factualSummary: "A DeFi protocol on Solana has launched a new feature.",
        extractedClaims: ["New feature launched on Solana DeFi"],
        sourceReferences: ["https://example.com/2"]
      });

      const input = buildClusterInput([], [article1, article2]);
      const result = await clusterNewsEvidence(input);

      expect(result).toHaveLength(2);
      expect(result.every((r) => r.corroborationState === "single_source")).toBe(true);
    });
  });

  describe("conflicts", () => {
    it("conflicting reports remain visible as conflicting evidence", async () => {
      const article1 = buildPayload({
        articleId: "article-001",
        sourceVersionId: "v1",
        syndicationId: null,
        originatingReportId: "report-001",
        publisher: { publisherId: "pub-1", displayName: "Source A", tier: "primary" },
        title: "Solana Price Update",
        factualSummary: "According to Source A, Solana is now trading at $100.",
        extractedClaims: ["Solana price is $100", "High trading volume reported"],
        sourceReferences: ["https://example.com/a"]
      });

      const article2 = buildPayload({
        articleId: "article-002",
        sourceVersionId: "v1",
        syndicationId: null,
        originatingReportId: "report-002",
        publisher: { publisherId: "pub-2", displayName: "Source B", tier: "primary" },
        title: "Solana Price Update",
        factualSummary: "According to Source B, Solana is now trading at $95.",
        extractedClaims: ["Solana price is $95", "High trading volume reported"],
        sourceReferences: ["https://example.com/b"]
      });

      const input = buildClusterInput([], [article1, article2]);
      const result = await clusterNewsEvidence(input);

      expect(result).toHaveLength(2);
      const clusterIds = new Set(result.map((r) => r.clusterId));
      expect(clusterIds).toHaveLength(1);

      const hasConflicting = result.some((r) => r.corroborationState === "conflicting");
      expect(hasConflicting).toBe(true);

      const hasSourceDisagreement = result.some((r) => r.warnings.includes("source_disagreement"));
      expect(hasSourceDisagreement).toBe(true);

      const claims = result.flatMap((r) => r.extractedClaims);
      expect(claims).toContain("Solana price is $100");
      expect(claims).toContain("Solana price is $95");
    });
  });

  describe("corrections", () => {
    it("correction appends a linked version without overwriting history", async () => {
      const original = buildPayload({
        articleId: "article-001",
        sourceVersionId: "v1",
        syndicationId: null,
        originatingReportId: "report-001",
        publisher: { publisherId: "pub-1", displayName: "Source", tier: "primary" },
        title: "Solana Price at $100",
        factualSummary: "Solana was trading at $100.",
        extractedClaims: ["Solana was at $100"],
        sourceReferences: ["https://example.com/v1"]
      });

      const correction = buildPayload({
        articleId: "article-001",
        sourceVersionId: "v2",
        syndicationId: null,
        correctsSourceVersionId: "v1",
        originatingReportId: "report-002",
        publisher: { publisherId: "pub-1", displayName: "Source", tier: "primary" },
        title: "Solana Price at $105",
        factualSummary: "Solana is now trading at $105.",
        extractedClaims: ["Solana is now at $105"],
        sourceReferences: ["https://example.com/v2"]
      });

      const input = buildClusterInput([], [original, correction]);
      const result = await clusterNewsEvidence(input);

      expect(result).toHaveLength(2);

      const originalResult = result.find((r) => r.sourceVersionId === "v1");
      expect(originalResult).toBeDefined();
      expect(originalResult!.correctsSourceVersionId).toBeNull();

      const correctionResult = result.find((r) => r.sourceVersionId === "v2");
      expect(correctionResult).toBeDefined();
      expect(correctionResult!.correctsSourceVersionId).toBe("v1");

      expect(originalResult!.clusterId).toBe(correctionResult!.clusterId);
    });

    it("corrections inherit the corrected record's cluster even when the corrected title changes", async () => {
      const original = buildPayload({
        articleId: "article-001",
        sourceVersionId: "v1",
        syndicationId: null,
        originatingReportId: "report-001",
        publisher: { publisherId: "pub-1", displayName: "Source", tier: "primary" },
        title: "Solana Price at $100",
        factualSummary: "Solana was trading at $100.",
        extractedClaims: ["Solana was at $100"],
        sourceReferences: ["https://example.com/v1"]
      });

      const correction = buildPayload({
        articleId: "article-001",
        sourceVersionId: "v2",
        syndicationId: null,
        correctsSourceVersionId: "v1",
        originatingReportId: "report-002",
        publisher: { publisherId: "pub-1", displayName: "Source", tier: "primary" },
        title: "Breaking: Solana Price Change to $105",
        factualSummary: "Solana is now trading at $105.",
        extractedClaims: ["Solana is now at $105", "Price change confirmed"],
        sourceReferences: ["https://example.com/v2"]
      });

      const input = buildClusterInput([], [original, correction]);
      const result = await clusterNewsEvidence(input);

      expect(result).toHaveLength(2);
      expect(result[0]!.clusterId).toBe(result[1]!.clusterId);

      const clusterIds = new Set(result.map((r) => r.clusterId));
      expect(clusterIds).toHaveLength(1);
    });
  });

  describe("threshold boundaries", () => {
    it("does not cluster at 0.79 Jaccard similarity (below threshold)", async () => {
      const article1 = buildPayload({
        articleId: "article-001",
        sourceVersionId: "v1",
        syndicationId: null,
        originatingReportId: "report-001",
        publisher: { publisherId: "pub-1", displayName: "Source A", tier: "primary" },
        title:
          "Solana blockchain network experienced major outage today causing significant disruption",
        factualSummary:
          "The Solana blockchain experienced a significant outage affecting thousands of users.",
        extractedClaims: [
          "Solana experienced outage",
          "Network disruption occurred",
          "Users affected globally"
        ],
        sourceReferences: ["https://example.com/1"]
      });

      const article2 = buildPayload({
        articleId: "article-002",
        sourceVersionId: "v1",
        syndicationId: null,
        originatingReportId: "report-002",
        publisher: { publisherId: "pub-2", displayName: "Source B", tier: "secondary" },
        title: "Ethereum network shows increased transaction volume amid market activity",
        factualSummary: "The Ethereum blockchain has seen increased transaction volume recently.",
        extractedClaims: ["Ethereum shows volume increase", "Market activity rising"],
        sourceReferences: ["https://example.com/2"]
      });

      const input = buildClusterInput([], [article1, article2]);
      const result = await clusterNewsEvidence(input);

      const clusterIds = new Set(result.map((r) => r.clusterId));
      expect(clusterIds).toHaveLength(2);
    });

    it("does cluster at 0.80 Jaccard similarity (at threshold)", async () => {
      const baseTitle = "Solana blockchain experienced outage causing disruption";
      const claim1 = "Solana experienced outage";
      const claim2 = "Network disruption occurred";
      const claim3 = "Users affected";

      const article1 = buildPayload({
        articleId: "article-001",
        sourceVersionId: "v1",
        syndicationId: null,
        originatingReportId: "report-001",
        publisher: { publisherId: "pub-1", displayName: "Source A", tier: "primary" },
        title: baseTitle,
        factualSummary: "The Solana blockchain experienced a significant outage affecting users.",
        extractedClaims: [claim1, claim2, claim3],
        sourceReferences: ["https://example.com/1"]
      });

      const article2 = buildPayload({
        articleId: "article-002",
        sourceVersionId: "v1",
        syndicationId: null,
        originatingReportId: "report-002",
        publisher: { publisherId: "pub-2", displayName: "Source B", tier: "secondary" },
        title: baseTitle,
        factualSummary: "The Solana blockchain experienced a significant outage affecting users.",
        extractedClaims: [claim1, claim2, claim3],
        sourceReferences: ["https://example.com/2"]
      });

      const input = buildClusterInput([], [article1, article2]);
      const result = await clusterNewsEvidence(input);

      const clusterIds = new Set(result.map((r) => r.clusterId));
      expect(clusterIds).toHaveLength(1);
    });
  });

  describe("72-hour boundary", () => {
    it("records with 72-hour gap do not cluster via time heuristic", async () => {
      const nowMs = 1705400000000;
      const article1 = buildPayload({
        articleId: "article-001",
        sourceVersionId: "v1",
        syndicationId: null,
        originatingReportId: "report-001",
        publisher: { publisherId: "pub-1", displayName: "Source A", tier: "primary" },
        publishedAtUnixMs: nowMs - 1000 * 60 * 60 * 24,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 60 * 24,
        title: "Solana Network Update",
        factualSummary: "Solana network is operating normally.",
        extractedClaims: ["Solana operating normally"],
        sourceReferences: ["https://example.com/1"]
      });

      const article2 = buildPayload({
        articleId: "article-002",
        sourceVersionId: "v1",
        syndicationId: null,
        originatingReportId: "report-002",
        publisher: { publisherId: "pub-2", displayName: "Source B", tier: "secondary" },
        publishedAtUnixMs: nowMs - 1000 * 60 * 60 * 24 * 4,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 60 * 24 * 4,
        title: "Solana Network Update",
        factualSummary: "Solana network is operating normally.",
        extractedClaims: ["Solana operating normally"],
        sourceReferences: ["https://example.com/2"]
      });

      const input = buildClusterInput([], [article1, article2]);
      const result = await clusterNewsEvidence(input);

      const clusterIds = new Set(result.map((r) => r.clusterId));
      expect(clusterIds).toHaveLength(2);
    });

    it("records within 72-hour window can cluster via time heuristic", async () => {
      const nowMs = 1705400000000;
      const article1 = buildPayload({
        articleId: "article-001",
        sourceVersionId: "v1",
        syndicationId: null,
        originatingReportId: "report-001",
        publisher: { publisherId: "pub-1", displayName: "Source A", tier: "primary" },
        publishedAtUnixMs: nowMs - 1000 * 60 * 60 * 24,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 60 * 24,
        title: "Solana Network Update",
        factualSummary: "Solana network is operating normally.",
        extractedClaims: ["Solana operating normally"],
        sourceReferences: ["https://example.com/1"]
      });

      const article2 = buildPayload({
        articleId: "article-002",
        sourceVersionId: "v1",
        syndicationId: null,
        originatingReportId: "report-002",
        publisher: { publisherId: "pub-2", displayName: "Source B", tier: "secondary" },
        publishedAtUnixMs: nowMs - 1000 * 60 * 60 * 24 * 2,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 60 * 24 * 2,
        title: "Solana Network Update",
        factualSummary: "Solana network is operating normally.",
        extractedClaims: ["Solana operating normally"],
        sourceReferences: ["https://example.com/2"]
      });

      const input = buildClusterInput([], [article1, article2]);
      const result = await clusterNewsEvidence(input);

      const clusterIds = new Set(result.map((r) => r.clusterId));
      expect(clusterIds).toHaveLength(1);
    });
  });

  describe("affected-scope mismatch", () => {
    it("records with different affected scope do not cluster", async () => {
      const article1 = buildPayload({
        articleId: "article-001",
        sourceVersionId: "v1",
        syndicationId: null,
        originatingReportId: "report-001",
        publisher: { publisherId: "pub-1", displayName: "Source A", tier: "primary" },
        title: "Major Update Released for Jupiter DeFi Protocol on Solana",
        factualSummary: "Jupiter has released a major protocol update.",
        extractedClaims: ["Jupiter protocol updated", "New features deployed"],
        affectedAssets: ["SOL"],
        affectedProtocols: ["Jupiter"],
        affectedJurisdictions: [],
        sourceReferences: ["https://example.com/1"]
      });

      const article2 = buildPayload({
        articleId: "article-002",
        sourceVersionId: "v1",
        syndicationId: null,
        originatingReportId: "report-002",
        publisher: { publisherId: "pub-2", displayName: "Source B", tier: "secondary" },
        title: "Raydium Announces Major Protocol Upgrade on Solana",
        factualSummary: "Raydium has announced a significant protocol upgrade.",
        extractedClaims: ["Raydium upgrade announced", "New AMM features coming"],
        affectedAssets: ["SOL", "USDC"],
        affectedProtocols: ["Jupiter", "Raydium"],
        affectedJurisdictions: ["US"],
        sourceReferences: ["https://example.com/2"]
      });

      const input = buildClusterInput([], [article1, article2]);
      const result = await clusterNewsEvidence(input);

      const clusterIds = new Set(result.map((r) => r.clusterId));
      expect(clusterIds).toHaveLength(2);
    });
  });

  describe("historical records", () => {
    it("incoming records cluster with historical records", async () => {
      const historical = buildPayload({
        articleId: "article-001",
        sourceVersionId: "v1",
        syndicationId: null,
        originatingReportId: "report-001",
        publisher: { publisherId: "pub-1", displayName: "Source A", tier: "primary" },
        title: "Solana Price Update",
        factualSummary: "Solana price information.",
        extractedClaims: ["Solana price"],
        sourceReferences: ["https://example.com/1"]
      });

      const incoming = buildPayload({
        articleId: "article-002",
        sourceVersionId: "v1",
        syndicationId: null,
        originatingReportId: "report-002",
        publisher: { publisherId: "pub-2", displayName: "Source B", tier: "secondary" },
        title: "Solana Price Update",
        factualSummary: "Solana price information.",
        extractedClaims: ["Solana price"],
        sourceReferences: ["https://example.com/2"]
      });

      const input = buildClusterInput([historical], [incoming]);
      const result = await clusterNewsEvidence(input);

      expect(result).toHaveLength(2);
      const clusterIds = new Set(result.map((r) => r.clusterId));
      expect(clusterIds).toHaveLength(1);
    });

    it("does not mutate historical payloads", async () => {
      const historical = buildPayload({
        articleId: "article-001",
        sourceVersionId: "v1",
        syndicationId: null,
        originatingReportId: "report-001",
        publisher: { publisherId: "pub-1", displayName: "Source A", tier: "primary" },
        title: "Solana Price Update",
        factualSummary: "Solana price information.",
        extractedClaims: ["Solana price"],
        sourceReferences: ["https://example.com/1"]
      });

      const historicalClusterIdBefore = historical.clusterId;

      const incoming = buildPayload({
        articleId: "article-002",
        sourceVersionId: "v1",
        syndicationId: null,
        originatingReportId: "report-002",
        publisher: { publisherId: "pub-2", displayName: "Source B", tier: "secondary" },
        title: "Solana Price Update",
        factualSummary: "Solana price information.",
        extractedClaims: ["Solana price"],
        sourceReferences: ["https://example.com/2"]
      });

      await clusterNewsEvidence({ historical: [historical], incoming: [incoming] });

      expect(historical.clusterId).toBe(historicalClusterIdBefore);
    });
  });
});
