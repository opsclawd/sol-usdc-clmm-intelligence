import { describe, it, expect } from "vitest";
import { MVP_FEATURE_KINDS } from "../../../src/contracts/derived-feature.js";
import { assembleEvidenceBundleCandidate } from "../../../src/domain/evidence-bundle/assemble.js";
import type { AssembleEvidenceBundleInput } from "../../../src/domain/evidence-bundle/assemble.js";
import type { EvidenceBundleQuality } from "../../../src/domain/evidence-bundle/quality.js";
import type { VerifiedEvidenceLineage } from "../../../src/domain/evidence-bundle/lineage.js";

import type { SelectedFeatureSlot } from "../../../src/domain/evidence-bundle/select.js";
import type {
  Identifier128,
  CanonicalTimestamp
} from "../../../src/contracts/generated/evidence-bundle-v1.js";

function makeQuality(): EvidenceBundleQuality {
  return {
    version: "mvp-evidence-bundle-quality/v1",
    quality: "complete",
    coverage: {
      deterministic: "available",
      supportResistance: "not_applicable",
      flows: "not_applicable",
      derivatives: "not_applicable",
      events: "not_applicable",
      newsRegulatory: "not_applicable",
      researchBrief: "not_applicable"
    },
    overallConfidenceBps: 10000,
    slotQualitySummaries: MVP_FEATURE_KINDS.map((fk) => ({
      featureKind: fk,
      status: "available" as const,
      confidenceBps: 10000,
      hasValue: true,
      warnings: []
    })),
    warnings: [],
    createdAt: 5000000000000,
    asOf: 5000000000000,
    freshUntil: 50000003600000,
    expiresAt: 50000864000000
  };
}

function makeLineage(): VerifiedEvidenceLineage["lineage"] {
  return {
    rawObservationIds: [1],
    normalizedObservationIds: [],
    sourceReferences: [
      {
        referenceId: "raw-1" as Identifier128,
        sourceType: "api",
        locator: "test",
        observedAt: "2026-07-28T18:00:00.000Z" as CanonicalTimestamp
      }
    ]
  };
}

