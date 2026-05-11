import type {
  DerivedFeatureRepo,
  DerivedFeatureRow,
  DerivedFeatureInsert
} from "../../src/ports/feature-repo.js";

export class FakeFeatureRepo implements DerivedFeatureRepo {
  private readonly store: DerivedFeatureRow[] = [];
  private nextId = 1;

  async insert(row: DerivedFeatureInsert): Promise<DerivedFeatureRow> {
    const result: DerivedFeatureRow = {
      id: this.nextId++,
      featureKind: row.featureKind,
      value: row.value ?? null,
      structuredPayload: row.structuredPayload ?? null,
      asOfUnixMs: row.asOfUnixMs,
      confidence: row.confidence ?? "medium",
      inputLineage: row.inputLineage ?? null,
      receivedAtUnixMs: row.receivedAtUnixMs
    };
    this.store.push(result);
    return result;
  }

  async findByKind(featureKind: string, sinceUnixMs: number): Promise<DerivedFeatureRow[]> {
    return this.store.filter((r) => r.featureKind === featureKind && r.asOfUnixMs >= sinceUnixMs);
  }
}
