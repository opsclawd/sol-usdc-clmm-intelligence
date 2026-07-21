import type { Source, ParseStatus } from "./taxonomy.js";

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
