import { eq, and, gte } from "drizzle-orm";
import { normalizedObservations } from "../../db/schema/normalized-observations.js";
import type { NormalizedObservationRepo } from "../../ports/normalized-observation-repo.js";
import type {
  NormalizedObservationInsert,
  NormalizedObservationRow
} from "../../db/schema/normalized-observations.js";
import type { Db } from "../../db/db.js";

export class DrizzleNormalizedObservationRepo implements NormalizedObservationRepo {
  constructor(private readonly db: Db) {}

  async insert(row: NormalizedObservationInsert): Promise<NormalizedObservationRow> {
    const [result] = await this.db.insert(normalizedObservations).values(row).returning();
    return result!;
  }

  async findBySource(
    source: string,
    observationKind: string,
    sinceUnixMs: number
  ): Promise<NormalizedObservationRow[]> {
    return this.db
      .select()
      .from(normalizedObservations)
      .where(
        and(
          eq(normalizedObservations.source, source),
          eq(normalizedObservations.observationKind, observationKind),
          gte(normalizedObservations.receivedAtUnixMs, sinceUnixMs)
        )
      );
  }

  async findFreshByKind(
    source: string,
    observationKind: string
  ): Promise<NormalizedObservationRow[]> {
    return this.db
      .select()
      .from(normalizedObservations)
      .where(
        and(
          eq(normalizedObservations.source, source),
          eq(normalizedObservations.observationKind, observationKind),
          eq(normalizedObservations.isFresh, true)
        )
      );
  }
}
