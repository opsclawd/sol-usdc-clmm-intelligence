import { eq, and, gte } from "drizzle-orm";
import { normalizedObservations } from "../../db/schema/normalized-observations.js";
import type {
  NormalizedObservationRepo,
  NormalizedObservationInsert,
  NormalizedObservationRow
} from "../../ports/normalized-observation-repo.js";
import type {
  Source,
  ObservationKind,
  SignalClass,
  EvidenceFamily,
  StaleBehavior
} from "../../contracts/taxonomy.js";
import type { Db } from "../../db/db.js";

function toPortRow(row: typeof normalizedObservations.$inferSelect): NormalizedObservationRow {
  return {
    id: row.id,
    rawObservationId: row.rawObservationId,
    source: row.source as Source,
    observationKind: row.observationKind as ObservationKind,
    signalClass: row.signalClass as SignalClass,
    evidenceFamily: row.evidenceFamily as EvidenceFamily,
    payload: row.payload,
    payloadHash: row.payloadHash,
    confidence: row.confidence as unknown as NormalizedObservationRow["confidence"],
    confidenceComposite: row.confidenceComposite != null ? Number(row.confidenceComposite) : null,
    confidenceLevel: row.confidenceLevel,
    validUntilUnixMs: row.validUntilUnixMs ?? null,
    isStale: row.isStale,
    staleBehavior: row.staleBehavior as StaleBehavior | null,
    provenance: row.provenance as unknown as NormalizedObservationRow["provenance"],
    receivedAtUnixMs: row.receivedAtUnixMs
  };
}

export class DrizzleNormalizedObservationRepo implements NormalizedObservationRepo {
  constructor(private readonly db: Db) {}

  async insert(row: NormalizedObservationInsert): Promise<NormalizedObservationRow> {
    const results = await this.insertMany([row]);
    return results[0]!;
  }

  async insertMany(
    rows: readonly NormalizedObservationInsert[]
  ): Promise<NormalizedObservationRow[]> {
    if (rows.length === 0) return [];

    return this.db.transaction(async (tx) => {
      const results: (typeof normalizedObservations.$inferSelect | null)[] = new Array(
        rows.length
      ).fill(null);

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        const [inserted] = await tx
          .insert(normalizedObservations)
          .values({
            rawObservationId: row.rawObservationId,
            source: row.source,
            observationKind: row.observationKind,
            signalClass: row.signalClass,
            evidenceFamily: row.evidenceFamily,
            payload: row.payload,
            payloadHash: row.payloadHash,
            confidence: row.confidence as unknown,
            confidenceComposite:
              row.confidenceComposite != null
                ? String(row.confidenceComposite)
                : row.confidence.compositeScore != null
                  ? String(row.confidence.compositeScore)
                  : null,
            confidenceLevel: row.confidenceLevel ?? row.confidence.level ?? null,
            validUntilUnixMs: row.validUntilUnixMs ?? null,
            isStale: row.isStale ?? false,
            staleBehavior: row.staleBehavior ?? null,
            provenance: row.provenance as unknown,
            receivedAtUnixMs: row.receivedAtUnixMs
          })
          .onConflictDoNothing({
            target: [
              normalizedObservations.rawObservationId,
              normalizedObservations.observationKind,
              normalizedObservations.payloadHash
            ]
          })
          .returning();

        if (inserted) {
          results[i] = inserted;
        } else {
          const [existing] = await tx
            .select()
            .from(normalizedObservations)
            .where(
              and(
                eq(normalizedObservations.rawObservationId, row.rawObservationId),
                eq(normalizedObservations.observationKind, row.observationKind),
                eq(normalizedObservations.payloadHash, row.payloadHash)
              )
            )
            .limit(1);
          results[i] = existing ?? null;
        }
      }

      return results.map((r) => toPortRow(r!));
    });
  }

  async findBySource(
    source: Source,
    observationKind: ObservationKind,
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
    source: Source,
    observationKind: ObservationKind
  ): Promise<NormalizedObservationRow[]> {
    const rows = await this.db
      .select()
      .from(normalizedObservations)
      .where(
        and(
          eq(normalizedObservations.source, source),
          eq(normalizedObservations.observationKind, observationKind),
          eq(normalizedObservations.isStale, false)
        )
      );
    return rows.map(toPortRow);
  }
}
