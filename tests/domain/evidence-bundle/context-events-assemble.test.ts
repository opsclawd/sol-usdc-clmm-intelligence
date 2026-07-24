import { describe, it, expect } from "vitest";
import type { FeatureKind, Confidence, Provenance } from "../../../src/contracts/taxonomy.js";
import { MVP_FEATURE_KINDS } from "../../../src/contracts/derived-feature.js";
import type { DerivedFeatureRow } from "../../../src/ports/feature-repo.js";
import type { SelectedFeatureSlot } from "../../../src/domain/evidence-bundle/select.js";
import type { EvidenceBundleQuality } from "../../../src/domain/evidence-bundle/quality.js";
import { assembleEvidenceBundleCandidate } from "../../../src/domain/evidence-bundle/assemble.js";
import type { AssembleEvidenceBundleInput } from "../../../src/domain/evidence-bundle/assemble.js";
import type { VerifiedEvidenceLineage } from "../../../src/domain/evidence-bundle/lineage.js";
import type { SelectedContextEvent } from "../../../src/domain/context-events/select.js";
import type { NormalizedObservationRow } from "../../../src/ports/index.js";
import type {
  ScheduledEventPayloadV1,
  ProtocolIncidentPayloadV1
} from "../../../src/contracts/context-events.js";
import {
  makeScheduledEventPayload,
  makeProtocolIncidentPayload
} from "../../fixtures/context-events.js";

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
    calculatorVersion?: string;
    selectionVersion?: string;
    poolId?: string | null;
    positionId?: string | null;
    pair?: string;
    validUntilUnixMs?: number | null;
  }
): DerivedFeatureRow {
  return {
    id: overrides.id,
    featureKind: overrides.featureKind,
    signalClass: (overrides.signalClass ??
      "deterministic") as import("../../../src/contracts/taxonomy.js").SignalClass,
    evidenceFamily: (overrides.evidenceFamily ??
      "clmm_state") as import("../../../src/contracts/taxonomy.js").EvidenceFamily,
    value: overrides.value ?? null,
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
    poolId: overrides.poolId ?? null,
    positionId: overrides.positionId ?? null,
    warnings: overrides.warnings ?? [],
    reasons: overrides.reasons ?? []
  };
}

