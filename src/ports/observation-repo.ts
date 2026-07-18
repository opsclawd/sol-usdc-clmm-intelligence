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

export type RawInsertOutcome =
  | { outcome: "inserted"; row: RawObservationRow }
  | { outcome: "identical_replay"; row: RawObservationRow }
  | { outcome: "conflict"; row: RawObservationRow; incomingPayloadHash: string };

export interface RawObservationRepo {
  insertOrClassify(row: RawObservationInsert): Promise<RawInsertOutcome>;
  findById(id: number): Promise<RawObservationRow | undefined>;
  findByIdentity(
    source: Source,
    sourceObservationKey: string
  ): Promise<RawObservationRow | undefined>;
  findByHash(source: Source, payloadHash: string): Promise<RawObservationRow | undefined>;
  findBySource(source: Source, sinceUnixMs: number): Promise<RawObservationRow[]>;
  updateParseStatus(id: number, status: ParseStatus): Promise<RawObservationRow>;
}