describe("pair scope evidence bundle assembly", () => {
  it("emits pair scope verbatim without wallet pool or position keys", () => {
    const input = {
      slots: [],
      quality: makeQuality(),
      lineage: makeLineage(),
      runId: "run-123",
      correlationId: "corr-456",
      scope: { kind: "pair" },
      createdAt: 5000000000000,
      asOf: 5000000000000,
      freshUntil: 50000003600000,
      expiresAt: 50000864000000,
      briefPresent: false,
      pipelineVersion: "1.0.0",
      gitCommit: "abc123def456",
      environment: "test",
      contextualEvents: []
    } as unknown as AssembleEvidenceBundleInput;

    const candidate = assembleEvidenceBundleCandidate(input);

    expect(candidate.scope).toEqual({ kind: "pair" });
    expect(candidate.deterministicFeatures).toHaveLength(MVP_FEATURE_KINDS.length);
    expect(
      candidate.deterministicFeatures.every((feature) => feature.status === "unavailable")
    ).toBe(true);
    expect(JSON.stringify(candidate.scope)).not.toMatch(
      /walletAddress|whirlpoolAddress|positionId/
    );
  });

  it("preserves explicit position scope for existing position assembly", () => {
    const positionScope = {
      kind: "position" as const,
      network: "solana-mainnet" as const,
      walletAddress: "wallet-xyz",
      whirlpoolAddress: "pool-abc",
      positionId: "position-1"
    };

    const input = {
      slots: [],
      quality: makeQuality(),
      lineage: makeLineage(),
      runId: "run-123",
      correlationId: "corr-456",
      scope: positionScope,
      createdAt: 5000000000000,
      asOf: 5000000000000,
      freshUntil: 50000003600000,
      expiresAt: 50000864000000,
      briefPresent: false,
      pipelineVersion: "1.0.0",
      gitCommit: "abc123def456",
      environment: "test",
      contextualEvents: []
    } as unknown as AssembleEvidenceBundleInput;

    const candidate = assembleEvidenceBundleCandidate(input);

    expect(candidate.scope).toEqual(positionScope);
  });

  it("fills the required deterministic feature tuple with unavailable slots for an empty pair slot set", () => {
    const input = {
      slots: [],
      quality: makeQuality(),
      lineage: makeLineage(),
      runId: "run-123",
      correlationId: "corr-456",
      scope: { kind: "pair" },
      createdAt: 5000000000000,
      asOf: 5000000000000,
      freshUntil: 50000003600000,
      expiresAt: 50000864000000,
      briefPresent: false,
      pipelineVersion: "1.0.0",
      gitCommit: "abc123def456",
      environment: "test",
      contextualEvents: []
    } as unknown as AssembleEvidenceBundleInput;

    const candidate = assembleEvidenceBundleCandidate(input);

    expect(candidate.deterministicFeatures).toHaveLength(MVP_FEATURE_KINDS.length);
    for (const feature of candidate.deterministicFeatures) {
      expect(feature.status).toBe("unavailable");
      expect(feature.value).toBeNull();
      expect(feature.observedAt).toBeNull();
      expect(feature.freshUntil).toBeNull();
      expect(feature.unit).toBeNull();
      expect(feature.inputLineage).toEqual(["feature_unavailable"]);
    }
  });

  it("emits only explicitly requested deterministic feature kinds for pair scope", () => {
    const requestedKinds = ["oracle_dex_divergence", "volume_liquidity_ratio_24h"] as const;
    const slots: SelectedFeatureSlot[] = [
      {
        featureKind: "oracle_dex_divergence",
        outcome: "selected_available",
        rowId: 1,
        value: 10,
        confidence: {
          components: {
            sourceReliability: 1,
            dataCompleteness: 1,
            derivationConfidence: 1,
            llmConfidence: null
          },
          compositeScore: 1,
          level: "high",
          weightingVersion: "v1",
          reasons: []
        },
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
          codeVersion: "test",
          runId: null
        },
        warnings: [],
        reasons: [],
        asOfUnixMs: 5000000000000,
        validUntilUnixMs: null
      },
      {
        featureKind: "volume_liquidity_ratio_24h",
        outcome: "selected_available",
        rowId: 2,
        value: 200,
        confidence: {
          components: {
            sourceReliability: 1,
            dataCompleteness: 1,
            derivationConfidence: 1,
            llmConfidence: null
          },
          compositeScore: 1,
          level: "high",
          weightingVersion: "v1",
          reasons: []
        },
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
          codeVersion: "test",
          runId: null
        },
        warnings: [],
        reasons: [],
        asOfUnixMs: 5000000000000,
        validUntilUnixMs: null
      }
    ];

    const input = {
      featureKinds: requestedKinds,
      slots,
      quality: makeQuality(),
      lineage: makeLineage(),
      runId: "run-123",
      correlationId: "corr-456",
      scope: { kind: "pair" },
      createdAt: 5000000000000,
      asOf: 5000000000000,
      freshUntil: 50000003600000,
      expiresAt: 50000864000000,
      briefPresent: false,
      pipelineVersion: "1.0.0",
      gitCommit: "abc123def456",
      environment: "test",
      contextualEvents: []
    } as unknown as AssembleEvidenceBundleInput;

    const candidate = assembleEvidenceBundleCandidate(input);

    expect(candidate.deterministicFeatures).toHaveLength(2);
    expect(candidate.deterministicFeatures.map((f) => f.featureId)).toEqual([
      "feat-oracle_dex_divergence-1",
      "feat-volume_liquidity_ratio_24h-2"
    ]);

    const featureIds = candidate.deterministicFeatures.map((f) => f.featureId);
    expect(featureIds).not.toContain("feat-range_location-missing");
    expect(featureIds).not.toContain("feat-distance_to_lower-missing");
    expect(featureIds).not.toContain("feat-distance_to_upper-missing");
  });
});
