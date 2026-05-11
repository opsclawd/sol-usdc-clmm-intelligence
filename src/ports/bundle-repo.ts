import type { EvidenceBundleRow, EvidenceBundleInsert } from "../db/schema/evidence-bundles.js";

export interface EvidenceBundleRepo {
  insert(row: EvidenceBundleInsert): Promise<EvidenceBundleRow>;
  findByPair(pair: string, sinceUnixMs: number): Promise<EvidenceBundleRow[]>;
  findLatestByPair(pair: string): Promise<EvidenceBundleRow | undefined>;
}
