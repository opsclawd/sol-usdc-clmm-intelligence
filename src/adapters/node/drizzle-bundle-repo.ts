import { eq, gte, desc, and } from "drizzle-orm";
import { evidenceBundles } from "../../db/schema/evidence-bundles.js";
import type {
  EvidenceBundleRepo,
  EvidenceBundleInsert,
  EvidenceBundleRow
} from "../../ports/bundle-repo.js";
import type { Db } from "../../db/db.js";

function toPortRow(row: typeof evidenceBundles.$inferSelect): EvidenceBundleRow {
  return {
    id: row.id,
    schemaVersion: row.schemaVersion,
    pair: row.pair,
    asOfUnixMs: row.asOfUnixMs,
    expiresAtUnixMs: row.expiresAtUnixMs,
    payload: row.payload,
    payloadHash: row.payloadHash,
    inputLineage: row.inputLineage,
    version: row.version,
    receivedAtUnixMs: row.receivedAtUnixMs
  };
}

export class DrizzleBundleRepo implements EvidenceBundleRepo {
  constructor(private readonly db: Db) {}

  async insert(row: EvidenceBundleInsert): Promise<EvidenceBundleRow> {
    const [result] = await this.db
      .insert(evidenceBundles)
      .values(row)
      .onConflictDoNothing({ target: [evidenceBundles.pair, evidenceBundles.payloadHash] })
      .returning();
    if (result) return toPortRow(result);
    const existing = await this.findLatestByPair(row.pair);
    return existing!;
  }

  async findByPair(pair: string, sinceUnixMs: number): Promise<EvidenceBundleRow[]> {
    const rows = await this.db
      .select()
      .from(evidenceBundles)
      .where(and(eq(evidenceBundles.pair, pair), gte(evidenceBundles.asOfUnixMs, sinceUnixMs)));
    return rows.map(toPortRow);
  }

  async findLatestByPair(pair: string): Promise<EvidenceBundleRow | undefined> {
    const [result] = await this.db
      .select()
      .from(evidenceBundles)
      .where(eq(evidenceBundles.pair, pair))
      .orderBy(desc(evidenceBundles.receivedAtUnixMs))
      .limit(1);
    return result ? toPortRow(result) : undefined;
  }
}
