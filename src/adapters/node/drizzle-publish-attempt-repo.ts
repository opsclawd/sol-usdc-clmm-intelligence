import { eq, and, gte, desc, asc } from "drizzle-orm";
import { publishAttempts } from "../../db/schema/publish-attempts.js";
import type {
  PublishAttemptRepo,
  PublishAttemptInsert,
  PublishAttemptRow,
  PublishAttemptInsertOutcome,
  PublishAttemptStatus
} from "../../ports/publish-attempt-repo.js";
import {
  validatePublishAttemptInsert,
  validatePublishAttemptQueryLimit
} from "../../ports/publish-attempt-repo.js";
import type { Db } from "../../db/db.js";

function toPortRow(row: typeof publishAttempts.$inferSelect): PublishAttemptRow {
  return {
    id: row.id,
    target: row.target,
    targetEndpoint: row.targetEndpoint,
    evidenceBundleId: row.evidenceBundleId,
    researchBriefId: row.researchBriefId,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    payloadHash: row.payloadHash,
    status: row.status as PublishAttemptStatus,
    httpStatus: row.httpStatus,
    responseBody: row.responseBody,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    attemptNumber: row.attemptNumber,
    firstAttemptedAtUnixMs: Number(row.firstAttemptedAtUnixMs),
    completedAtUnixMs: row.completedAtUnixMs != null ? Number(row.completedAtUnixMs) : null,
    receivedAtUnixMs: Number(row.receivedAtUnixMs)
  };
}

export class DrizzlePublishAttemptRepo implements PublishAttemptRepo {
  constructor(private readonly db: Db) {}

  async insert(row: PublishAttemptInsert): Promise<PublishAttemptInsertOutcome> {
    validatePublishAttemptInsert(row);

    const [result] = await this.db
      .insert(publishAttempts)
      .values({
        target: row.target,
        targetEndpoint: row.targetEndpoint,
        evidenceBundleId: row.evidenceBundleId,
        researchBriefId: row.researchBriefId ?? null,
        idempotencyKey: row.idempotencyKey,
        requestHash: row.requestHash,
        payloadHash: row.payloadHash,
        status: row.status,
        httpStatus: row.httpStatus ?? null,
        responseBody: row.responseBody ?? null,
        errorCode: row.errorCode ?? null,
        errorMessage: row.errorMessage ?? null,
        attemptNumber: row.attemptNumber,
        firstAttemptedAtUnixMs: BigInt(row.firstAttemptedAtUnixMs),
        completedAtUnixMs: row.completedAtUnixMs != null ? BigInt(row.completedAtUnixMs) : null,
        receivedAtUnixMs: BigInt(row.receivedAtUnixMs)
      })
      .onConflictDoNothing({
        target: [
          publishAttempts.target,
          publishAttempts.idempotencyKey,
          publishAttempts.attemptNumber
        ]
      })
      .returning();

    if (result) {
      return { outcome: "inserted", row: toPortRow(result) };
    }

    const [existing] = await this.db
      .select()
      .from(publishAttempts)
      .where(
        and(
          eq(publishAttempts.target, row.target),
          eq(publishAttempts.idempotencyKey, row.idempotencyKey),
          eq(publishAttempts.attemptNumber, row.attemptNumber)
        )
      )
      .limit(1);

    if (!existing) {
      throw new Error("Publish attempt conflict row disappeared before reload");
    }

    return { outcome: "conflict", row: toPortRow(existing) };
  }

  async findByTargetAndKey(target: string, idempotencyKey: string): Promise<PublishAttemptRow[]> {
    const rows = await this.db
      .select()
      .from(publishAttempts)
      .where(
        and(eq(publishAttempts.target, target), eq(publishAttempts.idempotencyKey, idempotencyKey))
      )
      .orderBy(asc(publishAttempts.attemptNumber), asc(publishAttempts.id));
    return rows.map(toPortRow);
  }

  async findByBundle(evidenceBundleId: number): Promise<PublishAttemptRow[]> {
    const rows = await this.db
      .select()
      .from(publishAttempts)
      .where(eq(publishAttempts.evidenceBundleId, evidenceBundleId))
      .orderBy(desc(publishAttempts.receivedAtUnixMs), desc(publishAttempts.id));
    return rows.map(toPortRow);
  }

  async findRecentByStatus(
    status: PublishAttemptStatus,
    sinceUnixMs: number,
    limit: number
  ): Promise<PublishAttemptRow[]> {
    validatePublishAttemptQueryLimit(limit);
    const rows = await this.db
      .select()
      .from(publishAttempts)
      .where(
        and(
          eq(publishAttempts.status, status),
          gte(publishAttempts.receivedAtUnixMs, BigInt(sinceUnixMs))
        )
      )
      .orderBy(desc(publishAttempts.receivedAtUnixMs), desc(publishAttempts.id))
      .limit(limit);
    return rows.map(toPortRow);
  }
}
