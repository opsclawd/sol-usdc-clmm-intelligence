export interface ResearchBriefRow {
  id: number;
  evidenceBundleId: number;
  promptVersion: string;
  modelProvider: string;
  structuredOutput: unknown;
  confidence: string;
  sourceRefs: unknown;
  payloadHash: string;
  receivedAtUnixMs: number;
}

export interface ResearchBriefInsert {
  evidenceBundleId: number;
  promptVersion: string;
  modelProvider: string;
  structuredOutput: unknown;
  confidence?: string;
  sourceRefs?: unknown;
  payloadHash: string;
  receivedAtUnixMs: number;
}

export interface ResearchBriefRepo {
  insert(row: ResearchBriefInsert): Promise<ResearchBriefRow>;
  findByBundleId(evidenceBundleId: number): Promise<ResearchBriefRow[]>;
}
