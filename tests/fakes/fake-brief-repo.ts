import type { ResearchBriefRepo } from "../../src/ports/brief-repo.js";
import type { ResearchBriefRow, ResearchBriefInsert } from "../../src/db/schema/research-briefs.js";

export class FakeBriefRepo implements ResearchBriefRepo {
  private readonly store: ResearchBriefRow[] = [];
  private nextId = 1;

  async insert(row: ResearchBriefInsert): Promise<ResearchBriefRow> {
    const result: ResearchBriefRow = {
      id: this.nextId++,
      evidenceBundleId: row.evidenceBundleId,
      promptVersion: row.promptVersion,
      modelProvider: row.modelProvider,
      structuredOutput: row.structuredOutput,
      confidence: row.confidence ?? "medium",
      sourceRefs: row.sourceRefs ?? null,
      payloadHash: row.payloadHash,
      receivedAtUnixMs: row.receivedAtUnixMs
    };
    this.store.push(result);
    return result;
  }

  async findByBundleId(evidenceBundleId: number): Promise<ResearchBriefRow[]> {
    return this.store.filter((r) => r.evidenceBundleId === evidenceBundleId);
  }
}
