import type {
  DerivedFeatureRepo,
  DerivedFeatureRow,
  DerivedFeatureInsert,
  BundleFeatureCandidateQuery
} from "../../src/ports/feature-repo.js";
import type { FeatureKind } from "../../src/contracts/taxonomy.js";
import { DEFAULT_CONFIDENCE, DEFAULT_PROVENANCE } from "../helpers/taxonomy-fixtures.js";

export class FakeFeatureRepo implements DerivedFeatureRepo {
  private readonly store: DerivedFeatureRow[] = [];
  private nextId = 1;

  async insert(row: DerivedFeatureInsert): Promise<DerivedFeatureRow> {
    const results = await this.insertMany([row]);
    return results[0]!;
  }

  async insertMany(rows: readonly DerivedFeatureInsert[]): Promise<DerivedFeatureRow[]> {
    const results: DerivedFeatureRow[] = new Array(rows.length);
    const existingMap = new Map<string, DerivedFeatureRow>();
    const batchInsertedMap = new Map<string, DerivedFeatureRow>();

    for (const r of this.store) {
      const key = `${r.featureKind}:${r.derivationKey}`;
      existingMap.set(key, r);
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const key = `${row.featureKind}:${row.derivationKey}`;
      const existing = existingMap.get(key) ?? batchInsertedMap.get(key);
      if (existing !== undefined) {
        results[i] = existing;
      } else {
        const result: DerivedFeatureRow = {
          id: this.nextId++,
          featureKind: row.featureKind,
          signalClass: row.signalClass,
          evidenceFamily: row.evidenceFamily,
          value: row.value ?? null,
          structuredPayload: row.structuredPayload,
          asOfUnixMs: row.asOfUnixMs,
          confidence: row.confidence ?? DEFAULT_CONFIDENCE,
          confidenceComposite: row.confidenceComposite ?? null,
          confidenceLevel: row.confidenceLevel ?? null,
          validUntilUnixMs: row.validUntilUnixMs ?? null,
          isStale: row.isStale ?? false,
          staleBehavior: row.staleBehavior ?? null,
          provenance: row.provenance ?? DEFAULT_PROVENANCE,
          payloadHash: row.payloadHash,
          receivedAtUnixMs: row.receivedAtUnixMs,
          status: row.status,
          unit: row.unit,
          pair: row.pair ?? "SOL/USDC",
          calculatorVersion: row.calculatorVersion ?? "1.0",
          selectionVersion: row.selectionVersion ?? "1.0",
          inputObservationIds: row.inputObservationIds ?? [],
          rejectedObservationIds: row.rejectedObservationIds ?? [],
          derivationKey: row.derivationKey,
          poolId: row.poolId ?? null,
          positionId: row.positionId ?? null,
          warnings: row.warnings ?? [],
          reasons: row.reasons ?? []
        };
        this.store.push(result);
        batchInsertedMap.set(key, result);
        results[i] = result;
      }
    }

    return results;
  }

  async findByDerivationKey(
    featureKind: FeatureKind,
    derivationKey: string
  ): Promise<DerivedFeatureRow | undefined> {
    return this.store.find(
      (r) => r.featureKind === featureKind && r.derivationKey === derivationKey
    );
  }

  async findByKind(featureKind: FeatureKind, sinceUnixMs: number): Promise<DerivedFeatureRow[]> {
    return this.store.filter((r) => r.featureKind === featureKind && r.asOfUnixMs >= sinceUnixMs);
  }

  async listBundleCandidates(query: BundleFeatureCandidateQuery): Promise<DerivedFeatureRow[]> {
    const result = this.store
      .filter(
        (r) =>
          query.featureKinds.includes(r.featureKind) &&
          r.pair === query.pair &&
          r.asOfUnixMs >= query.asOfAtOrAfterUnixMs &&
          r.asOfUnixMs <= query.asOfAtOrBeforeUnixMs &&
          r.receivedAtUnixMs <= query.receivedAtOrBeforeUnixMs
      )
      .sort((a, b) => {
        if (b.asOfUnixMs !== a.asOfUnixMs) return b.asOfUnixMs - a.asOfUnixMs;
        if (b.receivedAtUnixMs !== a.receivedAtUnixMs)
          return b.receivedAtUnixMs - a.receivedAtUnixMs;
        return b.id - a.id;
      });

    return result;
  }
}
