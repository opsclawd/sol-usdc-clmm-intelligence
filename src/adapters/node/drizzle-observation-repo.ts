import { eq, and, gte } from "drizzle-orm";
import { rawObservations } from "../../db/schema/raw-observations.js";
import type { RawObservationRepo } from "../../ports/observation-repo.js";
import type { RawObservationInsert, RawObservationRow } from "../../db/schema/raw-observations.js";
import type { Db } from "../../db/db.js";

export class DrizzleObservationRepo implements RawObservationRepo {
  constructor(private readonly db: Db) {}

  async insert(row: RawObservationInsert): Promise<RawObservationRow> {
    const [result] = await this.db.insert(rawObservations).values(row).returning();
    return result!;
  }

  async findByHash(source: string, payloadHash: string): Promise<RawObservationRow | undefined> {
    const [result] = await this.db
      .select()
      .from(rawObservations)
      .where(and(eq(rawObservations.source, source), eq(rawObservations.payloadHash, payloadHash)))
      .limit(1);
    return result;
  }

  async findBySource(source: string, sinceUnixMs: number): Promise<RawObservationRow[]> {
    return this.db
      .select()
      .from(rawObservations)
      .where(
        and(eq(rawObservations.source, source), gte(rawObservations.observedAtUnixMs, sinceUnixMs))
      );
  }
}
