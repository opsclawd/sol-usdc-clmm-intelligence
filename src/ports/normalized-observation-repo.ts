import type {
  NormalizedObservationRow,
  NormalizedObservationInsert
} from "../db/schema/normalized-observations.js";

export interface NormalizedObservationRepo {
  insert(row: NormalizedObservationInsert): Promise<NormalizedObservationRow>;
  findBySource(
    source: string,
    observationKind: string,
    sinceUnixMs: number
  ): Promise<NormalizedObservationRow[]>;
  findFreshByKind(source: string, observationKind: string): Promise<NormalizedObservationRow[]>;
}
