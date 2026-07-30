import { describe, it, expect } from "vitest";
import { assembleEvidenceBundleCandidate } from "../../../src/domain/evidence-bundle/assemble.js";
import type { AssembleEvidenceBundleInput } from "../../../src/domain/evidence-bundle/assemble.js";
import { createEvidenceBundleContract } from "../../../src/adapters/node/evidence-bundle-v1-contract.js";
import { projectResearchBriefContext } from "../../../src/domain/brief/project-context.js";
import type { SelectedSupportResistance } from "../../../src/domain/support-resistance/select.js";
import type { SelectedNewsEvidence } from "../../../src/domain/news-events/select.js";
import type { NormalizedObservationRow } from "../../../src/contracts/normalized-observation.js";
import type { SupportResistancePayloadV1 } from "../../../src/contracts/support-resistance.js";
import type { NewsPayloadV1, RegulatoryPayloadV1 } from "../../../src/contracts/news-events.js";
import { MVP_FEATURE_KINDS } from "../../../src/contracts/derived-feature.js";
import type { SelectedFeatureSlot } from "../../../src/domain/evidence-bundle/select.js";
import type { EvidenceBundleQuality } from "../../../src/domain/evidence-bundle/quality.js";
import type { VerifiedEvidenceLineage } from "../../../src/domain/evidence-bundle/lineage.js";
import type { DerivedFeatureRow } from "../../../src/ports/feature-repo.js";
import type { Confidence, Provenance, FeatureKind } from "../../../src/contracts/taxonomy.js";

const DEFAULT_CONFIDENCE: Confidence = {
  components: {
    sourceReliability: 1,
    dataCompleteness: 1,
    derivationConfidence: 1,
    llmConfidence: null
  },
  compositeScore: 10000,
  level: "high",
  weightingVersion: "v1",
  reasons: []
};

const DEFAULT_PROVENANCE: Provenance = {
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
};

function makeFeatureRow(
  overrides: Partial<DerivedFeatureRow> & {
    id: number;
    featureKind: FeatureKind;
    derivationKey: string;
    asOfUnixMs: number;
    receivedAtUnixMs: number;
    status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
    value?: number | null;
  }
): DerivedFeatureRow {
  return {
    id: overrides.id,
    featureKind: overrides.featureKind,
    signalClass: (overrides.signalClass ??
      "deterministic") as import("../../../src/contracts/taxonomy.js").SignalClass,
    evidenceFamily: (overrides.evidenceFamily ??
      "clmm_state") as import("../../../src/contracts/taxonomy.js").EvidenceFamily,
    value: overrides.value ?? 100,
    structuredPayload: overrides.structuredPayload ?? {},
    asOfUnixMs: overrides.asOfUnixMs,
    confidence: overrides.confidence ?? DEFAULT_CONFIDENCE,
    confidenceComposite: overrides.confidenceComposite ?? null,
    confidenceLevel: overrides.confidenceLevel ?? null,
    validUntilUnixMs: overrides.validUntilUnixMs ?? null,
    isStale: overrides.isStale ?? false,
    staleBehavior: (overrides.staleBehavior ?? null) as
      | import("../../../src/contracts/taxonomy.js").StaleBehavior
      | null,
    provenance: overrides.provenance ?? DEFAULT_PROVENANCE,
    payloadHash: overrides.payloadHash ?? `hash-${overrides.id}`,
    receivedAtUnixMs: overrides.receivedAtUnixMs,
    status: overrides.status,
    unit: overrides.unit ?? "PPM",
    pair: overrides.pair ?? "SOL/USDC",
    calculatorVersion: overrides.calculatorVersion ?? "1.0",
    selectionVersion: overrides.selectionVersion ?? "1.0",
    inputObservationIds: overrides.inputObservationIds ?? [],
    rejectedObservationIds: overrides.rejectedObservationIds ?? [],
    derivationKey: overrides.derivationKey,
    poolId: overrides.poolId ?? "pool-abc",
    positionId: overrides.positionId ?? "position-1",
    warnings: overrides.warnings ?? [],
    reasons: overrides.reasons ?? []
  };
}

