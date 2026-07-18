import type { Source, ParseStatus } from "../contracts/taxonomy.js";

export interface RawObservationRow {
  id: number;
  source: Source;
  sourceObservationKey: string;
  observedAtUnixMs: number;
  fetchedAtUnixMs: number;
  payloadHash: string;
  payloadCanonical: string;
  parseStatus: ParseStatus;
  sourceRequestMeta: unknown;
  receivedAtUnixMs: number;
}

export interface RawObservationInsert {
  source: Source;
  sourceObservationKey: string;
  observedAtUnixMs: number;
  fetchedAtUnixMs: number;
  payloadHash: string;
  payloadCanonical: string;
  parseStatus?: ParseStatus;
  sourceRequestMeta?: unknown;
  receivedAtUnixMs: number;
}

export interface RawObservationRepo {
  insert(row: RawObservationInsert): Promise<RawObservationRow>;
  findByHash(source: Source, payloadHash: string): Promise<RawObservationRow | undefined>;
  findBySource(source: Source, sinceUnixMs: number): Promise<RawObservationRow[]>;
}
