import type {
  RawObservationRepo,
  RawObservationRow,
  RawObservationInsert,
  RawInsertOutcome
} from "../../src/ports/observation-repo.js";
import type { Source, ParseStatus } from "../../src/contracts/taxonomy.js";

export class FakeObservationRepo implements RawObservationRepo {
  private readonly store = new Map<number, RawObservationRow>();
  private readonly identityIndex = new Map<string, RawObservationRow>();
  private nextId = 1;

  async insertOrClassify(row: RawObservationInsert): Promise<RawInsertOutcome> {
    const key = `${row.source}:${row.sourceObservationKey}`;
    const existing = this.identityIndex.get(key);
    if (existing) {
      if (existing.payloadHash === row.payloadHash) {
        return { outcome: "identical_replay", row: existing };
      }
      return { outcome: "conflict", row: existing, incomingPayloadHash: row.payloadHash };
    }
    const id = this.nextId++;
    const result: RawObservationRow = {
      id,
      source: row.source,
      sourceObservationKey: row.sourceObservationKey,
      observedAtUnixMs: row.observedAtUnixMs,
      fetchedAtUnixMs: row.fetchedAtUnixMs,
      payloadHash: row.payloadHash,
      payloadCanonical: row.payloadCanonical,
      parseStatus: row.parseStatus ?? "pending",
      sourceRequestMeta: row.sourceRequestMeta ?? null,
      receivedAtUnixMs: row.receivedAtUnixMs
    };
    this.store.set(id, result);
    this.identityIndex.set(key, result);
    return { outcome: "inserted", row: result };
  }

  async findById(id: number): Promise<RawObservationRow | undefined> {
    return this.store.get(id);
  }

  async findByIdentity(
    source: Source,
    sourceObservationKey: string
  ): Promise<RawObservationRow | undefined> {
    return this.identityIndex.get(`${source}:${sourceObservationKey}`);
  }

  async findByHash(source: Source, payloadHash: string): Promise<RawObservationRow | undefined> {
    return [...this.store.values()].find(
      (r) => r.source === source && r.payloadHash === payloadHash
    );
  }

  async findBySource(source: Source, sinceUnixMs: number): Promise<RawObservationRow[]> {
    return [...this.store.values()].filter(
      (r) => r.source === source && r.observedAtUnixMs >= sinceUnixMs
    );
  }

  async updateParseStatus(id: number, status: ParseStatus): Promise<RawObservationRow> {
    const existing = this.store.get(id);
    if (!existing) {
      throw new Error(`Row with id ${id} not found`);
    }
    const updated: RawObservationRow = { ...existing, parseStatus: status };
    this.store.set(id, updated);
    this.identityIndex.set(`${updated.source}:${updated.sourceObservationKey}`, updated);
    return updated;
  }
}
