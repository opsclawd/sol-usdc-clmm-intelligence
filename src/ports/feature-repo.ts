import type { FeatureKind, DerivedFeatureRow, DerivedFeatureInsert } from "../contracts/index.js";

export type { DerivedFeatureRow, DerivedFeatureInsert };

export interface BundleFeatureCandidateQuery {
  readonly featureKinds: readonly FeatureKind[];
  readonly pair: "SOL/USDC";
  readonly asOfAtOrAfterUnixMs: number;
  readonly asOfAtOrBeforeUnixMs: number;
  readonly receivedAtOrBeforeUnixMs: number;
  readonly poolId?: string;
  readonly positionId?: string;
}

export interface DerivedFeatureRepo {
  insert(row: DerivedFeatureInsert): Promise<DerivedFeatureRow>;
  insertMany(rows: readonly DerivedFeatureInsert[]): Promise<DerivedFeatureRow[]>;
  findByDerivationKey(
    featureKind: FeatureKind,
    derivationKey: string
  ): Promise<DerivedFeatureRow | undefined>;
  findByKind(featureKind: FeatureKind, sinceUnixMs: number): Promise<DerivedFeatureRow[]>;
  listBundleCandidates(query: BundleFeatureCandidateQuery): Promise<DerivedFeatureRow[]>;
}
