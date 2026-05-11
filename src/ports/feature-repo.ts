export interface DerivedFeatureRow {
  id: number;
  featureKind: string;
  value: number | null;
  structuredPayload: unknown;
  asOfUnixMs: number;
  confidence: string;
  inputLineage: unknown;
  payloadHash: string;
  receivedAtUnixMs: number;
}

export interface DerivedFeatureInsert {
  featureKind: string;
  value?: number | null;
  structuredPayload?: unknown;
  asOfUnixMs: number;
  confidence?: string;
  inputLineage?: unknown;
  payloadHash: string;
  receivedAtUnixMs: number;
}

export interface DerivedFeatureRepo {
  insert(row: DerivedFeatureInsert): Promise<DerivedFeatureRow>;
  findByHash(featureKind: string, payloadHash: string): Promise<DerivedFeatureRow | undefined>;
  findByKind(featureKind: string, sinceUnixMs: number): Promise<DerivedFeatureRow[]>;
}
