import { describe, it, expect } from "vitest";
import {
  makeScheduledEventPayload,
  makeProtocolIncidentPayload
} from "../../fixtures/context-events.js";
import { enrichContextEvent } from "../../../src/domain/context-events/enrich.js";

describe("context-events/enrich", () => {
  describe("enrichContextEvent (scheduled event)", () => {
    it("enriches a scheduled event with provenance and taxonomy", async () => {
      const now = Date.now();
      const payload = makeScheduledEventPayload({
        sourceEventId: "sched-event-enrich-test"
      });
      const result = await enrichContextEvent({
        payload,
        source: "macro-calendar-api",
        rawId: 1,
        nowMs: now,
        codeVersion: "1.0.0",
        runId: "run-001"
      });
      expect(result.id).toBe(1);
      expect(result.source).toBe("macro-calendar-api");
      expect(result.kind).toBe("scheduled_event");
      expect(result.evidenceFamily).toBe("macro_protocol_risk");
      expect(result.signalClass).toBe("contextual");
      expect(result.confidence).toBeDefined();
      expect(result.freshness).toBeDefined();
      expect(result.provenance).toBeDefined();
      expect(result.provenance.sourceRefs).toHaveLength(1);
    });

    it("sets confidence compositeScore based on source reliability", async () => {
      const now = Date.now();
      const payload = makeScheduledEventPayload({
        sourceQuality: {
          providerId: "macro-calendar-api",
          reliability: 0.9,
          completeness: "complete",
          confirmation: "primary"
        }
      });
      const result = await enrichContextEvent({
        payload,
        source: "macro-calendar-api",
        rawId: 1,
        nowMs: now,
        codeVersion: "1.0.0",
        runId: null
      });
      expect(result.confidence.compositeScore).toBeGreaterThan(0.5);
    });

    it("caps confidence for partial completeness", async () => {
      const now = Date.now();
      const payload = makeScheduledEventPayload({
        sourceQuality: {
          providerId: "macro-calendar-api",
          reliability: 0.9,
          completeness: "partial",
          confirmation: "secondary"
        }
      });
      const result = await enrichContextEvent({
        payload,
        source: "macro-calendar-api",
        rawId: 1,
        nowMs: now,
        codeVersion: "1.0.0",
        runId: null
      });
      expect(result.confidence.components.dataCompleteness).toBeLessThan(1);
    });

    it("computes freshness with correct timestamps", async () => {
      const now = Date.now();
      const payload = makeScheduledEventPayload({
        rawProvenance: {
          sourceObservedAtUnixMs: now - 60000,
          retrievedAtUnixMs: now - 59000,
          retentionMode: "bounded_factual_extract",
          license: "CC0-1.0"
        }
      });
      const result = await enrichContextEvent({
        payload,
        source: "macro-calendar-api",
        rawId: 1,
        nowMs: now,
        codeVersion: "1.0.0",
        runId: null
      });
      expect(result.freshness.derivedAt).toBe(now);
      expect(result.freshness.isStale).toBe(false);
    });

    it("marks stale when max observed age exceeded", async () => {
      const now = Date.now();
      const payload = makeScheduledEventPayload({
        rawProvenance: {
          sourceObservedAtUnixMs: now - 90000000,
          retrievedAtUnixMs: now - 89999000,
          retentionMode: "bounded_factual_extract",
          license: "CC0-1.0"
        }
      });
      const result = await enrichContextEvent({
        payload,
        source: "macro-calendar-api",
        rawId: 1,
        nowMs: now,
        codeVersion: "1.0.0",
        runId: null
      });
      expect(result.freshness.isStale).toBe(true);
      expect(result.freshness.reasons.length).toBeGreaterThan(0);
    });

    it("includes provenance with correct processRef", async () => {
      const now = Date.now();
      const payload = makeScheduledEventPayload();
      const result = await enrichContextEvent({
        payload,
        source: "macro-calendar-api",
        rawId: 42,
        nowMs: now,
        codeVersion: "2.5.0",
        runId: "run-xyz"
      });
      expect(result.provenance.processRef.collector).toBe("context-events-collector");
      expect(result.provenance.processRef.jobName).toBe("context-events-intelligence");
      expect(result.provenance.processRef.codeVersion).toBe("2.5.0");
      expect(result.provenance.processRef.pipelineRunId).toBe("run-xyz");
    });

    it("generates consistent payloadHash", async () => {
      const now = Date.now();
      const payload = makeScheduledEventPayload({ sourceEventId: "hash-test" });
      const result1 = await enrichContextEvent({
        payload,
        source: "macro-calendar-api",
        rawId: 1,
        nowMs: now,
        codeVersion: "1.0.0",
        runId: null
      });
      const result2 = await enrichContextEvent({
        payload,
        source: "macro-calendar-api",
        rawId: 1,
        nowMs: now,
        codeVersion: "1.0.0",
        runId: null
      });
      expect(result1.payloadHash).toBe(result2.payloadHash);
    });

    it("accepts null runId", async () => {
      const now = Date.now();
      const payload = makeScheduledEventPayload();
      const result = await enrichContextEvent({
        payload,
        source: "macro-calendar-api",
        rawId: 1,
        nowMs: now,
        codeVersion: "1.0.0",
        runId: null
      });
      expect(result.provenance.runId).toBeNull();
      expect(result.provenance.processRef.pipelineRunId).toBeNull();
    });
  });

  describe("enrichContextEvent (protocol incident)", () => {
    it("enriches a protocol incident with provenance and taxonomy", async () => {
      const now = Date.now();
      const payload = makeProtocolIncidentPayload({
        sourceEventId: "incident-enrich-test"
      });
      const result = await enrichContextEvent({
        payload,
        source: "solana-status-api",
        rawId: 2,
        nowMs: now,
        codeVersion: "1.0.0",
        runId: "run-002"
      });
      expect(result.id).toBe(2);
      expect(result.source).toBe("solana-status-api");
      expect(result.kind).toBe("protocol_incident");
      expect(result.evidenceFamily).toBe("macro_protocol_risk");
      expect(result.signalClass).toBe("contextual");
      expect(result.confidence).toBeDefined();
      expect(result.freshness).toBeDefined();
      expect(result.provenance).toBeDefined();
    });

    it("validates provenance with solana-status-api source", async () => {
      const now = Date.now();
      const payload = makeProtocolIncidentPayload();
      const result = await enrichContextEvent({
        payload,
        source: "solana-status-api",
        rawId: 3,
        nowMs: now,
        codeVersion: "1.0.0",
        runId: null
      });
      expect(result.provenance.sourceRefs.length).toBeGreaterThan(0);
      const allowedSources = result.provenance.sourceRefs.map(
        (ref: { source: string }) => ref.source
      );
      expect(allowedSources.every((s: string) => s === "solana-status-api")).toBe(true);
    });

    it("generates unique payloadHash for different incidents", async () => {
      const now = Date.now();
      const payload1 = makeProtocolIncidentPayload({ sourceEventId: "incident-1" });
      const payload2 = makeProtocolIncidentPayload({ sourceEventId: "incident-2" });
      const result1 = await enrichContextEvent({
        payload: payload1,
        source: "solana-status-api",
        rawId: 1,
        nowMs: now,
        codeVersion: "1.0.0",
        runId: null
      });
      const result2 = await enrichContextEvent({
        payload: payload2,
        source: "solana-status-api",
        rawId: 2,
        nowMs: now,
        codeVersion: "1.0.0",
        runId: null
      });
      expect(result1.payloadHash).not.toBe(result2.payloadHash);
    });

    it("uses correct freshness policy for protocol_incident", async () => {
      const now = Date.now();
      const payload = makeProtocolIncidentPayload();
      const result = await enrichContextEvent({
        payload,
        source: "solana-status-api",
        rawId: 1,
        nowMs: now,
        codeVersion: "1.0.0",
        runId: null
      });
      expect(result.freshness.policyKind).toBe("protocol_incident");
    });

    it("applies severity threshold correctly", async () => {
      const now = Date.now();
      const criticalPayload = makeProtocolIncidentPayload({ severity: "CRITICAL" });
      const lowPayload = makeProtocolIncidentPayload({ severity: "LOW" });
      const criticalResult = await enrichContextEvent({
        payload: criticalPayload,
        source: "solana-status-api",
        rawId: 1,
        nowMs: now,
        codeVersion: "1.0.0",
        runId: null
      });
      const lowResult = await enrichContextEvent({
        payload: lowPayload,
        source: "solana-status-api",
        rawId: 2,
        nowMs: now,
        codeVersion: "1.0.0",
        runId: null
      });
      expect(criticalResult.confidence.compositeScore).toBeGreaterThanOrEqual(
        lowResult.confidence.compositeScore
      );
    });
  });
});
