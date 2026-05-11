import { eq, and, gte } from "drizzle-orm";
import { derivedFeatures } from "../../db/schema/derived-features.js";
import type {
  DerivedFeatureRepo,
  DerivedFeatureInsert,
  DerivedFeatureRow
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
    confidenceComposite: row.confidenceComposite ? Number(row.confidenceComposite) : null,
    confidenceLevel: row.confidenceLevel,
    validUntilUnixMs: row.validUntilUnixMs ?? null,
    isStale: row.isStale,
    staleBehavior: row.staleBehavior as StaleBehavior | null,
    provenance: row.provenance as unknown as DerivedFeatureRow["provenance"],
    payloadHash: row.payloadHash,
    receivedAtUnixMs: row.receivedAtUnixMs
  };
}

export class DrizzleFeatureRepo implements DerivedFeatureRepo {
  constructor(private readonly db: Db) {}

  async insert(row: DerivedFeatureInsert): Promise<DerivedFeatureRow> {
    const [result] = await this.db
      .insert(derivedFeatures)
      .values({
        featureKind: row.featureKind,
        signalClass: row.signalClass,
        evidenceFamily: row.evidenceFamily,
        value: row.value ?? null,
        structuredPayload: row.structuredPayload ?? null,
        asOfUnixMs: row.asOfUnixMs,
        confidence: row.confidence as unknown,
        confidenceComposite:
          row.confidenceComposite != null ? String(row.confidenceComposite) : null,
        confidenceLevel: row.confidenceLevel ?? null,
        validUntilUnixMs: row.validUntilUnixMs ?? null,
        isStale: row.isStale ?? false,
        staleBehavior: row.staleBehavior ?? null,
        provenance: row.provenance as unknown,
        payloadHash: row.payloadHash,
        receivedAtUnixMs: row.receivedAtUnixMs
      })
      .onConflictDoNothing({
        target: [derivedFeatures.featureKind, derivedFeatures.payloadHash]
      })
      .returning();
    if (result) return toPortRow(result);
    const existing = await this.findByHash(row.featureKind, row.payloadHash);
    return existing!;
  }

  async findByHash(
    featureKind: FeatureKind,
    payloadHash: string
  ): Promise<DerivedFeatureRow | undefined> {
    const [result] = await this.db
      .select()
      .from(derivedFeatures)
      .where(
        and(
          eq(derivedFeatures.featureKind, featureKind),
          eq(derivedFeatures.payloadHash, payloadHash)
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
}
