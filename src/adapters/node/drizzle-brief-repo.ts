import { eq } from "drizzle-orm";
import { researchBriefs } from "../../db/schema/research-briefs.js";
import type { ResearchBriefRepo } from "../../ports/brief-repo.js";
import type { ResearchBriefInsert, ResearchBriefRow } from "../../db/schema/research-briefs.js";
import type { Db } from "../../db/db.js";

export class DrizzleBriefRepo implements ResearchBriefRepo {
  constructor(private readonly db: Db) {}

  async insert(row: ResearchBriefInsert): Promise<ResearchBriefRow> {
    const [result] = await this.db.insert(researchBriefs).values(row).returning();
    return result!;
  }

  async findByBundleId(evidenceBundleId: number): Promise<ResearchBriefRow[]> {
    return this.db
      .select()
      .from(researchBriefs)
      .where(eq(researchBriefs.evidenceBundleId, evidenceBundleId));
  }
}
