import { eq, and, gte, lte, or, inArray, desc } from "drizzle-orm";
import { derivedFeatures } from "../../db/schema/derived-features.js";
import type {
  DerivedFeatureRepo,
  DerivedFeatureInsert,
  DerivedFeatureRow,
  BundleFeatureCandidateQuery
} from "../../ports/feature-repo.js";
import type {
  FeatureKind,
  SignalClass,
  EvidenceFamily,
  StaleBehavior
} from "../../contracts/taxonomy.js";
import type { Db } from "../../db/db.js";

function toPortRow(row: typeof derivedFeatures.$inferSelect): DerivedFeatureRow {
  return {
    id: row.id,
    featureKind: row.featureKind as FeatureKind,
    signalClass: row.signalClass as SignalClass,
    evidenceFamily: row.evidenceFamily as EvidenceFamily,
    value: row.value,
    structuredPayload: row.structuredPayload,
    asOfUnixMs: row.asOfUnixMs,
    confidence: row.confidence as unknown as DerivedFeatureRow["confidence"],
    confidenceComposite: row.confidenceComposite != null ? Number(row.confidenceComposite) : null,
    confidenceLevel: row.confidenceLevel,
    validUntilUnixMs: row.validUntilUnixMs ?? null,
    isStale: row.isStale,
    staleBehavior: row.staleBehavior as StaleBehavior | null,
    provenance: row.provenance as unknown as DerivedFeatureRow["provenance"],
    payloadHash: row.payloadHash,
    receivedAtUnixMs: row.receivedAtUnixMs,
    status: row.status as "AVAILABLE" | "PARTIAL" | "UNAVAILABLE",
    unit: row.unit as "BPS" | "PPM",
    pair: row.pair,
    calculatorVersion: row.calculatorVersion,
    selectionVersion: row.selectionVersion,
    inputObservationIds: row.inputObservationIds,
    rejectedObservationIds: row.rejectedObservationIds,
    derivationKey: row.derivationKey,
    poolId: row.poolId,
    positionId: row.positionId,
    warnings: row.warnings ?? [],
    reasons: row.reasons ?? []
  };
}

export class DrizzleFeatureRepo implements DerivedFeatureRepo {
  constructor(private readonly db: Db) {}

  async insert(row: DerivedFeatureInsert): Promise<DerivedFeatureRow> {
    const results = await this.insertMany([row]);
    return results[0]!;
  }

