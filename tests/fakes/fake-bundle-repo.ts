import type {
  EvidenceBundleRepo,
  EvidenceBundleRow,
  EvidenceBundleInsert
} from "../../src/ports/bundle-repo.js";

export class FakeBundleRepo implements EvidenceBundleRepo {
  private readonly store: EvidenceBundleRow[] = [];
  private nextId = 1;

  async insert(row: EvidenceBundleInsert): Promise<EvidenceBundleRow> {
    const existing = this.store.find(
      (r) => r.pair === row.pair && r.payloadHash === row.payloadHash
    );
    if (existing) return existing;
    const result: EvidenceBundleRow = {
      id: this.nextId++,
      schemaVersion: row.schemaVersion,
      pair: row.pair,
      asOfUnixMs: row.asOfUnixMs,
      expiresAtUnixMs: row.expiresAtUnixMs,
      payload: row.payload,
      payloadHash: row.payloadHash,
      inputLineage: row.inputLineage ?? null,
      version: row.version ?? 1,
      receivedAtUnixMs: row.receivedAtUnixMs
    };
    this.store.push(result);
    return result;
  }

  async findByPair(pair: string, sinceUnixMs: number): Promise<EvidenceBundleRow[]> {
    return this.store.filter((r) => r.pair === pair && r.asOfUnixMs >= sinceUnixMs);
  }

  async findLatestByPair(pair: string): Promise<EvidenceBundleRow | undefined> {
    const matching = this.store.filter((r) => r.pair === pair);
    if (matching.length === 0) return undefined;
    return matching.reduce((a, b) => (a.receivedAtUnixMs > b.receivedAtUnixMs ? a : b));
  }
}