function makeSlotsAllAvailable(): SelectedFeatureSlot[] {
  return MVP_FEATURE_KINDS.map((featureKind, i) => {
    const candidate = makeFeatureRow({
      id: i + 1,
      featureKind,
      derivationKey: `key-${i}`,
      asOfUnixMs: 5000000000000,
      receivedAtUnixMs: 5000000000000,
      status: "AVAILABLE",
      value: 100,
      validUntilUnixMs: 50000003600000
    });
    return {
      featureKind,
      outcome: "selected_available" as const,
      rowId: candidate.id,
      value: candidate.value ?? 0,
      confidence: candidate.confidence,
      provenance: candidate.provenance,
      warnings: candidate.warnings,
      reasons: candidate.reasons,
      asOfUnixMs: candidate.asOfUnixMs,
      validUntilUnixMs: candidate.validUntilUnixMs
    };
  });
}

import { classifyEvidenceBundleQuality } from "../../../src/domain/evidence-bundle/quality.js";

function makeQuality(): EvidenceBundleQuality {
  const base = classifyEvidenceBundleQuality({
    slots: makeSlotsAllAvailable(),
    runId: "run-123",
    correlationId: "corr-456",
    createdAt: 5000000000000,
    asOf: 5000000000000,
    freshUntil: 50000003600000,
    expiresAt: 50000864000000,
    hasSupportResistance: true,
    hasFlows: false,
    hasDerivatives: false,
    hasEvents: false,
    hasNewsRegulatory: true,
    hasResearchBrief: false
  });
  return {
    ...base,
    coverage: {
      ...base.coverage,
      supportResistance: "available",
      newsRegulatory: "available"
    }
  };
}

function makeLineage(): VerifiedEvidenceLineage["lineage"] {
  return {
    rawObservationIds: [1, 2, 3],
    normalizedObservationIds: [10, 20, 30],
    sourceReferences: [
      {
        referenceId:
          "raw-1" as import("../../../src/contracts/generated/evidence-bundle-v1.js").Identifier128,
        sourceType: "internal_bundle",
        locator: "raw-1",
        observedAt:
          "2026-05-10T00:00:00.000Z" as import("../../../src/contracts/generated/evidence-bundle-v1.js").CanonicalTimestamp
      }
    ]
  };
}

function makeAssembleInput(
  overrides?: Partial<AssembleEvidenceBundleInput>
): AssembleEvidenceBundleInput {
  return {
    slots: makeSlotsAllAvailable(),
    quality: makeQuality(),
    lineage: makeLineage(),
    runId: "run-123",
    correlationId: "corr-456",
    poolId: "pool-abc",
    positionId: "position-1",
    walletId: "wallet-xyz",
    createdAt: 5000000000000,
    asOf: 5000000000000,
    freshUntil: 50000003600000,
    expiresAt: 50000864000000,
    briefPresent: false,
    pipelineVersion: "1.0.0",
    gitCommit: "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234",
    environment: "test",
    contextualEvents: [],
    ...overrides
  };
}

function makeNormalizedRow(
  id: number,
  rawObservationId: number,
  observationKind: string,
  payload: unknown,
  compositeScore = 0.85
): NormalizedObservationRow {
  return {
    id,
    rawObservationId,
    source: "technical-analysis-api",
    observationKind: observationKind as NormalizedObservationRow["observationKind"],
    signalClass: "contextual",
    evidenceFamily: "support_resistance",
    payload,
    payloadHash: `hash-${id}`,
    confidence: {
      compositeScore,
      components: {
        sourceReliability: compositeScore,
        dataCompleteness: 1,
        derivationConfidence: 1,
        llmConfidence: null
      },
      level: "high",
      weightingVersion: "v1",
      reasons: []
    },
    confidenceComposite: compositeScore,
    confidenceLevel: "high",
    validUntilUnixMs: 5000000000000 + 3600000,
    isStale: false,
    staleBehavior: null,
    provenance: DEFAULT_PROVENANCE,
    receivedAtUnixMs: 5000000000000
  };
}