function makeSlotsAllAvailable(candidates: DerivedFeatureRow[]): SelectedFeatureSlot[] {
  return MVP_FEATURE_KINDS.map((featureKind) => {
    const candidate = candidates.find((c) => c.featureKind === featureKind);
    if (!candidate) {
      return { featureKind, outcome: "missing" as const };
    }
    return {
      featureKind,
      outcome:
        candidate.status === "AVAILABLE"
          ? ("selected_available" as const)
          : candidate.status === "PARTIAL"
            ? ("selected_partial" as const)
            : ("selected_unavailable" as const),
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
    rawObservationIds: [],
    normalizedObservationIds: [],
    sourceReferences: []
  };
}

function makeAssembleInput(
  slots: SelectedFeatureSlot[],
  quality: EvidenceBundleQuality,
  lineage: VerifiedEvidenceLineage["lineage"],
  overrides?: Partial<AssembleEvidenceBundleInput>
): AssembleEvidenceBundleInput {
  return {
    slots,
    quality,
    lineage,
    runId: overrides?.runId ?? "run-123",
    correlationId: overrides?.correlationId ?? "corr-456",
    poolId: overrides?.poolId ?? "pool-abc",
    positionId: overrides?.positionId ?? "position-1",
    walletId: overrides?.walletId ?? "wallet-xyz",
    createdAt: overrides?.createdAt ?? 5000000000000,
    asOf: overrides?.asOf ?? 5000000000000,
    freshUntil: overrides?.freshUntil ?? 50000003600000,
    expiresAt: overrides?.expiresAt ?? 50000864000000,
    contextPresent: overrides?.contextPresent ?? false,
    briefPresent: overrides?.briefPresent ?? false,
    pipelineVersion: overrides?.pipelineVersion ?? "1.0.0",
    gitCommit: overrides?.gitCommit ?? "abc123def456",
    environment: overrides?.environment ?? "test",
    contextualEvents: overrides?.contextualEvents ?? []
  };
}

function makeNormalizedRow(
  overrides: Partial<NormalizedObservationRow> & { id: number }
): NormalizedObservationRow {
  return {
    id: overrides.id,
    rawObservationId: overrides.rawObservationId ?? overrides.id,
    source: overrides.source ?? "macro-calendar-api",
    observationKind: overrides.observationKind ?? "scheduled_event",
    signalClass: "contextual",
    evidenceFamily: "macro_protocol_risk",
    payload: overrides.payload ?? makeScheduledEventPayload(),
    payloadHash: `norm-hash-${overrides.id}`,
    confidence: overrides.confidence ?? DEFAULT_CONFIDENCE,
    confidenceComposite: 1,
    confidenceLevel: "high",
    validUntilUnixMs: 5000000864000000,
    isStale: overrides.isStale ?? false,
    staleBehavior: null,
    provenance: DEFAULT_PROVENANCE,
    receivedAtUnixMs: overrides.receivedAtUnixMs ?? 5000000000000
  };
}

function makeSelectedContextEvent(
  row: NormalizedObservationRow,
  payload: ScheduledEventPayloadV1 | ProtocolIncidentPayloadV1
): SelectedContextEvent {
  return { row, payload };
}

describe("context-events assembly", () => {
  describe("bundle event direction is always unknown", () => {
    it("scheduled event maps to direction unknown", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 5000,
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const slots = makeSlotsAllAvailable(candidates);
      const quality = makeQuality();
      const lineage = makeLineage();

      const scheduledPayload = makeScheduledEventPayload({
        status: "SCHEDULED",
        severity: "MEDIUM"
      });
      const normRow = makeNormalizedRow({ id: 100, observationKind: "scheduled_event" });
      const contextEvent = makeSelectedContextEvent(normRow, scheduledPayload);

      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, lineage, {
          contextPresent: true,
          contextualEvents: [contextEvent]
        })
      );

      expect(result.contextualEvidence.events).toHaveLength(1);
      expect(result.contextualEvidence.events[0]!.direction).toBe("unknown");
    });

    it("protocol incident maps to direction unknown", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 5000,
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const slots = makeSlotsAllAvailable(candidates);
      const quality = makeQuality();
      const lineage = makeLineage();

      const incidentPayload = makeProtocolIncidentPayload({
        status: "RESOLVED",
        severity: "HIGH"
      });
      const normRow = makeNormalizedRow({
        id: 101,
        source: "solana-status-api",
        observationKind: "protocol_incident"
      });
      const contextEvent = makeSelectedContextEvent(normRow, incidentPayload);

      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, lineage, {
          contextPresent: true,
          contextualEvents: [contextEvent]
        })
      );

      expect(result.contextualEvidence.events).toHaveLength(1);
      expect(result.contextualEvidence.events[0]!.direction).toBe("unknown");
    });
  });

  describe("maps contextual events to EventClaim structure", () => {
    it("scheduled event claim text includes status, title, and description", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 5000,
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const slots = makeSlotsAllAvailable(candidates);
      const quality = makeQuality();
      const lineage = makeLineage();

      const scheduledPayload = makeScheduledEventPayload({
        title: "Fed Rate Decision",
        description: "US Federal Reserve interest rate announcement",
        status: "SCHEDULED",
        severity: "HIGH"
      });
      const normRow = makeNormalizedRow({ id: 100, observationKind: "scheduled_event" });
      const contextEvent = makeSelectedContextEvent(normRow, scheduledPayload);

      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, lineage, {
          contextPresent: true,
          contextualEvents: [contextEvent]
        })
      );

      expect(result.contextualEvidence.events[0]!.claim).toBe(
        "SCHEDULED: Fed Rate Decision — US Federal Reserve interest rate announcement"
      );
    });

    it("protocol incident claim text includes status, title, and description", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 5000,
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const slots = makeSlotsAllAvailable(candidates);
      const quality = makeQuality();
      const lineage = makeLineage();

      const incidentPayload = makeProtocolIncidentPayload({
        title: "Orca Pool Drain",
        description: "Vulnerability in Orca DEX pool led to fund drain",
        status: "ACTIVE",
        severity: "CRITICAL"
      });
      const normRow = makeNormalizedRow({
        id: 101,
        source: "solana-status-api",
        observationKind: "protocol_incident"
      });
      const contextEvent = makeSelectedContextEvent(normRow, incidentPayload);

      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, lineage, {
          contextPresent: true,
          contextualEvents: [contextEvent]
        })
      );

      expect(result.contextualEvidence.events[0]!.claim).toBe(
        "ACTIVE: Orca Pool Drain — Vulnerability in Orca DEX pool led to fund drain"
      );
    });

    it("confidenceBps is converted from composite score to basis points", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 5000,
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const slots = makeSlotsAllAvailable(candidates);
      const quality = makeQuality();
      const lineage = makeLineage();

      const confidenceScore = 0.85;
      const scheduledPayload = makeScheduledEventPayload({ status: "SCHEDULED" });
      const normRow = makeNormalizedRow({
        id: 100,
        observationKind: "scheduled_event",
        confidence: {
          ...DEFAULT_CONFIDENCE,
          compositeScore: confidenceScore
        }
      });
      const contextEvent = makeSelectedContextEvent(normRow, scheduledPayload);

      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, lineage, {
          contextPresent: true,
          contextualEvents: [contextEvent]
        })
      );

      expect(result.contextualEvidence.events[0]!.confidenceBps).toBe(
        Math.round(confidenceScore * 10000)
      );
    });

    it("observedAt uses canonical timestamp from payload asOfUnixMs", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 5000,
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const slots = makeSlotsAllAvailable(candidates);
      const quality = makeQuality();
      const lineage = makeLineage();

      const asOfMs = 5000000000000;
      const scheduledPayload = makeScheduledEventPayload({
        status: "SCHEDULED",
        asOfUnixMs: asOfMs
      });
      const normRow = makeNormalizedRow({ id: 100, observationKind: "scheduled_event" });
      const contextEvent = makeSelectedContextEvent(normRow, scheduledPayload);

      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, lineage, {
          contextPresent: true,
          contextualEvents: [contextEvent]
        })
      );

      expect(result.contextualEvidence.events[0]!.observedAt).toBe(String(asOfMs));
    });

    it("expiresAt uses canonical timestamp from payload expiresAtUnixMs", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 5000,
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const slots = makeSlotsAllAvailable(candidates);
      const quality = makeQuality();
      const lineage = makeLineage();

      const expiresMs = 5000000864000000;
      const scheduledPayload = makeScheduledEventPayload({
        status: "SCHEDULED",
        expiresAtUnixMs: expiresMs
      });
      const normRow = makeNormalizedRow({ id: 100, observationKind: "scheduled_event" });
      const contextEvent = makeSelectedContextEvent(normRow, scheduledPayload);

      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, lineage, {
          contextPresent: true,
          contextualEvents: [contextEvent]
        })
      );

      expect(result.contextualEvidence.events[0]!.expiresAt).toBe(String(expiresMs));
    });

    it("sourceReferenceIds contains raw observation ID", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 5000,
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const slots = makeSlotsAllAvailable(candidates);
      const quality = makeQuality();
      const lineage = makeLineage();

      const scheduledPayload = makeScheduledEventPayload({ status: "SCHEDULED" });
      const rawObsId = 999;
      const normRow = makeNormalizedRow({
        id: 100,
        observationKind: "scheduled_event",
        rawObservationId: rawObsId
      });
      const contextEvent = makeSelectedContextEvent(normRow, scheduledPayload);

      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, lineage, {
          contextPresent: true,
          contextualEvents: [contextEvent]
        })
      );

      expect(result.contextualEvidence.events[0]!.sourceReferenceIds).toContain(`raw-${rawObsId}`);
    });

    it("evidenceId uses normalized- prefix with row ID", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 5000,
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const slots = makeSlotsAllAvailable(candidates);
      const quality = makeQuality();
      const lineage = makeLineage();

      const scheduledPayload = makeScheduledEventPayload({ status: "SCHEDULED" });
      const normRowId = 100;
      const normRow = makeNormalizedRow({ id: normRowId, observationKind: "scheduled_event" });
      const contextEvent = makeSelectedContextEvent(normRow, scheduledPayload);

      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, lineage, {
          contextPresent: true,
          contextualEvents: [contextEvent]
        })
      );

      expect(result.contextualEvidence.events[0]!.evidenceId).toBe(`normalized-${normRowId}`);
    });

    it("provenanceMethod is collected", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 5000,
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const slots = makeSlotsAllAvailable(candidates);
      const quality = makeQuality();
      const lineage = makeLineage();

      const scheduledPayload = makeScheduledEventPayload({ status: "SCHEDULED" });
      const normRow = makeNormalizedRow({ id: 100, observationKind: "scheduled_event" });
      const contextEvent = makeSelectedContextEvent(normRow, scheduledPayload);

      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, lineage, {
          contextPresent: true,
          contextualEvents: [contextEvent]
        })
      );

      expect(result.contextualEvidence.events[0]!.provenanceMethod).toBe("collected");
    });

    it("kind is scheduled_event for scheduled events", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 5000,
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const slots = makeSlotsAllAvailable(candidates);
      const quality = makeQuality();
      const lineage = makeLineage();

      const scheduledPayload = makeScheduledEventPayload({ status: "SCHEDULED" });
      const normRow = makeNormalizedRow({ id: 100, observationKind: "scheduled_event" });
      const contextEvent = makeSelectedContextEvent(normRow, scheduledPayload);

      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, lineage, {
          contextPresent: true,
          contextualEvents: [contextEvent]
        })
      );

      expect(result.contextualEvidence.events[0]!.kind).toBe("scheduled_event");
    });

    it("kind is protocol_incident for protocol incidents", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 5000,
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const slots = makeSlotsAllAvailable(candidates);
      const quality = makeQuality();
      const lineage = makeLineage();

      const incidentPayload = makeProtocolIncidentPayload({ status: "RESOLVED" });
      const normRow = makeNormalizedRow({
        id: 101,
        source: "solana-status-api",
        observationKind: "protocol_incident"
      });
      const contextEvent = makeSelectedContextEvent(normRow, incidentPayload);

      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, lineage, {
          contextPresent: true,
          contextualEvents: [contextEvent]
        })
      );

      expect(result.contextualEvidence.events[0]!.kind).toBe("protocol_incident");
    });
  });

  describe("handles multiple events correctly", () => {
    it("up to 64 events are included in the bundle", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 5000,
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const slots = makeSlotsAllAvailable(candidates);
      const quality = makeQuality();
      const lineage = makeLineage();

      const events: SelectedContextEvent[] = [];
      for (let i = 0; i < 64; i++) {
        const scheduledPayload = makeScheduledEventPayload({
          sourceEventId: `event-${i}`,
          status: "SCHEDULED"
        });
        const normRow = makeNormalizedRow({
          id: 100 + i,
          observationKind: "scheduled_event",
          rawObservationId: 1000 + i
        });
        events.push(makeSelectedContextEvent(normRow, scheduledPayload));
      }

      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, lineage, {
          contextPresent: true,
          contextualEvents: events
        })
      );

      expect(result.contextualEvidence.events).toHaveLength(64);
    });
  });

  describe("empty events when feeds are unavailable", () => {
    it("returns empty events array when contextualEvents is empty", () => {
      const candidates: DerivedFeatureRow[] = [
        makeFeatureRow({
          id: 1,
          featureKind: "range_location",
          derivationKey: "pool=abc,position=1",
          asOfUnixMs: 1000,
          receivedAtUnixMs: 1000,
          status: "AVAILABLE",
          value: 5000,
          poolId: "pool-abc",
          positionId: "position-1"
        })
      ];
      const slots = makeSlotsAllAvailable(candidates);
      const quality = makeQuality();
      const lineage = makeLineage();

      const result = assembleEvidenceBundleCandidate(
        makeAssembleInput(slots, quality, lineage, {
          contextPresent: false,
          contextualEvents: []
        })
      );

      expect(result.contextualEvidence.events).toHaveLength(0);
    });
  });
});
