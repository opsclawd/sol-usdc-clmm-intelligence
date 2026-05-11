import type { DerivedFeatureRow, DerivedFeatureInsert } from "../db/schema/derived-features.js";

export interface DerivedFeatureRepo {
  insert(row: DerivedFeatureInsert): Promise<DerivedFeatureRow>;
  findByKind(featureKind: string, sinceUnixMs: number): Promise<DerivedFeatureRow[]>;
}