function makeSupportPointFixture(): SelectedSupportResistance {
  const payload: SupportResistancePayloadV1 = {
    kind: "support_resistance_level",
    schemaVersion: 1,
    pair: "SOL/USDC",
    unit: "USDC_PER_SOL",
    evidenceSide: "SUPPORT",
    levelType: "point",
    levelUsdcPerSol: 145.5,
    timeframe: "1h",
    thesisCodes: ["volume_profile"],
    invalidationConditions: ["break_below_144"],
    asOfUnixMs: 5000000000000,
    expiresAtUnixMs: 50000003600000,
    warnings: [],
    sourceReferences: ["ref-1"],
    sourceQuality: { providerId: "ta", reliability: 0.9, completeness: "complete" }
  };
  return {
    row: makeNormalizedRow(101, 501, "support_resistance_level", payload, 0.9),
    payload
  };
}

function makeSupportZoneFixture(): SelectedSupportResistance {
  const payload: SupportResistancePayloadV1 = {
    kind: "support_resistance_level",
    schemaVersion: 1,
    pair: "SOL/USDC",
    unit: "USDC_PER_SOL",
    evidenceSide: "SUPPORT",
    levelType: "zone",
    zoneLowerUsdcPerSol: 140,
    zoneUpperUsdcPerSol: 142,
    timeframe: "4h",
    thesisCodes: [],
    invalidationConditions: [],
    asOfUnixMs: 5000000000000,
    expiresAtUnixMs: 50000003600000,
    warnings: [],
    sourceReferences: ["ref-2"],
    sourceQuality: { providerId: "ta", reliability: 0.85, completeness: "complete" }
  };
  return {
    row: makeNormalizedRow(102, 502, "support_resistance_level", payload, 0.85),
    payload
  };
}

function makeResistancePointFixture(): SelectedSupportResistance {
  const payload: SupportResistancePayloadV1 = {
    kind: "support_resistance_level",
    schemaVersion: 1,
    pair: "SOL/USDC",
    unit: "USDC_PER_SOL",
    evidenceSide: "RESISTANCE",
    levelType: "point",
    levelUsdcPerSol: 155.75,
    timeframe: "1d",
    thesisCodes: [],
    invalidationConditions: [],
    asOfUnixMs: 5000000000000,
    expiresAtUnixMs: 50000003600000,
    warnings: [],
    sourceReferences: ["ref-3"],
    sourceQuality: { providerId: "ta", reliability: 0.92, completeness: "complete" }
  };
  return {
    row: makeNormalizedRow(103, 503, "support_resistance_level", payload, 0.92),
    payload
  };
}

function makeResistanceZoneFixture(): SelectedSupportResistance {
  const payload: SupportResistancePayloadV1 = {
    kind: "support_resistance_level",
    schemaVersion: 1,
    pair: "SOL/USDC",
    unit: "USDC_PER_SOL",
    evidenceSide: "RESISTANCE",
    levelType: "zone",
    zoneLowerUsdcPerSol: 160,
    zoneUpperUsdcPerSol: 165,
    timeframe: "1w",
    thesisCodes: ["orderbook_depth"],
    invalidationConditions: ["break_above_166"],
    asOfUnixMs: 5000000000000,
    expiresAtUnixMs: 50000003600000,
    warnings: [],
    sourceReferences: ["ref-4"],
    sourceQuality: { providerId: "ta", reliability: 0.88, completeness: "complete" }
  };
  return {
    row: makeNormalizedRow(104, 504, "support_resistance_level", payload, 0.88),
    payload
  };
}

