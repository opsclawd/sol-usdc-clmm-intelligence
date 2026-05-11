import { eq } from "drizzle-orm";
import { researchBriefs } from "../../db/schema/research-briefs.js";
import type {
  ResearchBriefRepo,
  ResearchBriefInsert,
  ResearchBriefRow
} from "../../ports/brief-repo.js";
import type { Db } from "../../db/db.js";

function toPortRow(row: typeof researchBriefs.$inferSelect): ResearchBriefRow {
  return {
    id: row.id,
    evidenceBundleId: row.evidenceBundleId,
    promptVersion: row.promptVersion,
    modelProvider: row.modelProvider,
    structuredOutput: row.structuredOutput,
    confidence: row.confidence,
    sourceRefs: row.sourceRefs,
    payloadHash: row.payloadHash,
    receivedAtUnixMs: row.receivedAtUnixMs
  };
}

export class DrizzleBriefRepo implements ResearchBriefRepo {
  constructor(private readonly db: Db) {}

  async insert(row: ResearchBriefInsert): Promise<ResearchBriefRow> {
    const [result] = await this.db.insert(researchBriefs).values(row).returning();
    return toPortRow(result!);
  }

  async findByBundleId(evidenceBundleId: number): Promise<ResearchBriefRow[]> {
    const rows = await this.db
      .select()
      .from(researchBriefs)
      .where(eq(researchBriefs.evidenceBundleId, evidenceBundleId));
    return rows.map(toPortRow);
  }
}
