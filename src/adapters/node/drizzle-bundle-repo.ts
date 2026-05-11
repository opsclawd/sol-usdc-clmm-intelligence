import { eq, gte, desc, and } from "drizzle-orm";
import { evidenceBundles } from "../../db/schema/evidence-bundles.js";
import type { EvidenceBundleRepo } from "../../ports/bundle-repo.js";
import type { EvidenceBundleInsert, EvidenceBundleRow } from "../../db/schema/evidence-bundles.js";
import type { Db } from "../../db/db.js";

export class DrizzleBundleRepo implements EvidenceBundleRepo {
  constructor(private readonly db: Db) {}

  async insert(row: EvidenceBundleInsert): Promise<EvidenceBundleRow> {
    const [result] = await this.db.insert(evidenceBundles).values(row).returning();
    return result!;
  }

  async findByPair(pair: string, sinceUnixMs: number): Promise<EvidenceBundleRow[]> {
    return this.db
      .select()
      .from(evidenceBundles)
      .where(and(eq(evidenceBundles.pair, pair), gte(evidenceBundles.asOfUnixMs, sinceUnixMs)));
  }

  async findLatestByPair(pair: string): Promise<EvidenceBundleRow | undefined> {
    const [result] = await this.db
      .select()
      .from(evidenceBundles)
      .where(eq(evidenceBundles.pair, pair))
      .orderBy(desc(evidenceBundles.receivedAtUnixMs))
      .limit(1);
    return result;
  }
}
