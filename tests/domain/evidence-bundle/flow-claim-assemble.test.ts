import { describe, it, expect } from "vitest";
import type { Scope } from "../../../src/contracts/generated/evidence-bundle-v1.js";
import type {
  Confidence,
  Provenance,
  NormalizedObservationRow
} from "../../../src/contracts/index.js";
import type { SelectedFeatureSlot } from "../../../src/domain/evidence-bundle/select.js";
import type { EvidenceBundleQuality } from "../../../src/domain/evidence-bundle/quality.js";
import type { VerifiedEvidenceLineage } from "../../../src/domain/evidence-bundle/lineage.js";
import type { SelectedContextEvent } from "../../../src/domain/context-events/select.js";
import type { OnChainFlowPayloadV1 } from "../../../src/contracts/on-chain-flow.js";
import {
  assembleEvidenceBundleCandidate,
  type AssembleEvidenceBundleInput
} from "../../../src/domain/evidence-bundle/assemble.js";
import { createEvidenceBundleContract } from "../../../src/adapters/node/evidence-bundle-v1-contract.js";

const DEFAULT_CONFIDENCE: Confidence = {
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

function makeOnChainFlowPayload(
  eventType: OnChainFlowPayloadV1["eventType"]
): OnChainFlowPayloadV1 {
  const common = {
    schemaVersion: 1 as const,
    eventFamily: "on_chain_flow" as const,
    sourceEventId: `evt-${eventType}-1`,
    observedAtUnixMs: 1700000000000,
    amountUsdc: "100000",
    direction: "inbound" as const,
    addressContext: { addressType: "wallet" as const, address: "0x123" },
    sourceReferences: ["ref-1"],
    sourceQuality: {
      provider: "helius-api" as const,
      freshness: "realtime" as const,
      completeness: "full" as const
    },
    freshnessContext: { blockTimestampUnixMs: 1700000000000 }
  };

  switch (eventType) {
    case "whale_transfer":
      return {
        ...common,
        eventType: "whale_transfer",
        venue: "solana",
        transactionSignature: "sig1",
        eventIndex: 0,
        slot: 100,
        stablecoinOperation: "transfer"
      };
    case "whale_swap":
      return {
        ...common,
        eventType: "whale_swap",
        venue: "solana",
        transactionSignature: "sig2",
        eventIndex: 0,
        slot: 100,
        stablecoinOperation: "transfer"
      };
    case "stablecoin_flow":
      return {
        ...common,
        eventType: "stablecoin_flow",
        venue: "solana",
        transactionSignature: "sig3",
        eventIndex: 0,
        slot: 100,
        stablecoinOperation: "transfer"
      };
    case "dex_net_flow":
      return {
        ...common,
        eventType: "dex_net_flow",
        venue: "solana",
        windowStartUnixMs: 1699990000000,
        windowEndUnixMs: 1700000000000,
        buyVolumeUsdc: "600000",
        sellVolumeUsdc: "500000",
        netFlowUsdc: "100000"
      };
    case "cex_flow_proxy":
      return {
        ...common,
        eventType: "cex_flow_proxy",
        venue: "cex",
        quality: "proxy",
        attributionConfidence: 0.9,
        attributionProvider: "helius-api",
        caveats: []
      };
  }
}

function makeSelectedFlowEvent(
  eventType: OnChainFlowPayloadV1["eventType"],
  id = 1
): SelectedContextEvent {
  const row: NormalizedObservationRow = {
    id,
    rawObservationId: id * 10,
    source: "helius-api",
    observationKind: eventType,
    signalClass: "contextual",
    evidenceFamily: "on_chain_flow",
    payload: {},
    payloadHash: `hash-${id}`,
    confidence: DEFAULT_CONFIDENCE,
    confidenceComposite: 1,
    confidenceLevel: "high",
    validUntilUnixMs: 1700090000000,
    isStale: false,
    staleBehavior: null,
    provenance: DEFAULT_PROVENANCE,
    receivedAtUnixMs: 1700000000000
  };

  return {
    row,
    payload: makeOnChainFlowPayload(eventType),
    eventFamily: "on_chain_flow"
  };
}

function makeQuality(): EvidenceBundleQuality {
  return {
    version: "mvp-evidence-bundle-quality/v1",
    quality: "complete",
    coverage: {
      deterministic: "available",
      supportResistance: "unavailable",
      flows: "partial",
      derivatives: "unavailable",
      events: "unavailable",
      newsRegulatory: "unavailable",
      researchBrief: "unavailable"
    },
    overallConfidenceBps: 10000,
    slotQualitySummaries: [
      {
        featureKind: "range_location",
        status: "available",
        confidenceBps: 10000,
        hasValue: true,
        warnings: []
      }
    ],
    warnings: [
      {
        code: "SUPPORT_RESISTANCE_UNAVAILABLE",
        message: "Support/resistance evidence family is unavailable",
        affectedFamilies: ["supportResistance"]
      },
      {
        code: "DERIVATIVES_UNAVAILABLE",
        message: "Derivatives evidence family is unavailable",
        affectedFamilies: ["derivatives"]
      },
      {
        code: "EVENTS_UNAVAILABLE",
        message: "Events evidence family is unavailable",
        affectedFamilies: ["events"]
      },
      {
        code: "NEWS_REGULATORY_UNAVAILABLE",
        message: "News/regulatory evidence family is unavailable",
        affectedFamilies: ["newsRegulatory"]
      },
      {
        code: "RESEARCH_BRIEF_UNAVAILABLE",
        message: "Research brief evidence family is unavailable",
        affectedFamilies: ["researchBrief"]
      },
      {
        code: "CONTEXTUAL_EVIDENCE_UNAVAILABLE",
        message: "Contextual evidence bundle family is unavailable",
        affectedFamilies: ["contextualEvidence"]
      }
    ],
    createdAt: 1700000000000,
    asOf: 1700000000000,
    freshUntil: 1700090000000,
    expiresAt: 1700180000000
  };
}

function makeAssembleInput(
  contextualEvents: readonly SelectedContextEvent[]
): AssembleEvidenceBundleInput {
  const scope: Scope = { kind: "pair" };
  const slot: SelectedFeatureSlot = {
    featureKind: "range_location",
    outcome: "selected_available",
    rowId: 1,
    value: 5000,
    confidence: DEFAULT_CONFIDENCE,
    provenance: DEFAULT_PROVENANCE,
    warnings: [],
    reasons: [],
    asOfUnixMs: 1700000000000,
    validUntilUnixMs: 1700090000000
  };

  const lineage: VerifiedEvidenceLineage["lineage"] = {
    rawObservationIds: [10],
    normalizedObservationIds: [100],
    sourceReferences: [
      {
        referenceId:
          "raw-10" as unknown as import("../../../src/contracts/generated/evidence-bundle-v1.js").Identifier128,
        sourceType: "api",
        locator: "sig1",
        observedAt: "2023-11-14T22:13:20.000Z"
      }
    ]
  };

  return {
    scope,
    slots: [slot],
    featureKinds: ["range_location"],
    quality: makeQuality(),
    lineage,
    runId: "run-1",
    correlationId: "corr-1",
    createdAt: 1700000000000,
    asOf: 1700000000000,
    freshUntil: 1700090000000,
    expiresAt: 1700180000000,
    briefPresent: false,
    pipelineVersion: "1.0.0",
    gitCommit: "0000000000000000000000000000000000000000000000000000000000000000",
    environment: "test",
    contextualEvents
  };
}

describe("flow claim translation during bundle assembly", () => {
  const representableCases = [
    ["dex_net_flow", "spot_flow"],
    ["whale_swap", "spot_flow"],
    ["cex_flow_proxy", "exchange_flow"],
    ["stablecoin_flow", "stablecoin_flow"]
  ] as const;

  it.each(representableCases)("maps %s to %s", (collectorKind, expectedPublishedKind) => {
    const event = makeSelectedFlowEvent(collectorKind);
    const input = makeAssembleInput([event]);
    const bundle = assembleEvidenceBundleCandidate(input);

    expect(bundle.contextualEvidence.flows).toHaveLength(1);
    const claim = bundle.contextualEvidence.flows[0]!;
    expect(claim.kind).toBe(expectedPublishedKind);
    if (collectorKind === "dex_net_flow") {
      expect(claim.claim).toContain("dex_net_flow");
    }
  });

  it("maps dex_net_flow to spot_flow", () => {
    const event = makeSelectedFlowEvent("dex_net_flow");
    const input = makeAssembleInput([event]);
    const bundle = assembleEvidenceBundleCandidate(input);

    expect(bundle.contextualEvidence.flows).toHaveLength(1);
    const claim = bundle.contextualEvidence.flows[0]!;
    expect(claim.kind).toBe("spot_flow");
    expect(claim.claim).toContain("dex_net_flow");
  });

  it("maps whale_swap to spot_flow", () => {
    const event = makeSelectedFlowEvent("whale_swap");
    const input = makeAssembleInput([event]);
    const bundle = assembleEvidenceBundleCandidate(input);

    expect(bundle.contextualEvidence.flows).toHaveLength(1);
    expect(bundle.contextualEvidence.flows[0]!.kind).toBe("spot_flow");
  });

  it("maps cex_flow_proxy to exchange_flow", () => {
    const event = makeSelectedFlowEvent("cex_flow_proxy");
    const input = makeAssembleInput([event]);
    const bundle = assembleEvidenceBundleCandidate(input);

    expect(bundle.contextualEvidence.flows).toHaveLength(1);
    expect(bundle.contextualEvidence.flows[0]!.kind).toBe("exchange_flow");
  });

  it("preserves stablecoin_flow as stablecoin_flow", () => {
    const event = makeSelectedFlowEvent("stablecoin_flow");
    const input = makeAssembleInput([event]);
    const bundle = assembleEvidenceBundleCandidate(input);

    expect(bundle.contextualEvidence.flows).toHaveLength(1);
    expect(bundle.contextualEvidence.flows[0]!.kind).toBe("stablecoin_flow");
  });

  it("drops whale_transfer and emits an unmappable flow warning", () => {
    const event = makeSelectedFlowEvent("whale_transfer");
    const input = makeAssembleInput([event]);
    const bundle = assembleEvidenceBundleCandidate(input);

    expect(bundle.assessment.warnings).toContainEqual({
      code: "unmappable_flow_kind",
      message: "Dropped unmappable on-chain flow kind: whale_transfer",
      affectedFamilies: ["flows"]
    });
    expect(bundle.contextualEvidence.flows).toEqual([]);
  });

  it("keeps representable flows when an unmappable transfer is also selected", () => {
    const swapEvent = makeSelectedFlowEvent("whale_swap", 1);
    const transferEvent = makeSelectedFlowEvent("whale_transfer", 2);
    const input = makeAssembleInput([swapEvent, transferEvent]);
    const bundle = assembleEvidenceBundleCandidate(input);

    expect(bundle.contextualEvidence.flows).toHaveLength(1);
    expect(bundle.contextualEvidence.flows[0]!.kind).toBe("spot_flow");
    expect(bundle.assessment.warnings).toContainEqual({
      code: "unmappable_flow_kind",
      message: "Dropped unmappable on-chain flow kind: whale_transfer",
      affectedFamilies: ["flows"]
    });
    expect(bundle.assessment.coverage.flows).not.toBe("unavailable");
  });

  it("marks flows unavailable when every selected flow is unmappable", async () => {
    const transferEvent = makeSelectedFlowEvent("whale_transfer");
    const input = makeAssembleInput([transferEvent]);
    const bundle = assembleEvidenceBundleCandidate(input);

    expect(bundle.contextualEvidence.flows).toEqual([]);
    expect(bundle.assessment.coverage.flows).toBe("unavailable");
    expect(bundle.assessment.warnings).toContainEqual({
      code: "FLOWS_UNAVAILABLE",
      message: "On-chain flows evidence family is unavailable",
      affectedFamilies: ["flows"]
    });
    expect(bundle.assessment.warnings).toContainEqual({
      code: "unmappable_flow_kind",
      message: "Dropped unmappable on-chain flow kind: whale_transfer",
      affectedFamilies: ["flows"]
    });
    expect(bundle.assessment.quality).toBe("complete");

    const contract = createEvidenceBundleContract();
    await expect(contract.validateCanonicalizeAndHash(bundle)).resolves.toBeDefined();
  });
});
