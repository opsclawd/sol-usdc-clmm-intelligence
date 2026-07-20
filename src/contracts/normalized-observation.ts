import type {
  Source,
  ObservationKind,
  SignalClass,
  EvidenceFamily,
  Confidence,
  StaleBehavior,
  Provenance
} from "./taxonomy.js";

export interface NormalizedObservationRow {
  id: number;
  rawObservationId: number;
  source: Source;
  observationKind: ObservationKind;
  signalClass: SignalClass;
  evidenceFamily: EvidenceFamily;
  payload: unknown;
  payloadHash: string;
  confidence: Confidence;
  confidenceComposite: number | null;
  confidenceLevel: string | null;
  validUntilUnixMs: number | null;
  isStale: boolean;
  staleBehavior: StaleBehavior | null;
  provenance: Provenance;
  receivedAtUnixMs: number;
}
