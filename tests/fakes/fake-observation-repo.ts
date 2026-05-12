import type {
  RawObservationRepo,
  RawObservationRow,
  RawObservationInsert
} from "../../src/ports/observation-repo.js";
import type { Source } from "../../src/contracts/taxonomy.js";

export class FakeObservationRepo implements RawObservationRepo {
  private readonly store = new Map<string, RawObservationRow>();
  private nextId = 1;

  async insert(row: RawObservationInsert): Promise<RawObservationRow> {
    const key = `${row.source}:${row.payloadHash}`;
    const existing = this.store.get(key);
    if (existing) return existing;
    const id = this.nextId++;
    const result: RawObservationRow = {
      id,
      source: row.source,
      observedAtUnixMs: row.observedAtUnixMs,
      fetchedAtUnixMs: row.fetchedAtUnixMs,
      payloadHash: row.payloadHash,
      payloadCanonical: row.payloadCanonical,
      parseStatus: row.parseStatus ?? "pending",
      sourceRequestMeta: row.sourceRequestMeta ?? null,
      receivedAtUnixMs: row.receivedAtUnixMs
    };
    this.store.set(key, result);
    return result;
  }

  async findByHash(source: Source, payloadHash: string): Promise<RawObservationRow | undefined> {
    return this.store.get(`${source}:${payloadHash}`);
  }

  async findBySource(source: Source, sinceUnixMs: number): Promise<RawObservationRow[]> {
    return [...this.store.values()].filter(
      (r) => r.source === source && r.observedAtUnixMs >= sinceUnixMs
    );
  }
}
