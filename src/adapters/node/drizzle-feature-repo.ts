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
    payloadHash: row.payloadHash,
    receivedAtUnixMs: row.receivedAtUnixMs
  };
}

export class DrizzleFeatureRepo implements DerivedFeatureRepo {
  constructor(private readonly db: Db) {}

  async insert(row: DerivedFeatureInsert): Promise<DerivedFeatureRow> {
    const [result] = await this.db
      .insert(derivedFeatures)
      .values(row)
      .onConflictDoNothing({
        target: [derivedFeatures.featureKind, derivedFeatures.payloadHash]
      })
      .returning();
    if (result) return toPortRow(result);
    const existing = await this.findByHash(row.featureKind, row.payloadHash);
    return existing!;
  }

  async findByHash(
    featureKind: string,
    payloadHash: string
  ): Promise<DerivedFeatureRow | undefined> {
    const [result] = await this.db
      .select()
      .from(derivedFeatures)
      .where(
        and(
          eq(derivedFeatures.featureKind, featureKind),
          eq(derivedFeatures.payloadHash, payloadHash)
        )
      )
      .limit(1);
    return result ? toPortRow(result) : undefined;
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
