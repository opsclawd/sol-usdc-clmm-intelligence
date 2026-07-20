import type {
  Source,
  ObservationKind,
  SignalClass,
  EvidenceFamily,
  Confidence,
  StaleBehavior,
  Provenance,
  NormalizedObservationRow
} from "../contracts/index.js";

export interface NormalizedObservationCandidateQuery {
  readonly sourceKinds: readonly {
    readonly source: Source;
    readonly observationKind: ObservationKind;
  }[];
  readonly receivedAtOrAfterUnixMs: number;
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
  listCandidates(query: NormalizedObservationCandidateQuery): Promise<NormalizedObservationRow[]>;
  findByIds(ids: readonly number[]): Promise<NormalizedObservationRow[]>;
}
