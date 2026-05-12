import type {
  SignalClass,
  EvidenceFamily,
  Confidence,
  StaleBehavior,
  Provenance,
  TaxonomySummary
} from "../contracts/taxonomy.js";

export interface ResearchBriefRow {
  id: number;
  evidenceBundleId: number;
  promptVersion: string;
  modelProvider: string;
  structuredOutput: unknown;
  signalClass: SignalClass;
  evidenceFamily: EvidenceFamily | null;
  taxonomySummary: TaxonomySummary | null;
  confidence: Confidence;
  confidenceComposite: number | null;
  confidenceLevel: string | null;
  validUntilUnixMs: number | null;
  isStale: boolean;
  staleBehavior: StaleBehavior | null;
  provenance: Provenance;
  payloadHash: string;
  receivedAtUnixMs: number;
}

export interface ResearchBriefInsert {
  evidenceBundleId: number;
  promptVersion: string;
  modelProvider: string;
  structuredOutput: unknown;
  signalClass: SignalClass;
  evidenceFamily: EvidenceFamily;
  taxonomySummary?: TaxonomySummary | null;
  confidence: Confidence;
  confidenceComposite?: number | null;
  confidenceLevel?: string | null;
  validUntilUnixMs?: number | null;
  isStale?: boolean;
  staleBehavior?: StaleBehavior | null;
  provenance: Provenance;
  payloadHash: string;
  receivedAtUnixMs: number;
}

export interface ResearchBriefRepo {
  insert(row: ResearchBriefInsert): Promise<ResearchBriefRow>;
  findByBundleId(evidenceBundleId: number): Promise<ResearchBriefRow[]>;
  findByHash(evidenceBundleId: number, payloadHash: string): Promise<ResearchBriefRow | undefined>;
}
