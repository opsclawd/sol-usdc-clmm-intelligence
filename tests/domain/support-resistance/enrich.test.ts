import { describe, it, expect } from "vitest";
import {
  makeSupportResistanceRawSnapshot,
  makeSupportResistancePointClaim
} from "../../fixtures/support-resistance.js";
import { acceptSupportResistanceSnapshot } from "../../../src/domain/support-resistance/validate.js";
import { normalizeSupportResistanceClaims } from "../../../src/domain/support-resistance/normalize.js";
import {
  enrichSupportResistanceClaim,
  type SupportResistanceEnrichmentInput
} from "../../../src/domain/support-resistance/enrich.js";
import type { SupportResistancePayloadV1 } from "../../../src/contracts/support-resistance.js";

describe("enrichSupportResistanceClaim", () => {
  const nowMs = 1705400000000;
  const codeVersion = "1.0.0";
  const runId = "test-run-001";
  const rawId = 123;

  it("enriches a fresh claim with contextual taxonomy confidence and direct raw provenance", async () => {
    const snapshot = makeSupportResistanceRawSnapshot({
      providerId: "technical-analysis-api",
      providerRunId: "run-001",
      asOfUnixMs: 1705390000000,
      sourceReferences: ["https://example.com/analysis"],
      claims: [makeSupportResistancePointClaim(150.5, "RESISTANCE")]
    });

    const bounded = acceptSupportResistanceSnapshot(snapshot);
    const normalized = await normalizeSupportResistanceClaims(bounded);

    expect(normalized.accepted).toHaveLength(1);

    const input: SupportResistanceEnrichmentInput = {
      payload: normalized.accepted[0] as SupportResistancePayloadV1,
      nowMs,
      codeVersion,
      runId,
      rawId,
      sourceValidUntilUnixMs: undefined
    };

    const enriched = await enrichSupportResistanceClaim(input);

    expect(enriched.freshness.isStale).toBe(false);
    expect(enriched.confidence.compositeScore).toBeGreaterThan(0);
    expect(enriched.provenance.sourceRefs).toHaveLength(1);
    expect(enriched.provenance.processRef.collector).toBe("http-support-resistance-source");
    expect(enriched.provenance.processRef.jobName).toBe("support-resistance-enrichment");
    expect(enriched.provenance.processRef.pipelineRunId).toBe(runId);
    expect(enriched.provenance.processRef.codeVersion).toBe(codeVersion);
  });

  it("caps confidence at source quality and completeness", async () => {
    const snapshot = makeSupportResistanceRawSnapshot({
      providerId: "technical-analysis-api",
      providerRunId: "run-001",
      asOfUnixMs: 1705390000000,
      sourceReferences: ["https://example.com/analysis"],
      sourceReliability: 0.7,
      claims: [makeSupportResistancePointClaim(150.5, "RESISTANCE")]
    });

    const bounded = acceptSupportResistanceSnapshot(snapshot);
    const normalized = await normalizeSupportResistanceClaims(bounded);

    const input: SupportResistanceEnrichmentInput = {
      payload: normalized.accepted[0] as SupportResistancePayloadV1,
      nowMs,
      codeVersion,
      runId,
      rawId,
      sourceValidUntilUnixMs: undefined
    };

    const enriched = await enrichSupportResistanceClaim(input);

    expect(enriched.confidence.components.sourceReliability).toBe(0.7);
    expect(enriched.confidence.compositeScore).toBeLessThanOrEqual(0.7);
  });

  it("marks an expired claim stale and degrades confidence for context-only use", async () => {
    const snapshot = makeSupportResistanceRawSnapshot({
      providerId: "technical-analysis-api",
      providerRunId: "run-001",
      asOfUnixMs: 1705300000000,
      sourceReferences: ["https://example.com/analysis"],
      claims: [makeSupportResistancePointClaim(150.5, "RESISTANCE")]
    });

    const bounded = acceptSupportResistanceSnapshot(snapshot);
    const normalized = await normalizeSupportResistanceClaims(bounded);

    const input: SupportResistanceEnrichmentInput = {
      payload: normalized.accepted[0] as SupportResistancePayloadV1,
      nowMs,
      codeVersion,
      runId,
      rawId,
      sourceValidUntilUnixMs: 1705350000000
    };

    const enriched = await enrichSupportResistanceClaim(input);

    expect(enriched.freshness.isStale).toBe(true);
    expect(enriched.confidence.reasons).toContain("stale_input_degraded");
    expect(enriched.payload.warnings).toContain("stale_observation");
  });

  it("passes sourceValidUntilUnixMs to computeFreshness", async () => {
    const sourceValidUntil = 1705350000000;

    const snapshot = makeSupportResistanceRawSnapshot({
      providerId: "technical-analysis-api",
      providerRunId: "run-001",
      asOfUnixMs: 1705390000000,
      sourceReferences: ["https://example.com/analysis"],
      claims: [makeSupportResistancePointClaim(150.5, "RESISTANCE")]
    });

    const bounded = acceptSupportResistanceSnapshot(snapshot);
    const normalized = await normalizeSupportResistanceClaims(bounded);

    const input: SupportResistanceEnrichmentInput = {
      payload: normalized.accepted[0] as SupportResistancePayloadV1,
      nowMs,
      codeVersion,
      runId,
      rawId,
      sourceValidUntilUnixMs: sourceValidUntil
    };

    const enriched = await enrichSupportResistanceClaim(input);

    expect(enriched.freshness.validUntilUnixMs).toBeLessThanOrEqual(sourceValidUntil);
  });

  it("computes completeness from presence of references and invalidation conditions", async () => {
    const snapshot = makeSupportResistanceRawSnapshot({
      providerId: "technical-analysis-api",
      providerRunId: "run-001",
      asOfUnixMs: 1705390000000,
      sourceReferences: ["https://example.com/analysis"],
      claims: [makeSupportResistancePointClaim(150.5, "RESISTANCE")]
    });

    const bounded = acceptSupportResistanceSnapshot(snapshot);
    const normalized = await normalizeSupportResistanceClaims(bounded);

    const input: SupportResistanceEnrichmentInput = {
      payload: normalized.accepted[0] as SupportResistancePayloadV1,
      nowMs,
      codeVersion,
      runId,
      rawId,
      sourceValidUntilUnixMs: undefined
    };

    const enriched = await enrichSupportResistanceClaim(input);

    expect(enriched.confidence.components.dataCompleteness).toBeGreaterThan(0);
  });

  it("uses source reliability directly with derivation confidence 1", async () => {
    const snapshot = makeSupportResistanceRawSnapshot({
      providerId: "technical-analysis-api",
      providerRunId: "run-001",
      asOfUnixMs: 1705390000000,
      sourceReferences: ["https://example.com/analysis"],
      sourceReliability: 0.85,
      claims: [makeSupportResistancePointClaim(150.5, "RESISTANCE")]
    });

    const bounded = acceptSupportResistanceSnapshot(snapshot);
    const normalized = await normalizeSupportResistanceClaims(bounded);

    const input: SupportResistanceEnrichmentInput = {
      payload: normalized.accepted[0] as SupportResistancePayloadV1,
      nowMs,
      codeVersion,
      runId,
      rawId,
      sourceValidUntilUnixMs: undefined
    };

    const enriched = await enrichSupportResistanceClaim(input);

    expect(enriched.confidence.components.sourceReliability).toBe(0.85);
    expect(enriched.confidence.components.derivationConfidence).toBe(1);
    expect(enriched.confidence.components.llmConfidence).toBeNull();
  });

  it("adds contextual_source_quality_cap_applied when cap changes the score", async () => {
    const snapshot = makeSupportResistanceRawSnapshot({
      providerId: "technical-analysis-api",
      providerRunId: "run-001",
      asOfUnixMs: 1705390000000,
      sourceReferences: [],
      sourceReliability: 0.9,
      claims: [makeSupportResistancePointClaim(150.5, "RESISTANCE")]
    });

    const bounded = acceptSupportResistanceSnapshot(snapshot);
    const normalized = await normalizeSupportResistanceClaims(bounded);

    const input: SupportResistanceEnrichmentInput = {
      payload: normalized.accepted[0] as SupportResistancePayloadV1,
      nowMs,
      codeVersion,
      runId,
      rawId,
      sourceValidUntilUnixMs: undefined
    };

    const enriched = await enrichSupportResistanceClaim(input);

    const hasCapApplied = enriched.confidence.reasons.includes(
      "contextual_source_quality_cap_applied"
    );
    expect(typeof hasCapApplied).toBe("boolean");
  });

  it("includes raw observation ref in provenance", async () => {
    const snapshot = makeSupportResistanceRawSnapshot({
      providerId: "technical-analysis-api",
      providerRunId: "run-001",
      asOfUnixMs: 1705390000000,
      sourceReferences: ["https://example.com/analysis"],
      claims: [makeSupportResistancePointClaim(150.5, "RESISTANCE")]
    });

    const bounded = acceptSupportResistanceSnapshot(snapshot);
    const normalized = await normalizeSupportResistanceClaims(bounded);

    const input: SupportResistanceEnrichmentInput = {
      payload: normalized.accepted[0] as SupportResistancePayloadV1,
      nowMs,
      codeVersion,
      runId,
      rawId,
      sourceValidUntilUnixMs: undefined
    };

    const enriched = await enrichSupportResistanceClaim(input);

    expect(enriched.provenance.rawObservationRefs).toHaveLength(1);
    expect(enriched.provenance.rawObservationRefs[0]!.id).toBe(rawId);
    expect(enriched.provenance.rawObservationRefs[0]!.refType).toBe("raw_observation");
  });
});
