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
    const [result] = await this.db
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
    if (result) return toPortRow(result);
    const [existing] = await this.db
      .select()
      .from(normalizedObservations)
      .where(
        and(
          eq(normalizedObservations.source, row.source),
          eq(normalizedObservations.observationKind, row.observationKind),
          eq(normalizedObservations.payloadHash, row.payloadHash)
        )
      )
      .limit(1);
    return toPortRow(existing!);
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
