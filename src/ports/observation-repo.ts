export interface RawObservationRow {
  id: number;
  source: string;
  observedAtUnixMs: number;
  fetchedAtUnixMs: number;
  payloadHash: string;
  payloadCanonical: string;
  parseStatus: string;
  sourceRequestMeta: unknown;
  receivedAtUnixMs: number;
}

export interface RawObservationInsert {
  source: string;
  observedAtUnixMs: number;
  fetchedAtUnixMs: number;
  payloadHash: string;
  payloadCanonical: string;
  parseStatus?: string;
  sourceRequestMeta?: unknown;
  receivedAtUnixMs: number;
}

export interface RawObservationRepo {
  insert(row: RawObservationInsert): Promise<RawObservationRow>;
  findByHash(source: string, payloadHash: string): Promise<RawObservationRow | undefined>;
  findBySource(source: string, sinceUnixMs: number): Promise<RawObservationRow[]>;
}
