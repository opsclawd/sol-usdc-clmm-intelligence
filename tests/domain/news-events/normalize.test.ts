import { describe, it, expect } from "vitest";
import {
  makeBoundedNewsSourceRecord,
  makeRegulatoryRiskRecord
} from "../../fixtures/news-events.js";
import { acceptBoundedNewsRecord } from "../../../src/domain/news-events/validate.js";
import { normalizeNewsRecord } from "../../../src/domain/news-events/normalize.js";

describe("normalizeNewsRecord", () => {
  const nowMs = 1705400000000;

  describe("as-of-time-fallback", () => {
    it("uses publication time as asOf when present", () => {
      const rawRecord = makeBoundedNewsSourceRecord({
        publishedAtUnixMs: 1705390000000,
        retrievedAtUnixMs: 1705400000000,
        sourceReferences: ["https://example.com/article"]
      });

      const record = acceptBoundedNewsRecord(rawRecord);
      const result = normalizeNewsRecord(record, nowMs);

      expect(result.asOfUnixMs).toBe(1705390000000);
    });

    it("uses retrieval time only as fallback when publication time is absent", () => {
      const rawRecord = makeBoundedNewsSourceRecord({
        publishedAtUnixMs: null,
        retrievedAtUnixMs: 1705400000000,
        sourceReferences: ["https://example.com/article"]
      });

      const record = acceptBoundedNewsRecord(rawRecord);
      const result = normalizeNewsRecord(record, nowMs);

      expect(result.asOfUnixMs).toBe(1705400000000);
    });

    it("prefers earlier publishedAt over later retrievedAt", () => {
      const rawRecord = makeBoundedNewsSourceRecord({
        publishedAtUnixMs: 1705300000000,
        retrievedAtUnixMs: 1705400000000,
        sourceReferences: ["https://example.com/article"]
      });

      const record = acceptBoundedNewsRecord(rawRecord);
      const result = normalizeNewsRecord(record, nowMs);

      expect(result.asOfUnixMs).toBe(1705300000000);
    });
  });

  describe("family-expiry-caps", () => {
    it("caps ecosystem news expiry at 24 hours", () => {
      const rawRecord = makeBoundedNewsSourceRecord({
        publishedAtUnixMs: nowMs - 1000 * 60 * 60 * 20,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 60 * 20 + 1000,
        sourceReferences: ["https://example.com/article"]
      });

      const record = acceptBoundedNewsRecord(rawRecord);
      const result = normalizeNewsRecord(record, nowMs);

      const maxExpiry = 24 * 60 * 60 * 1000;
      expect(result.expiresAtUnixMs - result.asOfUnixMs).toBeLessThanOrEqual(maxExpiry);
    });

    it("provider expiry can shorten but cannot extend ecosystem news cap", () => {
      const rawRecord = makeBoundedNewsSourceRecord({
        publishedAtUnixMs: nowMs - 1000 * 60 * 60 * 20,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 60 * 20 + 1000,
        sourceReferences: ["https://example.com/article"]
      });

      const record = acceptBoundedNewsRecord(rawRecord);
      const result = normalizeNewsRecord(record, nowMs);

      const maxExpiry = 24 * 60 * 60 * 1000;
      const actualAge = result.expiresAtUnixMs - result.asOfUnixMs;
      expect(actualAge).toBeLessThanOrEqual(maxExpiry);
    });

    it("caps regulatory risk expiry at 72 hours", () => {
      const rawRecord = makeRegulatoryRiskRecord({
        publishedAtUnixMs: nowMs - 1000 * 60 * 60 * 48,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 60 * 48 + 1000,
        sourceReferences: ["https://regulator.gov/announcement"]
      });

      const record = acceptBoundedNewsRecord(rawRecord);
      const result = normalizeNewsRecord(record, nowMs);

      const maxExpiry = 72 * 60 * 60 * 1000;
      expect(result.expiresAtUnixMs - result.asOfUnixMs).toBeLessThanOrEqual(maxExpiry);
    });

    it("provider expiry can shorten but cannot extend regulatory risk cap", () => {
      const rawRecord = makeRegulatoryRiskRecord({
        publishedAtUnixMs: nowMs - 1000 * 60 * 60 * 60,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 60 * 60 + 1000,
        sourceReferences: ["https://regulator.gov/announcement"]
      });

      const record = acceptBoundedNewsRecord(rawRecord);
      const result = normalizeNewsRecord(record, nowMs);

      const maxExpiry = 72 * 60 * 60 * 1000;
      const actualAge = result.expiresAtUnixMs - result.asOfUnixMs;
      expect(actualAge).toBeLessThanOrEqual(maxExpiry);
    });
  });

  describe("no-directional-content", () => {
    it("normalized payload must not include direction", () => {
      const rawRecord = makeBoundedNewsSourceRecord({
        sourceReferences: ["https://example.com/article"]
      });

      const record = acceptBoundedNewsRecord(rawRecord);
      const result = normalizeNewsRecord(record, nowMs);

      expect((result as unknown as Record<string, unknown>).direction).toBeUndefined();
    });

    it("normalized payload must not include recommendation", () => {
      const rawRecord = makeBoundedNewsSourceRecord({
        sourceReferences: ["https://example.com/article"]
      });

      const record = acceptBoundedNewsRecord(rawRecord);
      const result = normalizeNewsRecord(record, nowMs);

      expect((result as unknown as Record<string, unknown>).recommendation).toBeUndefined();
    });

    it("normalized payload must not include sentiment", () => {
      const rawRecord = makeBoundedNewsSourceRecord({
        sourceReferences: ["https://example.com/article"]
      });

      const record = acceptBoundedNewsRecord(rawRecord);
      const result = normalizeNewsRecord(record, nowMs);

      expect((result as unknown as Record<string, unknown>).sentiment).toBeUndefined();
    });
  });

  describe("correction-warning", () => {
    it("adds correction warning when correctsSourceVersionId is present", () => {
      const rawRecord = makeBoundedNewsSourceRecord({
        sourceVersionId: "v2",
        correctsSourceVersionId: "v1",
        sourceReferences: ["https://example.com/article-v2"]
      });

      const record = acceptBoundedNewsRecord(rawRecord);
      const result = normalizeNewsRecord(record, nowMs);

      expect(result.warnings).toContain("correction");
    });

    it("does not add correction warning for new articles", () => {
      const rawRecord = makeBoundedNewsSourceRecord({
        sourceReferences: ["https://example.com/article"]
      });

      const record = acceptBoundedNewsRecord(rawRecord);
      const result = normalizeNewsRecord(record, nowMs);

      expect(result.warnings).not.toContain("correction");
    });
  });
});
