import { describe, it, expect } from "vitest";
import {
  makeBoundedNewsSourceRecord,
  makeRegulatoryRiskRecord
} from "../../fixtures/news-events.js";
import { acceptBoundedNewsRecord } from "../../../src/domain/news-events/validate.js";
import { normalizeNewsRecord } from "../../../src/domain/news-events/normalize.js";
import { enrichNewsEvidence } from "../../../src/domain/news-events/enrich.js";

describe("enrichNewsEvidence", () => {
  const nowMs = 1705400000000;
  const codeVersion = "1.0.0";
  const runId = "test-run-001";
  const rawId = 123;
  const rawPayloadHash = "test-raw-hash-abc123";

  function buildPayload(
    source: "crypto-news-api" | "regulatory-monitor-api",
    overrides?: Parameters<typeof makeBoundedNewsSourceRecord>[0]
  ) {
    const rawRecord =
      source === "regulatory-monitor-api"
        ? makeRegulatoryRiskRecord(overrides)
        : makeBoundedNewsSourceRecord(overrides);
    const bounded = acceptBoundedNewsRecord(rawRecord);
    return normalizeNewsRecord(bounded, nowMs);
  }

  describe("confidence-degradation", () => {
    it("caps contextual confidence below high", async () => {
      const payload = buildPayload("crypto-news-api", {
        publishedAtUnixMs: nowMs - 1000 * 60 * 60,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 60 + 1000,
        sourceReferences: ["https://example.com/article"]
      });

      const enriched = await enrichNewsEvidence({
        payload,
        source: "crypto-news-api",
        rawId,
        rawPayloadHash,
        nowMs,
        codeVersion,
        runId
      });

      expect(enriched.confidence.level).not.toBe("high");
    });

    it("applies unconfirmed degradation factor", async () => {
      const payload = buildPayload("crypto-news-api", {
        sourceQuality: {
          providerId: "crypto-news-api",
          reliability: 0.8,
          completeness: "complete",
          confirmation: "unconfirmed",
          isPaywalled: false
        },
        publishedAtUnixMs: nowMs - 1000 * 60 * 60,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 60 + 1000,
        sourceReferences: ["https://example.com/article"]
      });

      const enriched = await enrichNewsEvidence({
        payload,
        source: "crypto-news-api",
        rawId,
        rawPayloadHash,
        nowMs,
        codeVersion,
        runId
      });

      expect(enriched.confidence.compositeScore).toBeLessThan(1);
    });

    it("applies partial degradation factor", async () => {
      const payload = buildPayload("crypto-news-api", {
        sourceQuality: {
          providerId: "crypto-news-api",
          reliability: 0.8,
          completeness: "partial",
          confirmation: "confirmed",
          isPaywalled: false
        },
        publishedAtUnixMs: nowMs - 1000 * 60 * 60,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 60 + 1000,
        sourceReferences: ["https://example.com/article"]
      });

      const enriched = await enrichNewsEvidence({
        payload,
        source: "crypto-news-api",
        rawId,
        rawPayloadHash,
        nowMs,
        codeVersion,
        runId
      });

      expect(enriched.confidence.compositeScore).toBeLessThan(1);
    });

    it("applies paywalled degradation factor", async () => {
      const payload = buildPayload("crypto-news-api", {
        sourceQuality: {
          providerId: "crypto-news-api",
          reliability: 0.8,
          completeness: "complete",
          confirmation: "confirmed",
          isPaywalled: true
        },
        publishedAtUnixMs: nowMs - 1000 * 60 * 60,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 60 + 1000,
        sourceReferences: ["https://example.com/article"]
      });

      const enriched = await enrichNewsEvidence({
        payload,
        source: "crypto-news-api",
        rawId,
        rawPayloadHash,
        nowMs,
        codeVersion,
        runId
      });

      expect(enriched.confidence.compositeScore).toBeLessThan(1);
    });

    it("applies stale degradation factor", async () => {
      const payload = buildPayload("crypto-news-api", {
        publishedAtUnixMs: nowMs - 1000 * 60 * 60 * 25,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 60 * 25 + 1000,
        sourceReferences: ["https://example.com/article"]
      });

      const enriched = await enrichNewsEvidence({
        payload,
        source: "crypto-news-api",
        rawId,
        rawPayloadHash,
        nowMs,
        codeVersion,
        runId
      });

      expect(enriched.confidence.reasons).toContain("stale_input_degraded");
    });

    it("multiplies applicable degradation factors", async () => {
      const payload = buildPayload("crypto-news-api", {
        sourceQuality: {
          providerId: "crypto-news-api",
          reliability: 0.8,
          completeness: "partial",
          confirmation: "unconfirmed",
          isPaywalled: true
        },
        publishedAtUnixMs: nowMs - 1000 * 60 * 60 * 25,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 60 * 25 + 1000,
        sourceReferences: ["https://example.com/article"]
      });

      const enriched = await enrichNewsEvidence({
        payload,
        source: "crypto-news-api",
        rawId,
        rawPayloadHash,
        nowMs,
        codeVersion,
        runId
      });

      expect(enriched.confidence.compositeScore).toBeLessThan(0.69);
    });

    it("caps composite confidence at 0.69", async () => {
      const payload = buildPayload("crypto-news-api", {
        publishedAtUnixMs: nowMs - 1000 * 60 * 30,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 30 + 1000,
        sourceReferences: ["https://example.com/article"]
      });

      const enriched = await enrichNewsEvidence({
        payload,
        source: "crypto-news-api",
        rawId,
        rawPayloadHash,
        nowMs,
        codeVersion,
        runId
      });

      expect(enriched.confidence.compositeScore).toBeLessThanOrEqual(0.69);
    });

    it("appends contextual_source_quality_cap_applied when capped", async () => {
      const payload = buildPayload("crypto-news-api", {
        publishedAtUnixMs: nowMs - 1000 * 60 * 30,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 30 + 1000,
        sourceReferences: ["https://example.com/article"]
      });

      const enriched = await enrichNewsEvidence({
        payload,
        source: "crypto-news-api",
        rawId,
        rawPayloadHash,
        nowMs,
        codeVersion,
        runId
      });

      expect(enriched.confidence.reasons).toContain("contextual_source_quality_cap_applied");
    });
  });

  describe("stale-partial-paywalled-explicit", () => {
    it("stale material remains explicit and degraded", async () => {
      const payload = buildPayload("crypto-news-api", {
        publishedAtUnixMs: nowMs - 1000 * 60 * 60 * 25,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 60 * 25 + 1000,
        sourceReferences: ["https://example.com/article"]
      });

      const enriched = await enrichNewsEvidence({
        payload,
        source: "crypto-news-api",
        rawId,
        rawPayloadHash,
        nowMs,
        codeVersion,
        runId
      });

      expect(enriched.freshness.isStale).toBe(true);
      expect(enriched.payload.warnings).toContain("stale_observation");
    });

    it("partial material remains explicit and degraded", async () => {
      const payload = buildPayload("crypto-news-api", {
        sourceQuality: {
          providerId: "crypto-news-api",
          reliability: 0.8,
          completeness: "partial",
          confirmation: "confirmed",
          isPaywalled: false
        },
        publishedAtUnixMs: nowMs - 1000 * 60 * 60,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 60 + 1000,
        sourceReferences: ["https://example.com/article"]
      });

      const enriched = await enrichNewsEvidence({
        payload,
        source: "crypto-news-api",
        rawId,
        rawPayloadHash,
        nowMs,
        codeVersion,
        runId
      });

      expect(enriched.payload.warnings).toContain("partial_material");
    });

    it("paywalled material remains explicit and degraded", async () => {
      const payload = buildPayload("crypto-news-api", {
        sourceQuality: {
          providerId: "crypto-news-api",
          reliability: 0.8,
          completeness: "complete",
          confirmation: "confirmed",
          isPaywalled: true
        },
        publishedAtUnixMs: nowMs - 1000 * 60 * 60,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 60 + 1000,
        sourceReferences: ["https://example.com/article"]
      });

      const enriched = await enrichNewsEvidence({
        payload,
        source: "crypto-news-api",
        rawId,
        rawPayloadHash,
        nowMs,
        codeVersion,
        runId
      });

      expect(enriched.payload.warnings).toContain("paywalled_material");
    });
  });

  describe("provenance", () => {
    it("builds provenance with raw parent in sourceRefs and rawObservationRefs", async () => {
      const payload = buildPayload("crypto-news-api", {
        publishedAtUnixMs: nowMs - 1000 * 60 * 60,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 60 + 1000,
        sourceReferences: ["https://example.com/article"]
      });

      const enriched = await enrichNewsEvidence({
        payload,
        source: "crypto-news-api",
        rawId,
        rawPayloadHash,
        nowMs,
        codeVersion,
        runId
      });

      expect(enriched.provenance.sourceRefs.length).toBeGreaterThan(0);
      expect(enriched.provenance.rawObservationRefs.length).toBeGreaterThan(0);
    });

    it("uses collector name sol-usdc-clmm-intelligence", async () => {
      const payload = buildPayload("crypto-news-api", {
        publishedAtUnixMs: nowMs - 1000 * 60 * 60,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 60 + 1000,
        sourceReferences: ["https://example.com/article"]
      });

      const enriched = await enrichNewsEvidence({
        payload,
        source: "crypto-news-api",
        rawId,
        rawPayloadHash,
        nowMs,
        codeVersion,
        runId
      });

      expect(enriched.provenance.processRef.collector).toBe("sol-usdc-clmm-intelligence");
    });

    it("uses job name news-evidence", async () => {
      const payload = buildPayload("crypto-news-api", {
        publishedAtUnixMs: nowMs - 1000 * 60 * 60,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 60 + 1000,
        sourceReferences: ["https://example.com/article"]
      });

      const enriched = await enrichNewsEvidence({
        payload,
        source: "crypto-news-api",
        rawId,
        rawPayloadHash,
        nowMs,
        codeVersion,
        runId
      });

      expect(enriched.provenance.processRef.jobName).toBe("news-evidence");
    });

    it("has no derived refs", async () => {
      const payload = buildPayload("crypto-news-api", {
        publishedAtUnixMs: nowMs - 1000 * 60 * 60,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 60 + 1000,
        sourceReferences: ["https://example.com/article"]
      });

      const enriched = await enrichNewsEvidence({
        payload,
        source: "crypto-news-api",
        rawId,
        rawPayloadHash,
        nowMs,
        codeVersion,
        runId
      });

      expect(enriched.provenance.derivedFromRefs).toHaveLength(0);
    });

    it("has no LLM/model version", async () => {
      const payload = buildPayload("crypto-news-api", {
        publishedAtUnixMs: nowMs - 1000 * 60 * 60,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 60 + 1000,
        sourceReferences: ["https://example.com/article"]
      });

      const enriched = await enrichNewsEvidence({
        payload,
        source: "crypto-news-api",
        rawId,
        rawPayloadHash,
        nowMs,
        codeVersion,
        runId
      });

      expect(enriched.provenance.processRef.modelVersion).toBeNull();
    });
  });

  describe("freshness", () => {
    it("marks stale ecosystem news as stale", async () => {
      const payload = buildPayload("crypto-news-api", {
        publishedAtUnixMs: nowMs - 1000 * 60 * 60 * 25,
        retrievedAtUnixMs: nowMs - 1000 * 60 * 60 * 25 + 1000,
        sourceReferences: ["https://example.com/article"]
      });

      const enriched = await enrichNewsEvidence({
        payload,
        source: "crypto-news-api",
        rawId,
        rawPayloadHash,
        nowMs,
        codeVersion,
        runId
      });

      expect(enriched.freshness.isStale).toBe(true);
    });
  });
});
