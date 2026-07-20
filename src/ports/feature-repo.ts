import type {
  FeatureKind,
  SignalClass,
  EvidenceFamily,
  Confidence,
  StaleBehavior,
  Provenance
} from "../contracts/taxonomy.js";

export interface DerivedFeatureRow {
  id: number;
  featureKind: FeatureKind;
  signalClass: SignalClass;
  evidenceFamily: EvidenceFamily;
  value: number | null;
  structuredPayload: unknown;
  asOfUnixMs: number;
  confidence: Confidence;
  confidenceComposite: number | null;
  confidenceLevel: string | null;
  validUntilUnixMs: number | null;
  isStale: boolean;
  staleBehavior: StaleBehavior | null;
  provenance: Provenance;
  payloadHash: string;
  receivedAtUnixMs: number;
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  unit: "BPS" | "PPM";
  pair: string;
  calculatorVersion: string;
  selectionVersion: string;
  inputObservationIds: number[];
  rejectedObservationIds: number[];
  derivationKey: string;
  poolId: string | null;
  positionId: string | null;
}

export interface DerivedFeatureInsert {
  featureKind: FeatureKind;
  signalClass: SignalClass;
  evidenceFamily: EvidenceFamily;
  value?: number | null;
  structuredPayload: unknown;
  asOfUnixMs: number;
  confidence: Confidence;
  confidenceComposite?: number | null;
  confidenceLevel?: string | null;
  validUntilUnixMs?: number | null;
  isStale?: boolean;
  staleBehavior?: StaleBehavior | null;
  provenance: Provenance;
  payloadHash: string;
  receivedAtUnixMs: number;
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  unit: "BPS" | "PPM";
  pair?: string;
  calculatorVersion?: string;
  selectionVersion?: string;
  inputObservationIds?: number[];
  rejectedObservationIds?: number[];
  derivationKey: string;
  poolId?: string | null;
  positionId?: string | null;
}

export interface DerivedFeatureRepo {
  insert(row: DerivedFeatureInsert): Promise<DerivedFeatureRow>;
  insertMany(rows: readonly DerivedFeatureInsert[]): Promise<DerivedFeatureRow[]>;
  findByDerivationKey(
    featureKind: FeatureKind,
    derivationKey: string
  ): Promise<DerivedFeatureRow | undefined>;
  findByKind(featureKind: FeatureKind, sinceUnixMs: number): Promise<DerivedFeatureRow[]>;
}