function makeEcosystemNewsFixture(): SelectedNewsEvidence {
  const payload: NewsPayloadV1 = {
    evidenceKind: "ecosystem_news",
    articleId: "art-1",
    sourceVersionId: "v1",
    correctsSourceVersionId: null,
    clusterId: "cluster-1",
    title: "Solana Network Upgrade Complete",
    factualSummary: "v1.18 deployed successfully across mainnet validators.",
    extractedClaims: ["v1.18 deployed"],
    topicTags: ["solana", "upgrade"],
    publishedAtUnixMs: 5000000000000,
    sourceUpdatedAtUnixMs: 5000000000000,
    retrievedAtUnixMs: 5000000000000,
    asOfUnixMs: 5000000000000,
    expiresAtUnixMs: 50000003600000,
    publisher: { publisherId: "coindesk", displayName: "CoinDesk", tier: "primary" },
    sourceQuality: {
      providerId: "news-api",
      reliability: 0.9,
      completeness: "complete",
      confirmation: "confirmed",
      isPaywalled: false
    },
    corroborationState: "independently_corroborated",
    originatingReportId: "rep-1",
    syndicationId: null,
    affectedAssets: ["SOL"],
    affectedProtocols: ["solana"],
    affectedJurisdictions: [],
    sourceReferences: ["news-ref-1"],
    rawProvenance: {
      retrievedAtUnixMs: 5000000000000,
      license: "standard",
      retentionMode: "bounded_factual_extract",
      robotsCompliance: true,
      termsAccepted: true
    },
    warnings: []
  };
  return {
    row: makeNormalizedRow(201, 601, "ecosystem_news", payload, 0.9),
    payload
  };
}

function makeRegulatoryRiskFixture(): SelectedNewsEvidence {
  const payload: RegulatoryPayloadV1 = {
    evidenceKind: "regulatory_risk",
    articleId: "art-2",
    sourceVersionId: "v1",
    correctsSourceVersionId: null,
    clusterId: "cluster-2",
    title: "SEC Clarifies Staking Guidance",
    factualSummary: "New framework issued for non-custodial liquid staking.",
    extractedClaims: ["new framework issued"],
    topicTags: ["sec", "regulation"],
    publishedAtUnixMs: 5000000000000,
    sourceUpdatedAtUnixMs: 5000000000000,
    retrievedAtUnixMs: 5000000000000,
    asOfUnixMs: 5000000000000,
    expiresAtUnixMs: 50000003600000,
    publisher: { publisherId: "sec-gov", displayName: "SEC", tier: "official" },
    sourceQuality: {
      providerId: "reg-api",
      reliability: 0.95,
      completeness: "complete",
      confirmation: "confirmed",
      isPaywalled: false
    },
    corroborationState: "single_source",
    originatingReportId: "rep-2",
    syndicationId: null,
    affectedAssets: ["SOL"],
    affectedProtocols: [],
    affectedJurisdictions: ["US"],
    sourceReferences: ["reg-ref-1"],
    rawProvenance: {
      retrievedAtUnixMs: 5000000000000,
      license: "standard",
      retentionMode: "bounded_factual_extract",
      robotsCompliance: true,
      termsAccepted: true
    },
    warnings: ["unconfirmed_claim"]
  };
  return {
    row: makeNormalizedRow(202, 602, "regulatory_risk", payload, 0.95),
    payload
  };
}

