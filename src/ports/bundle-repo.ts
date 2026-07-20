import type {
  SignalClass,
  Confidence,
  StaleBehavior,
  Provenance,
  TaxonomySummary
} from "../contracts/taxonomy.js";

export interface EvidenceBundleRow {
  id: number;
  schemaVersion: string;
  pair: string;
  asOfUnixMs: number;
  expiresAtUnixMs: number;
  payload: unknown;
  payloadHash: string;
  payloadCanonical: string;
  idempotencyKey: string;
  taxonomySummary: TaxonomySummary | null;
  dominantSignalClass: SignalClass;
  confidence: Confidence;
  confidenceComposite: number | null;
  confidenceLevel: string | null;
  validUntilUnixMs: number | null;
  isStale: boolean;
  staleBehavior: StaleBehavior | null;
  provenance: Provenance;
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
  payloadCanonical: string;
  idempotencyKey: string;
  taxonomySummary?: TaxonomySummary | null;
  dominantSignalClass?: SignalClass;
  confidence: Confidence;
  confidenceComposite?: number | null;
  confidenceLevel?: string | null;
  validUntilUnixMs?: number | null;
  isStale?: boolean;
  staleBehavior?: StaleBehavior | null;
  provenance: Provenance;
  version?: number;
  receivedAtUnixMs: number;
}

export interface EvidenceBundleRepo {
  insert(row: EvidenceBundleInsert): Promise<EvidenceBundleRow>;
  findByPair(pair: string, sinceUnixMs: number): Promise<EvidenceBundleRow[]>;
  findLatestByPair(pair: string): Promise<EvidenceBundleRow | undefined>;
}
