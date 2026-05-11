import type {
  DerivedFeatureRepo,
  DerivedFeatureRow,
  DerivedFeatureInsert
} from "../../src/ports/feature-repo.js";

export class FakeFeatureRepo implements DerivedFeatureRepo {
  private readonly store: DerivedFeatureRow[] = [];
  private nextId = 1;

  async insert(row: DerivedFeatureInsert): Promise<DerivedFeatureRow> {
    const existing = this.store.find(
      (r) => r.featureKind === row.featureKind && r.payloadHash === row.payloadHash
    );
    if (existing) return existing;
    const result: DerivedFeatureRow = {
      id: this.nextId++,
      featureKind: row.featureKind,
      value: row.value ?? null,
      structuredPayload: row.structuredPayload ?? null,
      asOfUnixMs: row.asOfUnixMs,
      confidence: row.confidence ?? "medium",
      inputLineage: row.inputLineage ?? null,
      payloadHash: row.payloadHash,
      receivedAtUnixMs: row.receivedAtUnixMs
    };
    this.store.push(result);
    return result;
  }

  async findByHash(
    featureKind: string,
    payloadHash: string
  ): Promise<DerivedFeatureRow | undefined> {
    return this.store.find((r) => r.featureKind === featureKind && r.payloadHash === payloadHash);
  }

  async findByKind(featureKind: string, sinceUnixMs: number): Promise<DerivedFeatureRow[]> {
    return this.store.filter((r) => r.featureKind === featureKind && r.asOfUnixMs >= sinceUnixMs);
  }
}
