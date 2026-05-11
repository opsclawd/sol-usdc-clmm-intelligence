import { eq, and, gte } from "drizzle-orm";
import { derivedFeatures } from "../../db/schema/derived-features.js";
import type { DerivedFeatureRepo } from "../../ports/feature-repo.js";
import type { DerivedFeatureInsert, DerivedFeatureRow } from "../../db/schema/derived-features.js";
import type { Db } from "../../db/db.js";

export class DrizzleFeatureRepo implements DerivedFeatureRepo {
  constructor(private readonly db: Db) {}

  async insert(row: DerivedFeatureInsert): Promise<DerivedFeatureRow> {
    const [result] = await this.db.insert(derivedFeatures).values(row).returning();
    return result!;
  }

  async findByKind(featureKind: string, sinceUnixMs: number): Promise<DerivedFeatureRow[]> {
    return this.db
      .select()
      .from(derivedFeatures)
      .where(
        and(
          eq(derivedFeatures.featureKind, featureKind),
          gte(derivedFeatures.asOfUnixMs, sinceUnixMs)
        )
      );
  }
}
