import { describe, it, expect } from "vitest";
import type {
  NewsCorroborationState,
  NewsPayloadV1,
  RegulatoryPayloadV1,
  NewsEvidencePayload,
  NewsPublisher,
  NewsSourceQuality,
  NewsRawProvenance
} from "../../src/contracts/news-events.js";

function makePublisher(overrides?: Partial<NewsPublisher>): NewsPublisher {
  return {
    publisherId: "test-publisher",
    displayName: "Test Publisher",
    tier: "primary",
    ...overrides
  };
}

function makeSourceQuality(overrides?: Partial<NewsSourceQuality>): NewsSourceQuality {
  return {
    providerId: "crypto-news-api",
    reliability: 0.85,
    completeness: "complete",
    confirmation: "confirmed",
    isPaywalled: false,
    ...overrides
  };
}

function makeRawProvenance(overrides?: Partial<NewsRawProvenance>): NewsRawProvenance {
  return {
    retrievedAtUnixMs: 1700000001000,
    license: "CC0-1.0",
    retentionMode: "bounded_factual_extract",
    robotsCompliance: true,
    termsAccepted: true,
    ...overrides
  };
}

function makeNewsPayloadV1(overrides?: Partial<NewsPayloadV1>): NewsPayloadV1 {
  const now = Date.now();
  return {
    evidenceKind: "ecosystem_news",
    articleId: "article-001",
    sourceVersionId: "v1-abc123",
    correctsSourceVersionId: null,
    clusterId: "cluster-001",
    title: "Test Article Title",
    factualSummary: "A test article summary of factual information.",
    extractedClaims: ["claim1", "claim2"],
    topicTags: ["solana", "defi"],
    publishedAtUnixMs: now - 3600000,
    sourceUpdatedAtUnixMs: null,
    retrievedAtUnixMs: now,
    asOfUnixMs: now,
    expiresAtUnixMs: now + 86400000,
    publisher: makePublisher(),
    sourceQuality: makeSourceQuality(),
    corroborationState: "single_source",
    originatingReportId: "report-001",
    syndicationId: null,
    affectedAssets: ["SOL"],
    affectedProtocols: ["Solana"],
    affectedJurisdictions: ["US"],
    sourceReferences: ["https://example.com/article"],
    rawProvenance: makeRawProvenance(),
    warnings: [],
    ...overrides
  };
}

function makeRegulatoryPayloadV1(overrides?: Partial<RegulatoryPayloadV1>): RegulatoryPayloadV1 {
  const now = Date.now();
  return {
    evidenceKind: "regulatory_risk",
    articleId: "reg-article-001",
    sourceVersionId: "v1-xyz789",
    correctsSourceVersionId: null,
    clusterId: "cluster-reg-001",
    title: "SEC Issues New Crypto Guidance",
    factualSummary: "The SEC has issued new guidance on cryptocurrency regulations.",
    extractedClaims: ["claim1"],
    topicTags: ["regulation", "sec"],
    publishedAtUnixMs: now - 7200000,
    sourceUpdatedAtUnixMs: null,
    retrievedAtUnixMs: now,
    asOfUnixMs: now,
    expiresAtUnixMs: now + 86400000,
    publisher: makePublisher({ publisherId: "regulatory-monitor" }),
    sourceQuality: makeSourceQuality({ providerId: "regulatory-monitor-api" }),
    corroborationState: "independently_corroborated",
    originatingReportId: "reg-report-001",
    syndicationId: null,
    affectedAssets: ["SOL"],
    affectedProtocols: [],
    affectedJurisdictions: ["US"],
    sourceReferences: ["https://sec.gov/guidance"],
    rawProvenance: makeRawProvenance(),
    warnings: [],
    ...overrides
  };
}

describe("NewsEvidenceKind", () => {
  it("accepts ecosystem_news as valid evidence kind", () => {
    const payload = makeNewsPayloadV1();
    expect(payload.evidenceKind).toBe("ecosystem_news");
  });

  it("accepts regulatory_risk as valid evidence kind", () => {
    const payload = makeRegulatoryPayloadV1();
    expect(payload.evidenceKind).toBe("regulatory_risk");
  });
});

