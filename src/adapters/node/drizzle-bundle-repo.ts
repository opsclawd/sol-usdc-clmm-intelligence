import { eq, gte, desc, and } from "drizzle-orm";
import { evidenceBundles } from "../../db/schema/evidence-bundles.js";
import type {
  EvidenceBundleRepo,
  EvidenceBundleInsert,
  EvidenceBundleRow,
  EvidenceBundleInsertOutcome
} from "../../ports/bundle-repo.js";
import type { SignalClass, StaleBehavior } from "../../contracts/taxonomy.js";
import type { Db } from "../../db/db.js";

function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isDeepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.hasOwn(bObj, key)) return false;
    if (!isDeepEqual(aObj[key], bObj[key])) return false;
  }
  return true;
}

function toPortRow(row: typeof evidenceBundles.$inferSelect): EvidenceBundleRow {
  return {
    id: row.id,
    schemaVersion: row.schemaVersion,
    pair: row.pair,
    asOfUnixMs: row.asOfUnixMs,
    expiresAtUnixMs: row.expiresAtUnixMs,
    payload: row.payload,
    payloadHash: row.payloadHash,
    payloadCanonical: row.payloadCanonical,
    idempotencyKey: row.idempotencyKey,
    taxonomySummary: row.taxonomySummary as EvidenceBundleRow["taxonomySummary"],
    dominantSignalClass: row.dominantSignalClass as SignalClass,
    confidence: row.confidence as unknown as EvidenceBundleRow["confidence"],
    confidenceComposite: row.confidenceComposite != null ? Number(row.confidenceComposite) : null,
    confidenceLevel: row.confidenceLevel,
    validUntilUnixMs: row.validUntilUnixMs ?? null,
    isStale: row.isStale,
    staleBehavior: row.staleBehavior as StaleBehavior | null,
    provenance: row.provenance as unknown as EvidenceBundleRow["provenance"],
    version: row.version,
    receivedAtUnixMs: row.receivedAtUnixMs
  };
}

export class DrizzleBundleRepo implements EvidenceBundleRepo {
  constructor(private readonly db: Db) {}

  async insertOrClassify(row: EvidenceBundleInsert): Promise<EvidenceBundleInsertOutcome> {
    const parsedPayload = JSON.parse(JSON.stringify(row.payload));
    const parsedCanonical = JSON.parse(row.payloadCanonical);
    if (!isDeepEqual(parsedPayload, parsedCanonical)) {
      throw new Error(
        `Canonical text does not match payload: canonical=${row.payloadCanonical}, payload=${JSON.stringify(row.payload)}`
      );
    }

    const [result] = await this.db
      .insert(evidenceBundles)
      .values({
        schemaVersion: row.schemaVersion,
        pair: row.pair,
        asOfUnixMs: row.asOfUnixMs,
        expiresAtUnixMs: row.expiresAtUnixMs,
        payload: row.payload,
        payloadHash: row.payloadHash,
        payloadCanonical: row.payloadCanonical,
        idempotencyKey: row.idempotencyKey,
        taxonomySummary: row.taxonomySummary ?? null,
        dominantSignalClass: row.dominantSignalClass ?? "deterministic",
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
        version: row.version ?? 1,
        receivedAtUnixMs: row.receivedAtUnixMs
      })
      .onConflictDoNothing({
        target: [
          evidenceBundles.schemaVersion,
          evidenceBundles.pair,
          evidenceBundles.idempotencyKey
        ]
      })
      .returning();

    if (result) {
      return { outcome: "inserted", row: toPortRow(result) };
    }

    const [existing] = await this.db
      .select()
      .from(evidenceBundles)
      .where(
        and(
          eq(evidenceBundles.schemaVersion, row.schemaVersion),
          eq(evidenceBundles.pair, row.pair),
          eq(evidenceBundles.idempotencyKey, row.idempotencyKey)
        )
      )
      .limit(1);

    if (!existing) {
      throw new Error(
        "Failed to insert or find existing bundle on conflict - row not found after insert attempt"
      );
    }

    if (
      existing.payloadHash === row.payloadHash &&
      existing.payloadCanonical === row.payloadCanonical
    ) {
      return { outcome: "identical_replay", row: toPortRow(existing) };
    }

    return {
      outcome: "conflict",
      row: toPortRow(existing),
      incomingPayloadHash: row.payloadHash
    };
  }

  async findByPair(pair: string, sinceUnixMs: number): Promise<EvidenceBundleRow[]> {
    const rows = await this.db
      .select()
      .from(evidenceBundles)
      .where(and(eq(evidenceBundles.pair, pair), gte(evidenceBundles.asOfUnixMs, sinceUnixMs)));
    return rows.map(toPortRow);
  }

  async findLatestByPair(pair: string): Promise<EvidenceBundleRow | undefined> {
    const [result] = await this.db
      .select()
      .from(evidenceBundles)
      .where(eq(evidenceBundles.pair, pair))
      .orderBy(desc(evidenceBundles.receivedAtUnixMs))
      .limit(1);
    return result ? toPortRow(result) : undefined;
  }
}
