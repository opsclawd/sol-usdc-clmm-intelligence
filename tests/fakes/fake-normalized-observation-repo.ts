import type {
  NormalizedObservationRepo,
  NormalizedObservationInsert,
  NormalizedObservationCandidateQuery
} from "../../src/ports/normalized-observation-repo.js";
import type {
  Source,
  ObservationKind,
  NormalizedObservationRow
} from "../../src/contracts/index.js";
import { DEFAULT_CONFIDENCE, DEFAULT_PROVENANCE } from "../helpers/taxonomy-fixtures.js";

export class FakeNormalizedObservationRepo implements NormalizedObservationRepo {
  private readonly store: NormalizedObservationRow[] = [];
  private nextId = 1;
  failAtIndex: number | null = null;

  get count(): number {
    return this.store.length;
  }

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
      const existing =
        this.store.find(
          (r) =>
            r.rawObservationId === row.rawObservationId &&
            r.observationKind === row.observationKind &&
            r.payloadHash === row.payloadHash
        ) ||
        newRows.find(
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
    return this.store
      .filter(
        (r) =>
          r.source === source &&
          r.observationKind === observationKind &&
          r.receivedAtUnixMs >= sinceUnixMs
      )
      .sort((a, b) => a.receivedAtUnixMs - b.receivedAtUnixMs);
  }

  async findFreshByKind(
    source: Source,
    observationKind: ObservationKind
  ): Promise<NormalizedObservationRow[]> {
    return this.store.filter(
      (r) => r.source === source && r.observationKind === observationKind && !r.isStale
    );
  }

  async findLatestByKind(
    source: Source,
    observationKind: ObservationKind
  ): Promise<NormalizedObservationRow | null> {
    const matches = this.store.filter(
      (r) => r.source === source && r.observationKind === observationKind
    );
    if (matches.length === 0) return null;
    matches.sort((a, b) => b.receivedAtUnixMs - a.receivedAtUnixMs);
    return matches[0] || null;
  }

  async findByRawObservation(
    rawObservationId: number,
    observationKind: ObservationKind
  ): Promise<NormalizedObservationRow | null> {
    const matches = this.store.filter(
      (r) => r.rawObservationId === rawObservationId && r.observationKind === observationKind
    );
    if (matches.length === 0) return null;
    matches.sort((a, b) => b.receivedAtUnixMs - a.receivedAtUnixMs);
    return matches[0] || null;
  }

  async listCandidates(
    query: NormalizedObservationCandidateQuery
  ): Promise<NormalizedObservationRow[]> {
    const sourceKindSet = new Set(
      query.sourceKinds.map(({ source, observationKind }) => `${source}:${observationKind}`)
    );

    const matches = this.store.filter(
      (r) =>
        sourceKindSet.has(`${r.source}:${r.observationKind}`) &&
        r.receivedAtUnixMs >= query.receivedAtOrAfterUnixMs
    );

    matches.sort((a, b) => {
      if (a.receivedAtUnixMs !== b.receivedAtUnixMs) {
        return a.receivedAtUnixMs - b.receivedAtUnixMs;
      }
      return a.id - b.id;
    });

    return matches;
  }

  async findByIds(ids: readonly number[]): Promise<NormalizedObservationRow[]> {
    if (ids.length === 0) return [];

    const uniqueAscIds = [...new Set(ids)].sort((a, b) => a - b);
    const results = this.store.filter((r) => uniqueAscIds.includes(r.id));
    results.sort((a, b) => a.id - b.id);
    return results;
  }
}
