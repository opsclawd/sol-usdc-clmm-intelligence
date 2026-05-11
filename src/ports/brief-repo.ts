import type { ResearchBriefRow, ResearchBriefInsert } from "../db/schema/research-briefs.js";

export interface ResearchBriefRepo {
  insert(row: ResearchBriefInsert): Promise<ResearchBriefRow>;
  findByBundleId(evidenceBundleId: number): Promise<ResearchBriefRow[]>;
}
