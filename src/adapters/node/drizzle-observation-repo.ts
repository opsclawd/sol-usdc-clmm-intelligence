import { eq, and, gte } from "drizzle-orm";
import { rawObservations } from "../../db/schema/raw-observations.js";
import type {
  RawObservationRepo,
  RawObservationInsert,
  RawObservationRow
} from "../../ports/observation-repo.js";
import type { Db } from "../../db/db.js";

function toPortRow(row: typeof rawObservations.$inferSelect): RawObservationRow {
  return {
    id: row.id,
    source: row.source,
    observedAtUnixMs: row.observedAtUnixMs,
    fetchedAtUnixMs: row.fetchedAtUnixMs,
    payloadHash: row.payloadHash,
    payloadCanonical: row.payloadCanonical,
    parseStatus: row.parseStatus,
    sourceRequestMeta: row.sourceRequestMeta,
    receivedAtUnixMs: row.receivedAtUnixMs
  };
}

export class DrizzleObservationRepo implements RawObservationRepo {
  constructor(private readonly db: Db) {}

  async insert(row: RawObservationInsert): Promise<RawObservationRow> {
    const [result] = await this.db.insert(rawObservations).values(row).returning();
    return toPortRow(result!);
  }

  async findByHash(source: string, payloadHash: string): Promise<RawObservationRow | undefined> {
    const [result] = await this.db
      .select()
      .from(rawObservations)
      .where(and(eq(rawObservations.source, source), eq(rawObservations.payloadHash, payloadHash)))
      .limit(1);
    return result ? toPortRow(result) : undefined;
  }

  async findBySource(source: string, sinceUnixMs: number): Promise<RawObservationRow[]> {
    const rows = await this.db
      .select()
      .from(rawObservations)
      .where(
        and(eq(rawObservations.source, source), gte(rawObservations.observedAtUnixMs, sinceUnixMs))
      );
    return rows.map(toPortRow);
  }
}