  async insertMany(rows: readonly DerivedFeatureInsert[]): Promise<DerivedFeatureRow[]> {
    if (rows.length === 0) return [];

    return this.db.transaction(async (tx) => {
      const values = rows.map((row) => ({
        featureKind: row.featureKind,
        signalClass: row.signalClass,
        evidenceFamily: row.evidenceFamily,
        value: row.value ?? null,
        structuredPayload: row.structuredPayload,
        asOfUnixMs: row.asOfUnixMs,
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
        payloadHash: row.payloadHash,
        receivedAtUnixMs: row.receivedAtUnixMs,
        status: row.status,
        unit: row.unit,
        pair: row.pair ?? "SOL/USDC",
        calculatorVersion: row.calculatorVersion ?? "1.0",
        selectionVersion: row.selectionVersion ?? "1.0",
        inputObservationIds: row.inputObservationIds ?? [],
        rejectedObservationIds: row.rejectedObservationIds ?? [],
        derivationKey: row.derivationKey,
        poolId: row.poolId ?? null,
        positionId: row.positionId ?? null
      }));

      const inserted = await tx
        .insert(derivedFeatures)
        .values(values)
        .onConflictDoNothing({
          target: [derivedFeatures.featureKind, derivedFeatures.derivationKey]
        })
        .returning();

      const insertedCount = inserted.length;

      if (insertedCount === rows.length) {
        return inserted.map(toPortRow);
      }

      if (insertedCount === 0) {
        const conflictKeys = rows.map((r) => ({
          featureKind: r.featureKind,
          derivationKey: r.derivationKey
        }));

        const filterConditions = conflictKeys.map((key) =>
          and(
            eq(derivedFeatures.featureKind, key.featureKind),
            eq(derivedFeatures.derivationKey, key.derivationKey)
          )
        );

        const existingRows = await tx
          .select()
          .from(derivedFeatures)
          .where(or(...filterConditions));

        const existingMap = new Map<string, typeof derivedFeatures.$inferSelect>();
        for (const r of existingRows) {
          const key = `${r.featureKind}:${r.derivationKey}`;
          existingMap.set(key, r);
        }

        return rows.map((row) => {
          const key = `${row.featureKind}:${row.derivationKey}`;
          const existing = existingMap.get(key);
          if (existing === undefined) {
            throw new Error(`Concurrent deletion conflict: no existing row found for key=${key}`);
          }
          return toPortRow(existing);
        });
      }

      const insertedMap = new Map<string, typeof derivedFeatures.$inferSelect>();
      for (const r of inserted) {
        const key = `${r.featureKind}:${r.derivationKey}`;
        insertedMap.set(key, r);
      }

      const results: DerivedFeatureRow[] = new Array(rows.length);
      for (let i = 0; i < rows.length; i++) {
        const key = `${rows[i]!.featureKind}:${rows[i]!.derivationKey}`;
        const insertedRow = insertedMap.get(key);
        if (insertedRow !== undefined) {
          results[i] = toPortRow(insertedRow);
        }
      }

      const missingKeys = rows
        .filter((_, i) => results[i] === undefined)
        .map((r) => ({
          featureKind: r.featureKind,
          derivationKey: r.derivationKey
        }));

      if (missingKeys.length > 0) {
        const filterConditions = missingKeys.map((key) =>
          and(
            eq(derivedFeatures.featureKind, key.featureKind),
            eq(derivedFeatures.derivationKey, key.derivationKey)
          )
        );

        const existingRows = await tx
          .select()
          .from(derivedFeatures)
          .where(or(...filterConditions));

        const existingMap = new Map<string, typeof derivedFeatures.$inferSelect>();
        for (const r of existingRows) {
          const key = `${r.featureKind}:${r.derivationKey}`;
          existingMap.set(key, r);
        }

        for (let i = 0; i < rows.length; i++) {
          if (results[i] === undefined) {
            const key = `${rows[i]!.featureKind}:${rows[i]!.derivationKey}`;
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

  async findByDerivationKey(
    featureKind: FeatureKind,
    derivationKey: string
  ): Promise<DerivedFeatureRow | undefined> {
    const [result] = await this.db
      .select()
      .from(derivedFeatures)
      .where(
        and(
          eq(derivedFeatures.featureKind, featureKind),
          eq(derivedFeatures.derivationKey, derivationKey)
        )
      )
      .limit(1);
    return result ? toPortRow(result) : undefined;
  }

  async findByKind(featureKind: FeatureKind, sinceUnixMs: number): Promise<DerivedFeatureRow[]> {
    const rows = await this.db
      .select()
      .from(derivedFeatures)
      .where(
        and(
          eq(derivedFeatures.featureKind, featureKind),
          gte(derivedFeatures.asOfUnixMs, sinceUnixMs)
        )
      );
    return rows.map(toPortRow);
  }

  async listBundleCandidates(query: BundleFeatureCandidateQuery): Promise<DerivedFeatureRow[]> {
    const conditions = [
      inArray(derivedFeatures.featureKind, [...query.featureKinds]),
      eq(derivedFeatures.pair, query.pair),
      gte(derivedFeatures.asOfUnixMs, query.asOfAtOrAfterUnixMs),
      lte(derivedFeatures.asOfUnixMs, query.asOfAtOrBeforeUnixMs),
      lte(derivedFeatures.receivedAtUnixMs, query.receivedAtOrBeforeUnixMs)
    ];

    if (query.poolId !== undefined) {
      conditions.push(eq(derivedFeatures.poolId, query.poolId));
    }
    if (query.positionId !== undefined) {
      conditions.push(eq(derivedFeatures.positionId, query.positionId));
    }

    const rows = await this.db
      .select()
      .from(derivedFeatures)
      .where(and(...conditions))
      .orderBy(
        desc(derivedFeatures.asOfUnixMs),
        desc(derivedFeatures.receivedAtUnixMs),
        desc(derivedFeatures.id)
      );

    return rows.map(toPortRow);
  }
}
