import type {
  NormalizedObservationRepo,
  NormalizedObservationRow,
  NormalizedObservationInsert
} from "../../src/ports/normalized-observation-repo.js";
import type { Source, ObservationKind } from "../../src/contracts/taxonomy.js";
import { DEFAULT_CONFIDENCE, DEFAULT_PROVENANCE } from "../helpers/taxonomy-fixtures.js";

export class FakeNormalizedObservationRepo implements NormalizedObservationRepo {
  private readonly store: NormalizedObservationRow[] = [];
  private nextId = 1;
  failAtIndex: number | null = null;

  async insert(row: NormalizedObservationInsert): Promise<NormalizedObservationRow> {
    const results = await this.insertMany([row]);
    return results[0]!;
  }

  async insertMany(
    rows: readonly NormalizedObservationInsert[]
  ): Promise<NormalizedObservationRow[]> {
    const staged: NormalizedObservationRow[] = [];
    const newRows: NormalizedObservationRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      if (this.failAtIndex === i) {
        throw new Error(`FakeNormalizedObservationRepo: fail at index ${i}`);
      }
      const existing = this.store.find(
        (r) =>
          r.rawObservationId === row.rawObservationId &&
          r.observationKind === row.observationKind &&
          r.payloadHash === row.payloadHash
      );
      if (existing) {
        staged.push(existing);
      } else {
        const result: NormalizedObservationRow = {
          id: this.nextId++,
          rawObservationId: row.rawObservationId,
          source: row.source,
          observationKind: row.observationKind,
          signalClass: row.signalClass,
          evidenceFamily: row.evidenceFamily,
          payload: row.payload,
          payloadHash: row.payloadHash,
          confidence: row.confidence ?? DEFAULT_CONFIDENCE,
          confidenceComposite: row.confidenceComposite ?? null,
          confidenceLevel: row.confidenceLevel ?? null,
          validUntilUnixMs: row.validUntilUnixMs ?? null,
          isStale: row.isStale ?? false,
          staleBehavior: row.staleBehavior ?? null,
          provenance: row.provenance ?? DEFAULT_PROVENANCE,
          receivedAtUnixMs: row.receivedAtUnixMs
        };
        staged.push(result);
        newRows.push(result);
      }
    }
    this.store.push(...newRows);
    return staged;
  }

  async findBySource(
    source: Source,
    observationKind: ObservationKind,
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
    source: Source,
    observationKind: ObservationKind
  ): Promise<NormalizedObservationRow[]> {
    return this.store.filter(
      (r) => r.source === source && r.observationKind === observationKind && !r.isStale
    );
  }
}
