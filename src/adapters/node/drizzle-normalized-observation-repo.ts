import { eq, and, gte, or, asc, desc } from "drizzle-orm";
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
      const values = rows.map((row) => ({
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
      }));

      const inserted = await tx
        .insert(normalizedObservations)
        .values(values)
        .onConflictDoNothing({
          target: [
            normalizedObservations.rawObservationId,
            normalizedObservations.observationKind,
            normalizedObservations.payloadHash
          ]
        })
        .returning();

      const insertedCount = inserted.length;

      if (insertedCount === rows.length) {
        return inserted.map(toPortRow);
      }

      if (insertedCount === 0) {
        const conflictKeys = rows.map((r) => ({
          rawObservationId: r.rawObservationId,
          observationKind: r.observationKind,
          payloadHash: r.payloadHash
        }));

        const filterConditions = conflictKeys.map((key) =>
          and(
            eq(normalizedObservations.rawObservationId, key.rawObservationId),
            eq(normalizedObservations.observationKind, key.observationKind),
            eq(normalizedObservations.payloadHash, key.payloadHash)
          )
        );

        const existingRows = await tx
          .select()
          .from(normalizedObservations)
          .where(or(...filterConditions));

        const existingMap = new Map<string, typeof normalizedObservations.$inferSelect>();
        for (const r of existingRows) {
          const key = `${r.rawObservationId}:${r.observationKind}:${r.payloadHash}`;
          existingMap.set(key, r);
        }

        return rows.map((row) => {
          const key = `${row.rawObservationId}:${row.observationKind}:${row.payloadHash}`;
          const existing = existingMap.get(key);
          if (existing === undefined) {
            throw new Error(`Concurrent deletion conflict: no existing row found for key=${key}`);
          }
          return toPortRow(existing);
        });
      }

      const insertedMap = new Map<string, typeof normalizedObservations.$inferSelect>();
      for (const r of inserted) {
        const key = `${r.rawObservationId}:${r.observationKind}:${r.payloadHash}`;
        insertedMap.set(key, r);
      }

      const results: NormalizedObservationRow[] = new Array(rows.length);
      for (let i = 0; i < rows.length; i++) {
        const key = `${rows[i]!.rawObservationId}:${rows[i]!.observationKind}:${rows[i]!.payloadHash}`;
        const insertedRow = insertedMap.get(key);
        if (insertedRow !== undefined) {
          results[i] = toPortRow(insertedRow);
        }
      }

      const missingKeys = rows
        .filter((_, i) => results[i] === undefined)
        .map((r) => ({
          rawObservationId: r.rawObservationId,
          observationKind: r.observationKind,
          payloadHash: r.payloadHash
        }));

      if (missingKeys.length > 0) {
        const filterConditions = missingKeys.map((key) =>
          and(
            eq(normalizedObservations.rawObservationId, key.rawObservationId),
            eq(normalizedObservations.observationKind, key.observationKind),
            eq(normalizedObservations.payloadHash, key.payloadHash)
          )
        );

        const existingRows = await tx
          .select()
          .from(normalizedObservations)
          .where(or(...filterConditions));

        const existingMap = new Map<string, typeof normalizedObservations.$inferSelect>();
        for (const r of existingRows) {
          const key = `${r.rawObservationId}:${r.observationKind}:${r.payloadHash}`;
          existingMap.set(key, r);
        }

        for (let i = 0; i < rows.length; i++) {
          if (results[i] === undefined) {
            const key = `${rows[i]!.rawObservationId}:${rows[i]!.observationKind}:${rows[i]!.payloadHash}`;
            const existing = existingMap.get(key);
            if (existing === undefined) {
              throw new Error(`Concurrent deletion conflict: no existing row found for key=${key}`);
            }
            results[i] = toPortRow(existing);
          }
        }
      }

      return results;
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
      )
      .orderBy(asc(normalizedObservations.receivedAtUnixMs));
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

  async findLatestByKind(
    source: Source,
    observationKind: ObservationKind
  ): Promise<NormalizedObservationRow | null> {
    const rows = await this.db
      .select()
      .from(normalizedObservations)
      .where(
        and(
          eq(normalizedObservations.source, source),
          eq(normalizedObservations.observationKind, observationKind)
        )
      )
      .orderBy(desc(normalizedObservations.receivedAtUnixMs))
      .limit(1);
    const row = rows[0];
    return row ? toPortRow(row) : null;
  }

  async findByRawObservation(
    rawObservationId: number,
    observationKind: ObservationKind
  ): Promise<NormalizedObservationRow | null> {
    const rows = await this.db
      .select()
      .from(normalizedObservations)
      .where(
        and(
          eq(normalizedObservations.rawObservationId, rawObservationId),
          eq(normalizedObservations.observationKind, observationKind)
        )
      )
      .orderBy(desc(normalizedObservations.receivedAtUnixMs))
      .limit(1);
    const row = rows[0];
    return row ? toPortRow(row) : null;
  }
}
