import { eq, and, gte } from "drizzle-orm";
import { normalizedObservations } from "../../db/schema/normalized-observations.js";
import type {
  NormalizedObservationRepo,
  NormalizedObservationInsert,
  NormalizedObservationRow
} from "../../ports/normalized-observation-repo.js";
import type { Db } from "../../db/db.js";

function toPortRow(row: typeof normalizedObservations.$inferSelect): NormalizedObservationRow {
  return {
    id: row.id,
    rawObservationId: row.rawObservationId,
    source: row.source,
    observationKind: row.observationKind,
    payload: row.payload,
    payloadHash: row.payloadHash,
    isFresh: row.isFresh,
    receivedAtUnixMs: row.receivedAtUnixMs
  };
}

export class DrizzleNormalizedObservationRepo implements NormalizedObservationRepo {
  constructor(private readonly db: Db) {}

  async insert(row: NormalizedObservationInsert): Promise<NormalizedObservationRow> {
    const [result] = await this.db
      .insert(normalizedObservations)
      .values(row)
      .onConflictDoNothing({
        target: [
          normalizedObservations.source,
          normalizedObservations.observationKind,
          normalizedObservations.payloadHash
        ]
      })
      .returning();
    if (result) return toPortRow(result);
    const existing = await this.findFreshByKind(row.source, row.observationKind);
    return existing[0]!;
  }

  async findBySource(
    source: string,
    observationKind: string,
    sinceUnixMs: number
  ): Promise<NormalizedObservationRow[]> {
    const rows = await this.db
      .select()
      .from(normalizedObservations)
      .where(
        and(
          eq(normalizedObservations.source, source),
          eq(normalizedObservations.observationKind, observationKind),
          gte(normalizedObservations.receivedAtUnixMs, sinceUnixMs)
        )
      );
    return rows.map(toPortRow);
  }

  async findFreshByKind(
    source: string,
    observationKind: string
  ): Promise<NormalizedObservationRow[]> {
    const rows = await this.db
      .select()
      .from(normalizedObservations)
      .where(
        and(
          eq(normalizedObservations.source, source),
          eq(normalizedObservations.observationKind, observationKind),
          eq(normalizedObservations.isFresh, true)
        )
      );
    return rows.map(toPortRow);
  }
}