describe("support-resistance and news assembly mapping", () => {
  it("maps support points and zones to support_zone with exact prices", () => {
    const input = makeAssembleInput({
      selectedSupportResistance: [makeSupportPointFixture(), makeSupportZoneFixture()]
    });
    const candidate = assembleEvidenceBundleCandidate(input);
    const claims = candidate.contextualEvidence.supportResistance;
    expect(claims).toHaveLength(2);
    expect(claims[0]?.kind).toBe("support_zone");
    expect(claims[0]?.claim).toContain("Support at 145.5 USDC/SOL (1h)");
    expect(claims[1]?.kind).toBe("support_zone");
    expect(claims[1]?.claim).toContain("Support zone 140-142 USDC/SOL (4h)");
  });

  it("maps resistance points and zones to resistance_zone with exact prices", () => {
    const input = makeAssembleInput({
      selectedSupportResistance: [makeResistancePointFixture(), makeResistanceZoneFixture()]
    });
    const candidate = assembleEvidenceBundleCandidate(input);
    const claims = candidate.contextualEvidence.supportResistance;
    expect(claims).toHaveLength(2);
    expect(claims[0]?.kind).toBe("resistance_zone");
    expect(claims[0]?.claim).toContain("Resistance at 155.75 USDC/SOL (1d)");
    expect(claims[1]?.kind).toBe("resistance_zone");
    expect(claims[1]?.claim).toContain("Resistance zone 160-165 USDC/SOL (1w)");
  });

  it("maps ecosystem and regulatory records to their contract kinds", () => {
    const input = makeAssembleInput({
      selectedNewsEvidence: [makeEcosystemNewsFixture(), makeRegulatoryRiskFixture()]
    });
    const candidate = assembleEvidenceBundleCandidate(input);
    const newsClaims = candidate.contextualEvidence.newsRegulatory;
    expect(newsClaims).toHaveLength(2);
    expect(newsClaims[0]?.kind).toBe("ecosystem_news");
    expect(newsClaims[1]?.kind).toBe("regulatory_update");
  });

  it("keeps new contextual claim direction unknown", () => {
    const input = makeAssembleInput({
      selectedSupportResistance: [makeSupportPointFixture(), makeResistanceZoneFixture()],
      selectedNewsEvidence: [makeEcosystemNewsFixture(), makeRegulatoryRiskFixture()]
    });
    const candidate = assembleEvidenceBundleCandidate(input);
    const srClaims = candidate.contextualEvidence.supportResistance;
    const newsClaims = candidate.contextualEvidence.newsRegulatory;
    for (const claim of [...srClaims, ...newsClaims]) {
      expect(claim.direction).toBe("unknown");
    }
  });

  it("uses normalized evidence ids and raw source reference ids", () => {
    const input = makeAssembleInput({
      selectedSupportResistance: [makeSupportPointFixture()],
      selectedNewsEvidence: [makeEcosystemNewsFixture()]
    });
    const candidate = assembleEvidenceBundleCandidate(input);
    const srClaim = candidate.contextualEvidence.supportResistance[0]!;
    const newsClaim = candidate.contextualEvidence.newsRegulatory[0]!;

    expect(srClaim.evidenceId).toBe("normalized-101");
    expect(srClaim.sourceReferenceIds).toEqual(["raw-501"]);

    expect(newsClaim.evidenceId).toBe("normalized-201");
    expect(newsClaim.sourceReferenceIds).toEqual(["raw-601"]);
  });

  it("clamps confidence to contract basis points and bounds claim text", () => {
    const srOver = makeSupportPointFixture();
    (srOver.row.confidence as { compositeScore: number }).compositeScore = 1.5;
    const srLongClaim = makeResistanceZoneFixture();
    (srLongClaim.payload as unknown as { thesisCodes: string[] }).thesisCodes = ["a".repeat(600)];

    const input = makeAssembleInput({
      selectedSupportResistance: [srOver, srLongClaim]
    });
    const candidate = assembleEvidenceBundleCandidate(input);
    const claims = candidate.contextualEvidence.supportResistance;

    expect(claims[0]?.confidenceBps).toBe(10000);
    expect(claims[1]?.claim.length).toBeLessThanOrEqual(512);
  });

  it("projects assembled support resistance and news claims into research brief context", async () => {
    const input = makeAssembleInput({
      selectedSupportResistance: [makeSupportPointFixture()],
      selectedNewsEvidence: [makeEcosystemNewsFixture()]
    });
    const candidate = assembleEvidenceBundleCandidate(input);
    const contract = createEvidenceBundleContract();
    const canonical = await contract.validateCanonicalizeAndHash(candidate);

    const context = await projectResearchBriefContext({ bundle: canonical.payload });
    expect(context.contextualClaims.supportResistance).toHaveLength(1);
    expect(context.contextualClaims.supportResistance[0]?.evidenceId).toBe("normalized-101");
    expect(context.contextualClaims.newsRegulatory).toHaveLength(1);
    expect(context.contextualClaims.newsRegulatory[0]?.evidenceId).toBe("normalized-201");
  });
});
