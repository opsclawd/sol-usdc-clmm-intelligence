import { describe, it, expect } from "vitest";
import {
  makeBoundedNewsSourceRecord,
  makeRegulatoryRiskRecord,
  makeLongString,
  makeRecordWithLongSummary,
  makeRecordWithManyClaims,
  makeRecordWithManyTags,
  makeRecordWithManyReferences,
  makeRecordWithManyAffectedScope,
  makeRecordWithDuplicateTags,
  makeCorrectionRecord
} from "../../fixtures/news-events.js";
import { acceptBoundedNewsRecord } from "../../../src/domain/news-events/validate.js";

describe("acceptBoundedNewsRecord", () => {
  describe("bounded-retention", () => {
    it("accepts a compliant bounded ecosystem news record", () => {
      const record = makeBoundedNewsSourceRecord({
        sourceReferences: ["https://example.com/article"]
      });

      const result = acceptBoundedNewsRecord(record);

      expect(result.articleId).toBe("article-001");
      expect(result.source).toBe("crypto-news-api");
      expect(result.rawProvenance.retentionMode).toBe("bounded_factual_extract");
    });

    it("rejects retention when robots or terms disallow bounded extracts", () => {
      const recordWithRobotsDisallowed = makeBoundedNewsSourceRecord({
        robotsAllowed: false,
        termsAllowRetention: true
      });

      const recordWithTermsDisallowed = makeBoundedNewsSourceRecord({
        robotsAllowed: true,
        termsAllowRetention: false
      });

      expect(() => acceptBoundedNewsRecord(recordWithRobotsDisallowed)).toThrow();
      expect(() => acceptBoundedNewsRecord(recordWithTermsDisallowed)).toThrow();
    });

    it("rejects content that cannot be traced to an https source reference", () => {
      const recordWithHttpOnly = makeBoundedNewsSourceRecord({
        sourceReferences: ["http://example.com/article"]
      });

      expect(() => acceptBoundedNewsRecord(recordWithHttpOnly)).toThrow();
    });

    it("rejects empty source references", () => {
      const recordWithEmptyRefs = makeBoundedNewsSourceRecord({
        sourceReferences: []
      });

      expect(() => acceptBoundedNewsRecord(recordWithEmptyRefs)).toThrow();
    });

    it("rejects relative source references", () => {
      const recordWithRelativeRef = makeBoundedNewsSourceRecord({
        sourceReferences: ["/relative/path/article"]
      });

      expect(() => acceptBoundedNewsRecord(recordWithRelativeRef)).toThrow();
    });

    it("accepts regulatory risk record with jurisdiction", () => {
      const record = makeRegulatoryRiskRecord({
        sourceReferences: ["https://sec.gov/announcement"]
      });

      const result = acceptBoundedNewsRecord(record);

      expect(result.evidenceKind).toBe("regulatory_risk");
      expect(result.affectedJurisdictions).toContain("US");
    });

    it("does not retain arbitrary extra fields from the input", () => {
      const record = makeBoundedNewsSourceRecord({
        extraField: "should not be retained",
        sourceReferences: ["https://example.com/article"]
      });

      const result = acceptBoundedNewsRecord(record);

      expect((result as unknown as Record<string, unknown>).extraField).toBeUndefined();
    });

    it("rejects records with prohibited long-form fields (body, content, html)", () => {
      const recordWithBody = makeBoundedNewsSourceRecord({
        body: "This is the full article body that should be rejected.",
        sourceReferences: ["https://example.com/article"]
      });

      const recordWithContent = makeBoundedNewsSourceRecord({
        content: "This is the full article content that should be rejected.",
        sourceReferences: ["https://example.com/article"]
      });

      const recordWithHtml = makeBoundedNewsSourceRecord({
        html: "<html><body>This is the full article HTML that should be rejected.</body></html>",
        sourceReferences: ["https://example.com/article"]
      });

      expect(() => acceptBoundedNewsRecord(recordWithBody)).toThrow();
      expect(() => acceptBoundedNewsRecord(recordWithContent)).toThrow();
      expect(() => acceptBoundedNewsRecord(recordWithHtml)).toThrow();
    });
  });

  describe("length-and-count-bounds", () => {
    it("caps factual summary at 1000 characters", () => {
      const record = makeRecordWithLongSummary(1500, {
        sourceReferences: ["https://example.com/article"]
      });

      const result = acceptBoundedNewsRecord(record);

      expect(result.factualSummary.length).toBeLessThanOrEqual(1000);
    });

    it("rejects extracted claims exceeding 500 characters each", () => {
      const longClaim = makeLongString(501);
      const record = makeBoundedNewsSourceRecord({
        extractedClaims: [longClaim],
        sourceReferences: ["https://example.com/article"]
      });

      expect(() => acceptBoundedNewsRecord(record)).toThrow();
    });

    it("rejects more than 10 extracted claims", () => {
      const record = makeRecordWithManyClaims(15, {
        sourceReferences: ["https://example.com/article"]
      });

      expect(() => acceptBoundedNewsRecord(record)).toThrow();
    });

    it("rejects more than 20 topic tags", () => {
      const record = makeRecordWithManyTags(25, {
        sourceReferences: ["https://example.com/article"]
      });

      expect(() => acceptBoundedNewsRecord(record)).toThrow();
    });

    it("rejects more than 50 source references", () => {
      const record = makeRecordWithManyReferences(55, {
        sourceReferences: Array.from({ length: 55 }, (_, i) => `https://example.com/source${i}`)
      });

      expect(() => acceptBoundedNewsRecord(record)).toThrow();
    });

    it("rejects more than 100 total affected assets/protocols/jurisdictions", () => {
      const record = makeRecordWithManyAffectedScope({
        sourceReferences: ["https://example.com/article"]
      });

      expect(() => acceptBoundedNewsRecord(record)).toThrow();
    });
  });

  describe("timestamp-ordering", () => {
    it("rejects sourceUpdatedAt that precedes publishedAt", () => {
      const record = makeBoundedNewsSourceRecord({
        publishedAtUnixMs: 1705390000000,
        sourceUpdatedAtUnixMs: 1705380000000,
        sourceReferences: ["https://example.com/article"]
      });

      expect(() => acceptBoundedNewsRecord(record)).toThrow();
    });

    it("rejects non-finite timestamps", () => {
      const recordWithNaN = makeBoundedNewsSourceRecord({
        publishedAtUnixMs: NaN,
        sourceReferences: ["https://example.com/article"]
      });

      const recordWithInfinity = makeBoundedNewsSourceRecord({
        publishedAtUnixMs: Infinity,
        sourceReferences: ["https://example.com/article"]
      });

      expect(() => acceptBoundedNewsRecord(recordWithNaN)).toThrow();
      expect(() => acceptBoundedNewsRecord(recordWithInfinity)).toThrow();
    });

    it("accepts null publishedAt when retrievedAt is present", () => {
      const record = makeBoundedNewsSourceRecord({
        publishedAtUnixMs: null,
        retrievedAtUnixMs: 1705400000000,
        sourceReferences: ["https://example.com/article"]
      });

      const result = acceptBoundedNewsRecord(record);

      expect(result.publishedAtUnixMs).toBeNull();
    });
  });

  describe("deduplication-and-sorting", () => {
    it("sorts and deduplicates topic tags", () => {
      const record = makeRecordWithDuplicateTags({
        sourceReferences: ["https://example.com/article"]
      });

      const result = acceptBoundedNewsRecord(record);

      const sortedTags = [...result.topicTags].sort();
      expect(result.topicTags).toEqual(sortedTags);
      const uniqueTags = [...new Set(result.topicTags)];
      expect(result.topicTags).toEqual(uniqueTags);
    });
  });

  describe("correction-validation", () => {
    it("accepts a correction record with correct self-link", () => {
      const record = makeCorrectionRecord({
        sourceReferences: ["https://example.com/article-v2"]
      });

      const result = acceptBoundedNewsRecord(record);

      expect(result.correctsSourceVersionId).toBe("v1");
      expect(result.sourceVersionId).toBe("v2");
    });

    it("accepts a correction even when the corrected version does not exist (validated at cluster time)", () => {
      const record = makeCorrectionRecord({
        sourceReferences: ["https://example.com/article-v2"],
        correctsSourceVersionId: "non-existent-version"
      });

      const result = acceptBoundedNewsRecord(record);

      expect(result.correctsSourceVersionId).toBe("non-existent-version");
    });
  });

  describe("regulatory-jurisdictions", () => {
    it("accepts regulatory risk record with jurisdictions", () => {
      const record = makeRegulatoryRiskRecord({
        sourceReferences: ["https://regulator.gov/announcement"]
      });

      const result = acceptBoundedNewsRecord(record);

      expect(result.evidenceKind).toBe("regulatory_risk");
      expect(result.affectedJurisdictions.length).toBeGreaterThan(0);
    });

    it("requires at least one jurisdiction for regulatory risk", () => {
      const record = makeRegulatoryRiskRecord({
        affectedJurisdictions: [],
        sourceReferences: ["https://regulator.gov/announcement"]
      });

      expect(() => acceptBoundedNewsRecord(record)).toThrow();
    });
  });

  describe("family-source-matching", () => {
    it("maps crypto-news-api to ecosystem_news", () => {
      const record = makeBoundedNewsSourceRecord({
        source: "crypto-news-api",
        sourceReferences: ["https://example.com/article"]
      });

      const result = acceptBoundedNewsRecord(record);

      expect(result.evidenceKind).toBe("ecosystem_news");
    });

    it("maps regulatory-monitor-api to regulatory_risk", () => {
      const record = makeRegulatoryRiskRecord({
        sourceReferences: ["https://regulator.gov/announcement"]
      });

      const result = acceptBoundedNewsRecord(record);

      expect(result.evidenceKind).toBe("regulatory_risk");
    });
  });

  describe("secret-free-payloads", () => {
    it("rejects records with API keys or secrets in fields", () => {
      const recordWithSecret = makeBoundedNewsSourceRecord({
        title: "Article with secret: sk-1234567890abcdef",
        sourceReferences: ["https://example.com/article"]
      });

      expect(() => acceptBoundedNewsRecord(recordWithSecret)).toThrow();
    });
  });
});
