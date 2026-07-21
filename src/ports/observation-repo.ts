import type { Source, ParseStatus, RawObservationRow } from "../contracts/index.js";

export type { RawObservationRow };

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
  findByIds(ids: number[]): Promise<RawObservationRow[]>;
  findByIdentity(
    source: Source,
    sourceObservationKey: string
  ): Promise<RawObservationRow | undefined>;
  findByHash(source: Source, payloadHash: string): Promise<RawObservationRow | undefined>;
  findBySource(source: Source, sinceUnixMs: number): Promise<RawObservationRow[]>;
  updateParseStatus(id: number, status: ParseStatus): Promise<RawObservationRow>;
}
