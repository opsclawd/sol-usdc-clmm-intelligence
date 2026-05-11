export interface NormalizedObservationRow {
  id: number;
  rawObservationId: number;
  source: string;
  observationKind: string;
  payload: unknown;
  payloadHash: string;
  isFresh: boolean;
  receivedAtUnixMs: number;
}

export interface NormalizedObservationInsert {
  rawObservationId: number;
  source: string;
  observationKind: string;
  payload: unknown;
  payloadHash: string;
  isFresh?: boolean;
  receivedAtUnixMs: number;
}

export interface NormalizedObservationRepo {
  insert(row: NormalizedObservationInsert): Promise<NormalizedObservationRow>;
  findBySource(
    source: string,
    observationKind: string,
    sinceUnixMs: number
  ): Promise<NormalizedObservationRow[]>;
  findFreshByKind(source: string, observationKind: string): Promise<NormalizedObservationRow[]>;
}
