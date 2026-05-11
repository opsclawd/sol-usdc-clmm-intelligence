import type { RawObservationRow, RawObservationInsert } from "../db/schema/raw-observations.js";

export interface RawObservationRepo {
  insert(row: RawObservationInsert): Promise<RawObservationRow>;
  findByHash(source: string, payloadHash: string): Promise<RawObservationRow | undefined>;
  findBySource(source: string, sinceUnixMs: number): Promise<RawObservationRow[]>;
}
