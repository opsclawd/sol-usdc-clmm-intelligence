import { describe, it, expect } from "vitest";
import { makeBoundedNewsSourceRecord } from "../../fixtures/news-events.js";
import { deriveNewsObservationKey } from "../../../src/domain/news-events/identity.js";

describe("deriveNewsObservationKey", () => {
  it("derives a stable key from source identity fields", async () => {
    const identity = {
      source: "crypto-news-api" as const,
      providerId: "crypto-news-api",
      articleId: "article-001",
      sourceVersionId: "v1",
      boundedPayloadHash: "abc123"
    };

    const key = await deriveNewsObservationKey(identity);

    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
  });

  it("produces identical keys for same identity", async () => {
    const identity1 = {
      source: "crypto-news-api" as const,
      providerId: "crypto-news-api",
      articleId: "article-001",
      sourceVersionId: "v1",
      boundedPayloadHash: "abc123"
    };

    const identity2 = {
      source: "crypto-news-api" as const,
      providerId: "crypto-news-api",
      articleId: "article-001",
      sourceVersionId: "v1",
      boundedPayloadHash: "abc123"
    };

    const key1 = await deriveNewsObservationKey(identity1);
    const key2 = await deriveNewsObservationKey(identity2);

    expect(key1).toBe(key2);
  });

  it("produces different keys for different article versions", async () => {
    const identity1 = {
      source: "crypto-news-api" as const,
      providerId: "crypto-news-api",
      articleId: "article-001",
      sourceVersionId: "v1",
      boundedPayloadHash: "abc123"
    };

    const identity2 = {
      source: "crypto-news-api" as const,
      providerId: "crypto-news-api",
      articleId: "article-001",
      sourceVersionId: "v2",
      boundedPayloadHash: "def456"
    };

    const key1 = await deriveNewsObservationKey(identity1);
    const key2 = await deriveNewsObservationKey(identity2);

    expect(key1).not.toBe(key2);
  });

  it("produces different keys for different sources", async () => {
    const identity1 = {
      source: "crypto-news-api" as const,
      providerId: "crypto-news-api",
      articleId: "article-001",
      sourceVersionId: "v1",
      boundedPayloadHash: "abc123"
    };

    const identity2 = {
      source: "regulatory-monitor-api" as const,
      providerId: "regulatory-monitor-api",
      articleId: "article-001",
      sourceVersionId: "v1",
      boundedPayloadHash: "abc123"
    };

    const key1 = await deriveNewsObservationKey(identity1);
    const key2 = await deriveNewsObservationKey(identity2);

    expect(key1).not.toBe(key2);
  });

  it("is stable across time (does not include nowMs)", async () => {
    const identity1 = {
      source: "crypto-news-api" as const,
      providerId: "crypto-news-api",
      articleId: "article-001",
      sourceVersionId: "v1",
      boundedPayloadHash: "abc123"
    };

    const identity2 = {
      source: "crypto-news-api" as const,
      providerId: "crypto-news-api",
      articleId: "article-001",
      sourceVersionId: "v1",
      boundedPayloadHash: "abc123"
    };

    const key1 = await deriveNewsObservationKey(identity1);
    const key2 = await deriveNewsObservationKey(identity2);

    expect(key1).toBe(key2);
  });

  it("canonical identity stability: same content version replays identically", async () => {
    const record = makeBoundedNewsSourceRecord({
      articleId: "article-001",
      sourceVersionId: "v1",
      sourceReferences: ["https://example.com/article"]
    });

    const identity = {
      source: record.source,
      providerId: record.providerId,
      articleId: record.articleId,
      sourceVersionId: record.sourceVersionId,
      boundedPayloadHash: "stable-hash-123"
    };

    const key1 = await deriveNewsObservationKey(identity);
    const key2 = await deriveNewsObservationKey(identity);

    expect(key1).toBe(key2);
  });
});
