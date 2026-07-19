import type {
  Source,
  ObservationKind,
  SignalClass,
  EvidenceFamily,
  Confidence,
  StaleBehavior,
  Provenance
} from "../contracts/taxonomy.js";

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

export interface NormalizedObservationInsert {
  rawObservationId: number;
  source: Source;
  observationKind: ObservationKind;
  signalClass: SignalClass;
  evidenceFamily: EvidenceFamily;
  payload: unknown;
  payloadHash: string;
  confidence: Confidence;
  confidenceComposite?: number | null;
  confidenceLevel?: string | null;
  validUntilUnixMs?: number | null;
  isStale?: boolean;
  staleBehavior?: StaleBehavior | null;
  provenance: Provenance;
  receivedAtUnixMs: number;
}

export interface NormalizedObservationRepo {
  insert(row: NormalizedObservationInsert): Promise<NormalizedObservationRow>;
  insertMany(rows: readonly NormalizedObservationInsert[]): Promise<NormalizedObservationRow[]>;
  findBySource(
    source: Source,
    observationKind: ObservationKind,
    sinceUnixMs: number
  ): Promise<NormalizedObservationRow[]>;
  findFreshByKind(
    source: Source,
    observationKind: ObservationKind
  ): Promise<NormalizedObservationRow[]>;
  findLatestByKind(
    source: Source,
    observationKind: ObservationKind
  ): Promise<NormalizedObservationRow | null>;
  findByRawObservation(
    rawObservationId: number,
    observationKind: ObservationKind
  ): Promise<NormalizedObservationRow | null>;
}
