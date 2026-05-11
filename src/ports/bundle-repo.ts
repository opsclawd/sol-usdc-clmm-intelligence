export interface EvidenceBundleRow {
  id: number;
  schemaVersion: string;
  pair: string;
  asOfUnixMs: number;
  expiresAtUnixMs: number;
  payload: unknown;
  payloadHash: string;
  inputLineage: unknown;
  version: number;
  receivedAtUnixMs: number;
}

export interface EvidenceBundleInsert {
  schemaVersion: string;
  pair: string;
  asOfUnixMs: number;
  expiresAtUnixMs: number;
  payload: unknown;
  payloadHash: string;
  inputLineage?: unknown;
  version?: number;
  receivedAtUnixMs: number;
}

export interface EvidenceBundleRepo {
  insert(row: EvidenceBundleInsert): Promise<EvidenceBundleRow>;
  findByPair(pair: string, sinceUnixMs: number): Promise<EvidenceBundleRow[]>;
  findLatestByPair(pair: string): Promise<EvidenceBundleRow | undefined>;
}