describe("NewsPayloadV1", () => {
  it("has evidenceKind set to ecosystem_news", () => {
    const payload = makeNewsPayloadV1();
    expect(payload.evidenceKind).toBe("ecosystem_news");
  });

  it("exposes articleId, sourceVersionId, and clusterId", () => {
    const payload = makeNewsPayloadV1({
      articleId: "article-xyz",
      sourceVersionId: "v2-def456",
      clusterId: "cluster-xyz"
    });
    expect(payload.articleId).toBe("article-xyz");
    expect(payload.sourceVersionId).toBe("v2-def456");
    expect(payload.clusterId).toBe("cluster-xyz");
  });

  it("exposes title, factualSummary, and extractedClaims", () => {
    const payload = makeNewsPayloadV1({
      title: "Breaking: Major DeFi Protocol Launches",
      factualSummary: "A major DeFi protocol announced a new feature.",
      extractedClaims: ["claim-a", "claim-b", "claim-c"]
    });
    expect(payload.title).toBe("Breaking: Major DeFi Protocol Launches");
    expect(payload.factualSummary).toBe("A major DeFi protocol announced a new feature.");
    expect(payload.extractedClaims).toEqual(["claim-a", "claim-b", "claim-c"]);
  });

  it("exposes topicTags as readonly array", () => {
    const payload = makeNewsPayloadV1({ topicTags: ["solana", "nft", "gaming"] });
    expect(payload.topicTags).toBeInstanceOf(Array);
    expect(Array.isArray(payload.topicTags)).toBe(true);
  });

  it("exposes publisher with stable ID and display name", () => {
    const payload = makeNewsPayloadV1({
      publisher: makePublisher({ publisherId: "news-co", displayName: "News Co." })
    });
    expect(payload.publisher.publisherId).toBe("news-co");
    expect(payload.publisher.displayName).toBe("News Co.");
  });

  it("exposes sourceQuality with reliability in [0,1]", () => {
    const payload = makeNewsPayloadV1({
      sourceQuality: makeSourceQuality({ reliability: 0.92 })
    });
    expect(payload.sourceQuality.reliability).toBe(0.92);
    expect(payload.sourceQuality.reliability).toBeGreaterThanOrEqual(0);
    expect(payload.sourceQuality.reliability).toBeLessThanOrEqual(1);
  });

  it("exposes corroborationState as valid state", () => {
    const states: NewsCorroborationState[] = [
      "unconfirmed",
      "single_source",
      "independently_corroborated",
      "conflicting"
    ];
    for (const state of states) {
      const payload = makeNewsPayloadV1({ corroborationState: state });
      expect(payload.corroborationState).toBe(state);
    }
  });

  it("exposes sourceReferences with HTTPS URLs", () => {
    const payload = makeNewsPayloadV1({
      sourceReferences: ["https://example.com/article1", "https://example.com/article2"]
    });
    expect(payload.sourceReferences).toHaveLength(2);
    expect(payload.sourceReferences[0]?.startsWith("https://")).toBe(true);
  });

  it("exposes rawProvenance with bounded retention and robots flag", () => {
    const payload = makeNewsPayloadV1({
      rawProvenance: makeRawProvenance({
        retentionMode: "bounded_factual_extract",
        robotsCompliance: true
      })
    });
    expect(payload.rawProvenance.retentionMode).toBe("bounded_factual_extract");
    expect(payload.rawProvenance.robotsCompliance).toBe(true);
  });

  it("exposes warnings as readonly array of valid warning types", () => {
    const payload = makeNewsPayloadV1({
      warnings: ["unconfirmed_claim", "paywalled_material"]
    });
    expect(payload.warnings).toEqual(["unconfirmed_claim", "paywalled_material"]);
  });

  it("exposes affectedAssets, affectedProtocols, and affectedJurisdictions", () => {
    const payload = makeNewsPayloadV1({
      affectedAssets: ["SOL", "ETH"],
      affectedProtocols: ["Solana", "Ethereum"],
      affectedJurisdictions: ["US", "EU"]
    });
    expect(payload.affectedAssets).toEqual(["SOL", "ETH"]);
    expect(payload.affectedProtocols).toEqual(["Solana", "Ethereum"]);
    expect(payload.affectedJurisdictions).toEqual(["US", "EU"]);
  });

  it("exposes originatingReportId and syndicationId", () => {
    const payload = makeNewsPayloadV1({
      originatingReportId: "orig-report",
      syndicationId: "syn-123"
    });
    expect(payload.originatingReportId).toBe("orig-report");
    expect(payload.syndicationId).toBe("syn-123");
  });

  it("correctsSourceVersionId is null when not correcting", () => {
    const payload = makeNewsPayloadV1({ correctsSourceVersionId: null });
    expect(payload.correctsSourceVersionId).toBeNull();
  });

  it("correctsSourceVersionId is set when correcting prior version", () => {
    const payload = makeNewsPayloadV1({ correctsSourceVersionId: "v1-old-version" });
    expect(payload.correctsSourceVersionId).toBe("v1-old-version");
  });
});

describe("RegulatoryPayloadV1", () => {
  it("extends NewsPayloadV1 with evidenceKind regulatory_risk", () => {
    const payload = makeRegulatoryPayloadV1();
    expect(payload.evidenceKind).toBe("regulatory_risk");
  });

  it("has same structural shape as NewsPayloadV1", () => {
    const newsPayload = makeNewsPayloadV1();
    const regPayload = makeRegulatoryPayloadV1();

    expect(typeof regPayload.articleId).toBe(typeof newsPayload.articleId);
    expect(typeof regPayload.title).toBe(typeof newsPayload.title);
    expect(typeof regPayload.factualSummary).toBe(typeof newsPayload.factualSummary);
    expect(regPayload.sourceReferences).toBeInstanceOf(Array);
    expect(regPayload.affectedAssets).toBeInstanceOf(Array);
  });
});

