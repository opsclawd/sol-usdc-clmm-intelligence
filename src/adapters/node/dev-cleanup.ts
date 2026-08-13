import { inArray } from "drizzle-orm";
import type { DbConnection } from "../../ports/db.js";
import { normalizedObservations } from "../../db/schema/normalized-observations.js";
import { rawObservations } from "../../db/schema/raw-observations.js";
import { DrizzlePgAdapter } from "./drizzle-pg.js";

export async function cleanupObservationRows(
  connection: DbConnection,
  ids: readonly number[]
): Promise<void> {
  const uniqueIds = Array.from(new Set(ids)).filter((id) => id > 0);
  if (uniqueIds.length === 0) return;

  const drizzleDb =
    connection instanceof DrizzlePgAdapter
      ? connection.db
      : (
          connection as unknown as {
            db: { delete: (table: unknown) => { where: (condition: unknown) => Promise<unknown> } };
          }
        ).db;

  if (!drizzleDb) {
    throw new Error(
      "Unable to perform dev cleanup: connection does not expose a Drizzle database instance"
    );
  }

  await drizzleDb
    .delete(normalizedObservations)
    .where(inArray(normalizedObservations.rawObservationId, uniqueIds));
  await drizzleDb.delete(rawObservations).where(inArray(rawObservations.id, uniqueIds));
}
