import { eq, and, gte } from "drizzle-orm";
import { rawObservations } from "../../db/schema/raw-observations.js";
import type {
  RawObservationRepo,
  RawObservationInsert,
  RawObservationRow,
  RawInsertOutcome
} from "../../ports/observation-repo.js";
import type { Source, ParseStatus } from "../../contracts/taxonomy.js";
import type { Db } from "../../db/db.js";

function toPortRow(row: typeof rawObservations.$inferSelect): RawObservationRow {
  return {
    id: row.id,
    source: row.source as Source,
    sourceObservationKey: row.sourceObservationKey as string,
    observedAtUnixMs: row.observedAtUnixMs,
    fetchedAtUnixMs: row.fetchedAtUnixMs,
    payloadHash: row.payloadHash,
    payloadCanonical: row.payloadCanonical,
    parseStatus: row.parseStatus as RawObservationRow["parseStatus"],
    sourceRequestMeta: row.sourceRequestMeta,
    receivedAtUnixMs: row.receivedAtUnixMs
  };
}

export class DrizzleObservationRepo implements RawObservationRepo {
  constructor(private readonly db: Db) {}

  async insertOrClassify(row: RawObservationInsert): Promise<RawInsertOutcome> {
    const [result] = await this.db
      .insert(rawObservations)
      .values({
        source: row.source,
        sourceObservationKey: row.sourceObservationKey,
        observedAtUnixMs: row.observedAtUnixMs,
        fetchedAtUnixMs: row.fetchedAtUnixMs,
        payloadHash: row.payloadHash,
        payloadCanonical: row.payloadCanonical,
        parseStatus: row.parseStatus ?? "pending",
        sourceRequestMeta: row.sourceRequestMeta ?? null,
        receivedAtUnixMs: row.receivedAtUnixMs
      })
      .onConflictDoNothing({
        target: [rawObservations.source, rawObservations.sourceObservationKey]
      })
      .returning();

    if (result) {
      return { outcome: "inserted", row: toPortRow(result) };
    }

    const existing = await this.findByIdentity(row.source, row.sourceObservationKey);
    if (!existing) {
      throw new Error("Unexpected: row not found after conflict");
    }

    if (existing.payloadHash === row.payloadHash) {
      return { outcome: "identical_replay", row: existing };
    }

    return { outcome: "conflict", row: existing, incomingPayloadHash: row.payloadHash };
  }

  async findById(id: number): Promise<RawObservationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(rawObservations)
      .where(eq(rawObservations.id, id))
      .limit(1);
    return row ? toPortRow(row) : undefined;
  }

  async findByIdentity(
    source: Source,
    sourceObservationKey: string
  ): Promise<RawObservationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(rawObservations)
      .where(
        and(
          eq(rawObservations.source, source),
          eq(rawObservations.sourceObservationKey, sourceObservationKey)
        )
      )
      .limit(1);
    return row ? toPortRow(row) : undefined;
  }

  async findByHash(source: Source, payloadHash: string): Promise<RawObservationRow | undefined> {
    const [result] = await this.db
      .select()
      .from(rawObservations)
      .where(and(eq(rawObservations.source, source), eq(rawObservations.payloadHash, payloadHash)))
      .limit(1);
    return result ? toPortRow(result) : undefined;
  }

  async findBySource(source: Source, sinceUnixMs: number): Promise<RawObservationRow[]> {
    const rows = await this.db
      .select()
      .from(rawObservations)
      .where(
        and(eq(rawObservations.source, source), gte(rawObservations.observedAtUnixMs, sinceUnixMs))
      );
    return rows.map(toPortRow);
  }

  async updateParseStatus(id: number, status: ParseStatus): Promise<RawObservationRow> {
    const [updated] = await this.db
      .update(rawObservations)
      .set({ parseStatus: status })
      .where(eq(rawObservations.id, id))
      .returning();
    if (!updated) {
      throw new Error(`Row with id ${id} not found`);
    }
    return toPortRow(updated);
  }
}