describe("NewsEvidencePayload union", () => {
  it("accepts NewsPayloadV1 as valid payload", () => {
    const payload: NewsEvidencePayload = makeNewsPayloadV1();
    expect(payload.evidenceKind).toBe("ecosystem_news");
  });

  it("accepts RegulatoryPayloadV1 as valid payload", () => {
    const payload: NewsEvidencePayload = makeRegulatoryPayloadV1();
    expect(payload.evidenceKind).toBe("regulatory_risk");
  });
});

describe("bounded source linked contract", () => {
  it("accepts a source-linked bounded ecosystem news record", () => {
    const payload = makeNewsPayloadV1({
      sourceReferences: ["https://example.com/verified-article"],
      rawProvenance: makeRawProvenance({
        retentionMode: "bounded_factual_extract",
        robotsCompliance: true,
        termsAccepted: true
      })
    });

    expect(payload.evidenceKind).toBe("ecosystem_news");
    expect(payload.sourceReferences.length).toBeGreaterThan(0);
    expect(payload.sourceReferences[0]?.startsWith("https://")).toBe(true);

    expect((payload as unknown as Record<string, unknown>).direction).toBeUndefined();
    expect((payload as unknown as Record<string, unknown>).recommendation).toBeUndefined();
    expect((payload as unknown as Record<string, unknown>).sentiment).toBeUndefined();
    expect((payload as unknown as Record<string, unknown>).articleBody).toBeUndefined();
  });

  it("rejects content that cannot be traced to an https source reference", () => {
    const invalidPayload = makeNewsPayloadV1({
      sourceReferences: []
    });

    const hasHttpsSource =
      invalidPayload.sourceReferences.length > 0 &&
      invalidPayload.sourceReferences.some((ref) => ref.startsWith("https://"));

    expect(hasHttpsSource).toBe(false);
  });

  it("strict payload exposes no direction, recommendation, sentiment, or free-form article body", () => {
    const payload = makeNewsPayloadV1();
    const record = payload as unknown as Record<string, unknown>;

    expect(record.direction).toBeUndefined();
    expect(record.recommendation).toBeUndefined();
    expect(record.sentiment).toBeUndefined();
    expect(record.articleBody).toBeUndefined();
    expect(record.body).toBeUndefined();
    expect(record.content).toBeUndefined();
    expect(record.fullText).toBeUndefined();
  });
});

describe("NewsPublisher tiers", () => {
  it("accepts official tier", () => {
    const publisher = makePublisher({ tier: "official" });
    expect(publisher.tier).toBe("official");
  });

  it("accepts primary tier", () => {
    const publisher = makePublisher({ tier: "primary" });
    expect(publisher.tier).toBe("primary");
  });

  it("accepts secondary tier", () => {
    const publisher = makePublisher({ tier: "secondary" });
    expect(publisher.tier).toBe("secondary");
  });

  it("accepts aggregator tier", () => {
    const publisher = makePublisher({ tier: "aggregator" });
    expect(publisher.tier).toBe("aggregator");
  });
});

describe("NewsSourceQuality completeness and confirmation", () => {
  it("accepts complete completeness", () => {
    const sq = makeSourceQuality({ completeness: "complete" });
    expect(sq.completeness).toBe("complete");
  });

  it("accepts partial completeness", () => {
    const sq = makeSourceQuality({ completeness: "partial" });
    expect(sq.completeness).toBe("partial");
  });

  it("accepts confirmed confirmation", () => {
    const sq = makeSourceQuality({ confirmation: "confirmed" });
    expect(sq.confirmation).toBe("confirmed");
  });

  it("accepts unconfirmed confirmation", () => {
    const sq = makeSourceQuality({ confirmation: "unconfirmed" });
    expect(sq.confirmation).toBe("unconfirmed");
  });
});

describe("NewsEvidenceWarning types", () => {
  it("accepts unconfirmed_claim warning", () => {
    const payload = makeNewsPayloadV1({ warnings: ["unconfirmed_claim"] });
    expect(payload.warnings).toContain("unconfirmed_claim");
  });

  it("accepts correction warning", () => {
    const payload = makeNewsPayloadV1({ warnings: ["correction"] });
    expect(payload.warnings).toContain("correction");
  });

  it("accepts partial_material warning", () => {
    const payload = makeNewsPayloadV1({ warnings: ["partial_material"] });
    expect(payload.warnings).toContain("partial_material");
  });

  it("accepts paywalled_material warning", () => {
    const payload = makeNewsPayloadV1({ warnings: ["paywalled_material"] });
    expect(payload.warnings).toContain("paywalled_material");
  });

  it("accepts source_disagreement warning", () => {
    const payload = makeNewsPayloadV1({ warnings: ["source_disagreement"] });
    expect(payload.warnings).toContain("source_disagreement");
  });

  it("accepts stale_observation warning", () => {
    const payload = makeNewsPayloadV1({ warnings: ["stale_observation"] });
    expect(payload.warnings).toContain("stale_observation");
  });
});
