import { eq, and, gte } from "drizzle-orm";
import { derivedFeatures } from "../../db/schema/derived-features.js";
import type {
  DerivedFeatureRepo,
  DerivedFeatureInsert,
  DerivedFeatureRow
} from "../../ports/feature-repo.js";
import type { Db } from "../../db/db.js";

function toPortRow(row: typeof derivedFeatures.$inferSelect): DerivedFeatureRow {
  return {
    id: row.id,
    featureKind: row.featureKind,
    value: row.value,
    structuredPayload: row.structuredPayload,
    asOfUnixMs: row.asOfUnixMs,
    confidence: row.confidence,
    inputLineage: row.inputLineage,
    receivedAtUnixMs: row.receivedAtUnixMs
  };
}

export class DrizzleFeatureRepo implements DerivedFeatureRepo {
  constructor(private readonly db: Db) {}

  async insert(row: DerivedFeatureInsert): Promise<DerivedFeatureRow> {
    const [result] = await this.db.insert(derivedFeatures).values(row).returning();
    return toPortRow(result!);
  }

  async findByKind(featureKind: string, sinceUnixMs: number): Promise<DerivedFeatureRow[]> {
    const rows = await this.db
      .select()
      .from(derivedFeatures)
      .where(
        and(
          eq(derivedFeatures.featureKind, featureKind),
          gte(derivedFeatures.asOfUnixMs, sinceUnixMs)
        )
      );
    return rows.map(toPortRow);
  }
}
