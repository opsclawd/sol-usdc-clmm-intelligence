import type {
  PublishAttemptRepo,
  PublishAttemptRow,
  PublishAttemptInsert,
  PublishAttemptInsertOutcome,
  PublishAttemptStatus
} from "../../src/ports/publish-attempt-repo.js";
import {
  validatePublishAttemptInsert,
  validatePublishAttemptQueryLimit
} from "../../src/ports/publish-attempt-repo.js";

export class FakePublishAttemptRepo implements PublishAttemptRepo {
  readonly store: PublishAttemptRow[] = [];
  private nextId = 1;

  async insert(row: PublishAttemptInsert): Promise<PublishAttemptInsertOutcome> {
    validatePublishAttemptInsert(row);

    const normalized: PublishAttemptRow = {
      id: this.nextId++,
      target: row.target,
      targetEndpoint: row.targetEndpoint,
      evidenceBundleId: row.evidenceBundleId,
      researchBriefId: row.researchBriefId ?? null,
      idempotencyKey: row.idempotencyKey,
      requestHash: row.requestHash,
      payloadHash: row.payloadHash,
      status: row.status as PublishAttemptStatus,
      httpStatus: row.httpStatus ?? null,
      responseBody: row.responseBody ?? null,
      errorCode: row.errorCode ?? null,
      errorMessage: row.errorMessage ?? null,
      attemptNumber: row.attemptNumber,
      firstAttemptedAtUnixMs: row.firstAttemptedAtUnixMs,
      completedAtUnixMs: row.completedAtUnixMs ?? null,
      receivedAtUnixMs: row.receivedAtUnixMs
    };

    const existing = this.store.find(
      (stored) =>
        stored.target === normalized.target &&
        stored.idempotencyKey === normalized.idempotencyKey &&
        stored.attemptNumber === normalized.attemptNumber
    );
    if (existing) {
      return { outcome: "conflict", row: existing };
    }

    this.store.push(normalized);
    return { outcome: "inserted", row: normalized };
  }

  async findByTargetAndKey(target: string, idempotencyKey: string): Promise<PublishAttemptRow[]> {
    const rows = this.store
      .filter((r) => r.target === target && r.idempotencyKey === idempotencyKey)
      .map((r) => ({ ...r }));
    rows.sort((a, b) => a.attemptNumber - b.attemptNumber || a.id - b.id);
    return rows;
  }

  async findByBundle(evidenceBundleId: number): Promise<PublishAttemptRow[]> {
    const rows = this.store
      .filter((r) => r.evidenceBundleId === evidenceBundleId)
      .map((r) => ({ ...r }));
    rows.sort((a, b) => b.receivedAtUnixMs - a.receivedAtUnixMs || b.id - a.id);
    return rows;
  }

  async findRecentByStatus(
    status: PublishAttemptStatus,
    sinceUnixMs: number,
    limit: number
  ): Promise<PublishAttemptRow[]> {
    validatePublishAttemptQueryLimit(limit);
    const rows = this.store
      .filter((r) => r.status === status && r.receivedAtUnixMs >= sinceUnixMs)
      .map((r) => ({ ...r }));
    rows.sort((a, b) => b.receivedAtUnixMs - a.receivedAtUnixMs || b.id - a.id);
    return rows.slice(0, limit);
  }
}
