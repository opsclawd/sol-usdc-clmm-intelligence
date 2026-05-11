import type { NormalizedObservationRepo } from "../../src/ports/normalized-observation-repo.js";
import type {
  NormalizedObservationRow,
  NormalizedObservationInsert
} from "../../src/db/schema/normalized-observations.js";

export class FakeNormalizedObservationRepo implements NormalizedObservationRepo {
  private readonly store: NormalizedObservationRow[] = [];
  private nextId = 1;

  async insert(row: NormalizedObservationInsert): Promise<NormalizedObservationRow> {
    const result: NormalizedObservationRow = {
      id: this.nextId++,
      rawObservationId: row.rawObservationId,
      source: row.source,
      observationKind: row.observationKind,
      payload: row.payload,
      payloadHash: row.payloadHash,
      isFresh: row.isFresh ?? true,
      receivedAtUnixMs: row.receivedAtUnixMs
    };
    this.store.push(result);
    return result;
  }

  async findBySource(
    source: string,
    observationKind: string,
    sinceUnixMs: number
  ): Promise<NormalizedObservationRow[]> {
    return this.store.filter(
      (r) =>
        r.source === source &&
        r.observationKind === observationKind &&
        r.receivedAtUnixMs >= sinceUnixMs
    );
  }

  async findFreshByKind(
    source: string,
    observationKind: string
  ): Promise<NormalizedObservationRow[]> {
    return this.store.filter(
      (r) => r.source === source && r.observationKind === observationKind && r.isFresh
    );
  }
}
