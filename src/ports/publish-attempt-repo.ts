export type PublishAttemptStatus =
  | "pending"
  | "sent"
  | "created"
  | "idempotent_replay"
  | "validation_failed"
  | "auth_failed"
  | "conflict"
  | "store_unavailable"
  | "network_failed"
  | "unknown_failed";

export interface PublishAttemptRow {
  id: number;
  target: string;
  targetEndpoint: string;
  evidenceBundleId: number;
  researchBriefId: number | null;
  idempotencyKey: string;
  requestHash: string;
  payloadHash: string;
  status: PublishAttemptStatus;
  httpStatus: number | null;
  responseBody: unknown | null;
  errorCode: string | null;
  errorMessage: string | null;
  attemptNumber: number;
  firstAttemptedAtUnixMs: number;
  completedAtUnixMs: number | null;
  receivedAtUnixMs: number;
}

export interface PublishAttemptInsert {
  target: string;
  targetEndpoint: string;
  evidenceBundleId: number;
  researchBriefId?: number | null;
  idempotencyKey: string;
  requestHash: string;
  payloadHash: string;
  status: PublishAttemptStatus;
  httpStatus?: number | null;
  responseBody?: unknown | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  attemptNumber: number;
  firstAttemptedAtUnixMs: number;
  completedAtUnixMs?: number | null;
  receivedAtUnixMs: number;
}

export type PublishAttemptInsertOutcome =
  | { readonly outcome: "inserted"; readonly row: PublishAttemptRow }
  | { readonly outcome: "conflict"; readonly row: PublishAttemptRow };

export interface PublishAttemptRepo {
  insert(row: PublishAttemptInsert): Promise<PublishAttemptInsertOutcome>;
  findByTargetAndKey(target: string, idempotencyKey: string): Promise<PublishAttemptRow[]>;
  findByBundle(evidenceBundleId: number): Promise<PublishAttemptRow[]>;
  findRecentByStatus(
    status: PublishAttemptStatus,
    sinceUnixMs: number,
    limit: number
  ): Promise<PublishAttemptRow[]>;
}

const VALID_STATUSES: Set<PublishAttemptStatus> = new Set([
  "pending",
  "sent",
  "created",
  "idempotent_replay",
  "validation_failed",
  "auth_failed",
  "conflict",
  "store_unavailable",
  "network_failed",
  "unknown_failed"
]);

export function validatePublishAttemptInsert(row: unknown): void {
  if (!row || typeof row !== "object") {
    throw new Error("Publish attempt insert must be a non-null object");
  }
  const r = row as Record<string, unknown>;

  if (typeof r.target !== "string" || r.target.length === 0) {
    throw new Error("target must be a non-empty string");
  }
  if (typeof r.targetEndpoint !== "string" || r.targetEndpoint.length === 0) {
    throw new Error("targetEndpoint must be a non-empty string");
  }
  if (typeof r.evidenceBundleId !== "number" || !Number.isInteger(r.evidenceBundleId)) {
    throw new Error("evidenceBundleId must be an integer");
  }
  if (r.idempotencyKey !== undefined && typeof r.idempotencyKey !== "string") {
    throw new Error("idempotencyKey must be a string");
  }
  if (typeof r.requestHash !== "string" || r.requestHash.length === 0) {
    throw new Error("requestHash must be a non-empty string");
  }
  if (typeof r.payloadHash !== "string" || r.payloadHash.length === 0) {
    throw new Error("payloadHash must be a non-empty string");
  }

  const status = r.status;
  if (typeof status !== "string" || !VALID_STATUSES.has(status as PublishAttemptStatus)) {
    throw new Error(
      `Unsupported publish attempt status: ${status}. Must be one of: ${[...VALID_STATUSES].join(", ")}`
    );
  }

  if (r.httpStatus !== undefined && r.httpStatus !== null) {
    const httpStatus = r.httpStatus as number;
    if (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599) {
      throw new Error(
        `HTTP status must be null or an integer between 100 and 599, got: ${httpStatus}`
      );
    }
  }

  const attemptNumber = r.attemptNumber;
  if (typeof attemptNumber !== "number" || !Number.isInteger(attemptNumber) || attemptNumber <= 0) {
    throw new Error(`Attempt number must be a positive integer, got: ${attemptNumber}`);
  }

  const firstAttemptedAtUnixMs = r.firstAttemptedAtUnixMs;
  if (
    typeof firstAttemptedAtUnixMs !== "number" ||
    !Number.isInteger(firstAttemptedAtUnixMs) ||
    firstAttemptedAtUnixMs < 0
  ) {
    throw new Error(
      `firstAttemptedAtUnixMs timestamp must be a non-negative integer, got: ${firstAttemptedAtUnixMs}`
    );
  }

  const receivedAtUnixMs = r.receivedAtUnixMs;
  if (
    typeof receivedAtUnixMs !== "number" ||
    !Number.isInteger(receivedAtUnixMs) ||
    receivedAtUnixMs < 0
  ) {
    throw new Error(
      `receivedAtUnixMs timestamp must be a non-negative integer, got: ${receivedAtUnixMs}`
    );
  }

  if (r.completedAtUnixMs !== undefined && r.completedAtUnixMs !== null) {
    const completedAtUnixMs = r.completedAtUnixMs as number;
    if (!Number.isInteger(completedAtUnixMs) || completedAtUnixMs < 0) {
      throw new Error(
        `completedAtUnixMs timestamp must be null or a non-negative integer, got: ${completedAtUnixMs}`
      );
    }
    if (completedAtUnixMs < firstAttemptedAtUnixMs) {
      throw new Error(
        `completedAtUnixMs timestamp (${completedAtUnixMs}) cannot be before firstAttemptedAtUnixMs (${firstAttemptedAtUnixMs})`
      );
    }
  }
}

export function validatePublishAttemptQueryLimit(limit: unknown): void {
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0) {
    throw new Error(`Limit must be a positive integer, got: ${limit}`);
  }
}
