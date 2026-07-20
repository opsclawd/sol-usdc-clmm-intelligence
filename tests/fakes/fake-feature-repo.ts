import type {
  DerivedFeatureRepo,
  DerivedFeatureRow,
  DerivedFeatureInsert
} from "../../src/ports/feature-repo.js";
import type { FeatureKind } from "../../src/contracts/taxonomy.js";
import { DEFAULT_CONFIDENCE, DEFAULT_PROVENANCE } from "../helpers/taxonomy-fixtures.js";

export class FakeFeatureRepo implements DerivedFeatureRepo {
  private readonly store: DerivedFeatureRow[] = [];
  private nextId = 1;

  async insert(row: DerivedFeatureInsert): Promise<DerivedFeatureRow> {
    const existing = this.store.find(
      (r) => r.featureKind === row.featureKind && r.derivationKey === row.derivationKey
    );
    if (existing) return existing;
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
      positionId: row.positionId ?? null
    };
    this.store.push(result);
    return result;
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
}
