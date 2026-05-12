import { eq, and } from "drizzle-orm";
import { researchBriefs } from "../../db/schema/research-briefs.js";
import type {
  ResearchBriefRepo,
  ResearchBriefInsert,
  ResearchBriefRow
} from "../../ports/brief-repo.js";
import type { SignalClass, EvidenceFamily, StaleBehavior } from "../../contracts/taxonomy.js";
import type { Db } from "../../db/db.js";

function toPortRow(row: typeof researchBriefs.$inferSelect): ResearchBriefRow {
  return {
    id: row.id,
    evidenceBundleId: row.evidenceBundleId,
    promptVersion: row.promptVersion,
    modelProvider: row.modelProvider,
    structuredOutput: row.structuredOutput,
    signalClass: row.signalClass as SignalClass,
    evidenceFamily: row.evidenceFamily as EvidenceFamily | null,
    taxonomySummary: row.taxonomySummary as ResearchBriefRow["taxonomySummary"],
    confidence: row.confidence as unknown as ResearchBriefRow["confidence"],
    confidenceComposite: row.confidenceComposite != null ? Number(row.confidenceComposite) : null,
    confidenceLevel: row.confidenceLevel,
    validUntilUnixMs: row.validUntilUnixMs ?? null,
    isStale: row.isStale,
    staleBehavior: row.staleBehavior as StaleBehavior | null,
    provenance: row.provenance as unknown as ResearchBriefRow["provenance"],
    payloadHash: row.payloadHash,
    receivedAtUnixMs: row.receivedAtUnixMs
  };
}

export class DrizzleBriefRepo implements ResearchBriefRepo {
  constructor(private readonly db: Db) {}

  async insert(row: ResearchBriefInsert): Promise<ResearchBriefRow> {
    const [result] = await this.db
      .insert(researchBriefs)
      .values({
        evidenceBundleId: row.evidenceBundleId,
        promptVersion: row.promptVersion,
        modelProvider: row.modelProvider,
        structuredOutput: row.structuredOutput,
        signalClass: row.signalClass,
        evidenceFamily: row.evidenceFamily,
        taxonomySummary: row.taxonomySummary ?? null,
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
        receivedAtUnixMs: row.receivedAtUnixMs
      })
      .onConflictDoNothing({
        target: [researchBriefs.evidenceBundleId, researchBriefs.payloadHash]
      })
      .returning();
    if (result) return toPortRow(result);
    const existing = await this.findByHash(row.evidenceBundleId, row.payloadHash);
    return existing!;
  }

  async findByHash(
    evidenceBundleId: number,
    payloadHash: string
  ): Promise<ResearchBriefRow | undefined> {
    const [result] = await this.db
      .select()
      .from(researchBriefs)
      .where(
        and(
          eq(researchBriefs.evidenceBundleId, evidenceBundleId),
          eq(researchBriefs.payloadHash, payloadHash)
        )
      )
      .limit(1);
    return result ? toPortRow(result) : undefined;
  }

  async findByBundleId(evidenceBundleId: number): Promise<ResearchBriefRow[]> {
    const rows = await this.db
      .select()
      .from(researchBriefs)
      .where(eq(researchBriefs.evidenceBundleId, evidenceBundleId));
    return rows.map(toPortRow);
  }
}
