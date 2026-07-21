import type { Clock } from "../ports/clock.js";
import type { HttpClient, HttpResponse } from "../ports/http.js";
import { HttpRequestError } from "../ports/http.js";
import type { EnvReader } from "../ports/env.js";
import type { EvidenceBundleRepo, EvidenceBundleRow } from "../ports/bundle-repo.js";
import type { PublishAttemptRepo, PublishAttemptInsert } from "../ports/publish-attempt-repo.js";
import type { EvidenceBundleContract } from "../ports/evidence-bundle-contract.js";
import type { RetryControl } from "../ports/retry.js";

export interface PublishEvidenceBundleDeps {
  readonly clock: Clock;
  readonly http: HttpClient;
  readonly env: EnvReader;
  readonly bundleRepo: EvidenceBundleRepo;
  readonly publishAttemptRepo: PublishAttemptRepo;
  readonly contract: EvidenceBundleContract;
  readonly retry: RetryControl;
}

export interface PublishEvidenceBundleConfig {
  readonly timeoutMs?: number;
  readonly onEvent?: (event: PublishEvidenceBundleEvent) => void;
}

const DEFAULT_TIMEOUT_MS = 5000;
const ENDPOINT_PATH = "/v1/evidence/sol-usdc";
const SUPPORTED_SCHEMA_VERSION = "evidence-bundle.v1";

const RETRY_BASE_DELAY_MS = 250;
const RETRY_MAX_DELAY_MS = 2000;
const RETRY_JITTER_MAX_MS = 250;
const MAX_RETRY_ATTEMPTS = 3;

function buildEndpoint(baseUrl: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBase}${ENDPOINT_PATH}`;
}

function validateUrl(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  if (url.username || url.password) {
    throw new Error("URL must not contain credentials");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must use HTTP or HTTPS protocol");
  }
}

function redactSecrets(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value !== "object") {
    return value;
  }

  const secretKeysPattern = /^(authorization|token|secret|api[-_]?key)$/i;

  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }

  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(obj)) {
    if (secretKeysPattern.test(key)) {
      result[key] = "[REDACTED]";
    } else if (typeof val === "object" && val !== null) {
      result[key] = redactSecrets(val);
    } else {
      result[key] = val;
    }
  }

  return result;
}

function classifyHttpStatus(status: number): {
  outcome: PublishEvidenceBundleResult["outcome"];
  auditStatus: PublishAttemptInsert["status"];
} {
  if (status === 201) {
    return { outcome: "created", auditStatus: "created" };
  }
  if (status === 200) {
    return { outcome: "idempotent_replay", auditStatus: "idempotent_replay" };
  }
  if (status === 400 || status === 422) {
    return { outcome: "validation_failed", auditStatus: "validation_failed" };
  }
  if (status === 401 || status === 403) {
    return { outcome: "auth_failed", auditStatus: "auth_failed" };
  }
  if (status === 409) {
    return { outcome: "conflict", auditStatus: "conflict" };
  }
  if (status >= 400 && status < 500) {
    return { outcome: "unknown_failed", auditStatus: "unknown_failed" };
  }
  return { outcome: "permanent_http_failed", auditStatus: "store_unavailable" };
}

function isRetryableHttpError(err: unknown): boolean {
  if (err instanceof HttpRequestError) {
    return err.kind === "timeout" || err.kind === "network";
  }
  return false;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

function parseRetryAfterHeader(headerValue: string | undefined, clockNowMs: number): number | null {
  if (headerValue === undefined || headerValue === "") {
    return null;
  }
  const trimmed = headerValue.trim();
  const deltaSeconds = Number(trimmed);
  if (!Number.isNaN(deltaSeconds)) {
    if (deltaSeconds >= 0) {
      const deltaMs = deltaSeconds * 1000;
      return Math.min(deltaMs, RETRY_MAX_DELAY_MS);
    }
    return null;
  }
  const httpDateMs = Date.parse(trimmed);
  if (!Number.isNaN(httpDateMs)) {
    const deltaMs = httpDateMs - clockNowMs;
    if (deltaMs >= 0) {
      return Math.min(deltaMs, RETRY_MAX_DELAY_MS);
    }
    return 0;
  }
  return null;
}

function calculateRetryDelay(
  attemptNumber: number,
  retryControl: RetryControl,
  retryAfterMs: number | null
): number {
  if (retryAfterMs !== null) {
    return retryAfterMs;
  }
  const baseDelay = RETRY_BASE_DELAY_MS * attemptNumber;
  const jitter = retryControl.jitterUnit() * RETRY_JITTER_MAX_MS;
  const delay = baseDelay + jitter;
  return Math.min(delay, RETRY_MAX_DELAY_MS);
}

export type PublishEvidenceBundleResult =
  | { readonly outcome: "created"; readonly bundleId: number; readonly attemptCount: 1 | 2 | 3 }
  | {
      readonly outcome: "idempotent_replay";
      readonly bundleId: number;
      readonly attemptCount: 1 | 2 | 3;
    }
  | { readonly outcome: "bundle_not_found" }
  | { readonly outcome: "local_validation_failed"; readonly reason: string }
  | {
      readonly outcome: "validation_failed";
      readonly bundleId: number;
      readonly httpStatus: number;
    }
  | { readonly outcome: "auth_failed"; readonly bundleId: number; readonly httpStatus: number }
  | { readonly outcome: "conflict"; readonly bundleId: number; readonly httpStatus: number }
  | {
      readonly outcome: "unknown_failed";
      readonly bundleId: number;
      readonly httpStatus: number;
    }
  | {
      readonly outcome: "permanent_http_failed";
      readonly bundleId: number;
      readonly httpStatus: number;
    }
  | { readonly outcome: "audit_store_failed"; readonly reason: string }
  | {
      readonly outcome: "transient_failure_exhausted";
      readonly bundleId: number;
      readonly httpStatus: number;
    };

export type PublishEvidenceBundleEvent =
  | { readonly type: "publish_started"; readonly bundleId: number; readonly target: string }
  | { readonly type: "created"; readonly bundleId: number; readonly httpStatus: number }
  | { readonly type: "idempotent_replay"; readonly bundleId: number; readonly httpStatus: number }
  | { readonly type: "validation_failed"; readonly bundleId: number; readonly httpStatus: number }
  | { readonly type: "auth_failed"; readonly bundleId: number; readonly httpStatus: number }
  | { readonly type: "conflict"; readonly bundleId: number; readonly httpStatus: number }
  | {
      readonly type: "permanent_http_failed";
      readonly bundleId: number;
      readonly httpStatus: number;
    }
  | { readonly type: "audit_persistence_failed"; readonly reason: string }
  | { readonly type: "unknown_failed"; readonly bundleId: number; readonly httpStatus: number }
  | { readonly type: "retry_scheduled"; readonly bundleId: number; readonly delayMs: number }
  | {
      readonly type: "transient_failure_exhausted";
      readonly bundleId: number;
      readonly httpStatus: number;
    };

export async function publishEvidenceBundle(
  deps: PublishEvidenceBundleDeps,
  _config: PublishEvidenceBundleConfig = {}
): Promise<PublishEvidenceBundleResult> {
  const { clock, http, env, bundleRepo, publishAttemptRepo, contract } = deps;
  const { timeoutMs = DEFAULT_TIMEOUT_MS, onEvent } = _config;

  const baseUrl = env.get("REGIME_ENGINE_BASE_URL");
  const authToken = env.get("REGIME_ENGINE_AUTH_TOKEN");

  if (!authToken) {
    return {
      outcome: "local_validation_failed",
      reason: "REGIME_ENGINE_AUTH_TOKEN is not set"
    };
  }

  let endpoint: string;
  try {
    validateUrl(baseUrl);
    endpoint = buildEndpoint(baseUrl);
  } catch (err) {
    return {
      outcome: "local_validation_failed",
      reason: err instanceof Error ? err.message : String(err)
    };
  }

  const clockNow = clock.now();
  const receivedAtUnixMs = new Date(clockNow).getTime();
  if (Number.isNaN(receivedAtUnixMs)) {
    return {
      outcome: "local_validation_failed",
      reason: `Invalid clock.now() value: ${clockNow}`
    };
  }

  const latestBundle = await bundleRepo.findLatestByPair("SOL/USDC");

  if (latestBundle === undefined) {
    return { outcome: "bundle_not_found" };
  }

  if (latestBundle.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    const insertResult = await insertValidationFailedAudit(
      deps,
      endpoint,
      receivedAtUnixMs,
      latestBundle,
      `Unsupported schema version: ${latestBundle.schemaVersion}`,
      onEvent
    );
    if (insertResult !== undefined) {
      return insertResult;
    }
    return { outcome: "local_validation_failed", reason: "Unsupported schema version" };
  }

  let canonicalResult: Awaited<ReturnType<EvidenceBundleContract["validateCanonicalizeAndHash"]>>;
  try {
    canonicalResult = await contract.validateCanonicalizeAndHash(latestBundle.payload);
  } catch (err) {
    const insertResult = await insertValidationFailedAudit(
      deps,
      endpoint,
      receivedAtUnixMs,
      latestBundle,
      `Contract validation failed: ${err instanceof Error ? err.message : String(err)}`,
      onEvent
    );
    if (insertResult !== undefined) {
      return insertResult;
    }
    return {
      outcome: "local_validation_failed",
      reason: `Contract validation failed: ${err instanceof Error ? err.message : String(err)}`
    };
  }

  if (
    canonicalResult.payloadCanonical !== latestBundle.payloadCanonical ||
    canonicalResult.payloadHash !== latestBundle.payloadHash ||
    canonicalResult.idempotencyKey !== latestBundle.idempotencyKey
  ) {
    const insertResult = await insertValidationFailedAudit(
      deps,
      endpoint,
      receivedAtUnixMs,
      latestBundle,
      "Contract validation mismatch: canonical/hash/idempotency key mismatch",
      onEvent
    );
    if (insertResult !== undefined) {
      return insertResult;
    }
    return {
      outcome: "local_validation_failed",
      reason: "Contract validation mismatch"
    };
  }

  const requestHash = latestBundle.payloadHash;
  const firstAttemptedAtUnixMs = receivedAtUnixMs;
  const target = endpoint.replace(/^https?:\/\//, "").split("/")[0] ?? "";
  const payload = latestBundle.payload;
  const idempotencyKey = latestBundle.idempotencyKey;

  onEvent?.({
    type: "publish_started",
    bundleId: latestBundle.id,
    target
  });

  let lastResponse: HttpResponse<unknown> | null = null;
  let lastHttpStatus = 0;

  for (let attemptNumber = 1; attemptNumber <= MAX_RETRY_ATTEMPTS; attemptNumber++) {
    const completedAtUnixMs = new Date(clock.now()).getTime();

    try {
      lastResponse = await http.postJsonRaw<unknown>(endpoint, payload, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Idempotency-Key": idempotencyKey,
          "Content-Type": "application/json"
        },
        timeoutMs,
        maxAttempts: 1
      });
      lastHttpStatus = lastResponse.status;
    } catch (err: unknown) {
      lastHttpStatus = 0;

      if (!isRetryableHttpError(err)) {
        const networkFailedAuditInsert: PublishAttemptInsert = {
          target,
          targetEndpoint: endpoint,
          evidenceBundleId: latestBundle.id,
          researchBriefId: null,
          idempotencyKey,
          requestHash,
          payloadHash: latestBundle.payloadHash,
          status: "network_failed",
          httpStatus: null,
          responseBody: null,
          errorCode: null,
          errorMessage: err instanceof Error ? err.message : String(err),
          attemptNumber,
          firstAttemptedAtUnixMs,
          completedAtUnixMs,
          receivedAtUnixMs
        };
        let networkInsertOutcome: Awaited<ReturnType<PublishAttemptRepo["insert"]>>;
        try {
          networkInsertOutcome = await publishAttemptRepo.insert(networkFailedAuditInsert);
        } catch (insertErr: unknown) {
          onEvent?.({
            type: "audit_persistence_failed",
            reason:
              insertErr instanceof Error
                ? insertErr.message
                : "Failed to insert network failure audit"
          });
          return {
            outcome: "audit_store_failed",
            reason: "Failed to insert network failure audit"
          };
        }
        if (networkInsertOutcome.outcome === "conflict") {
          onEvent?.({
            type: "audit_persistence_failed",
            reason: "Network failure audit insert conflict"
          });
          return {
            outcome: "audit_store_failed",
            reason: "Network failure audit insert conflict"
          };
        }
        onEvent?.({
          type: "permanent_http_failed",
          bundleId: latestBundle.id,
          httpStatus: 0
        });
        return {
          outcome: "permanent_http_failed",
          bundleId: latestBundle.id,
          httpStatus: 0
        };
      }

      const networkFailedAuditInsert: PublishAttemptInsert = {
        target,
        targetEndpoint: endpoint,
        evidenceBundleId: latestBundle.id,
        researchBriefId: null,
        idempotencyKey,
        requestHash,
        payloadHash: latestBundle.payloadHash,
        status: "network_failed",
        httpStatus: null,
        responseBody: null,
        errorCode: null,
        errorMessage: err instanceof Error ? err.message : String(err),
        attemptNumber,
        firstAttemptedAtUnixMs,
        completedAtUnixMs,
        receivedAtUnixMs
      };
      let networkInsertOutcome: Awaited<ReturnType<PublishAttemptRepo["insert"]>>;
      try {
        networkInsertOutcome = await publishAttemptRepo.insert(networkFailedAuditInsert);
      } catch (insertErr: unknown) {
        onEvent?.({
          type: "audit_persistence_failed",
          reason:
            insertErr instanceof Error
              ? insertErr.message
              : "Failed to insert network failure audit"
        });
        return {
          outcome: "audit_store_failed",
          reason: "Failed to insert network failure audit"
        };
      }
      if (networkInsertOutcome.outcome === "conflict") {
        onEvent?.({
          type: "audit_persistence_failed",
          reason: "Network failure audit insert conflict"
        });
        return {
          outcome: "audit_store_failed",
          reason: "Network failure audit insert conflict"
        };
      }

      if (attemptNumber === MAX_RETRY_ATTEMPTS) {
        onEvent?.({
          type: "transient_failure_exhausted",
          bundleId: latestBundle.id,
          httpStatus: 0
        });
        return {
          outcome: "transient_failure_exhausted",
          bundleId: latestBundle.id,
          httpStatus: 0
        };
      }

      const retryAfterMs = parseRetryAfterHeader(
        lastResponse?.headers?.["Retry-After"],
        completedAtUnixMs
      );
      const delayMs = calculateRetryDelay(attemptNumber, deps.retry, retryAfterMs);
      onEvent?.({
        type: "retry_scheduled",
        bundleId: latestBundle.id,
        delayMs
      });
      await deps.retry.sleep(delayMs);
      continue;
    }

    if (isRetryableStatus(lastResponse.status)) {
      const redactedResponseBody = redactSecrets(lastResponse.body);
      const auditInsert: PublishAttemptInsert = {
        target,
        targetEndpoint: endpoint,
        evidenceBundleId: latestBundle.id,
        researchBriefId: null,
        idempotencyKey,
        requestHash,
        payloadHash: latestBundle.payloadHash,
        status: "network_failed",
        httpStatus: lastResponse.status,
        responseBody: redactedResponseBody,
        errorCode: null,
        errorMessage: null,
        attemptNumber,
        firstAttemptedAtUnixMs,
        completedAtUnixMs,
        receivedAtUnixMs
      };

      let insertOutcome: Awaited<ReturnType<PublishAttemptRepo["insert"]>>;
      try {
        insertOutcome = await publishAttemptRepo.insert(auditInsert);
      } catch (err) {
        onEvent?.({
          type: "audit_persistence_failed",
          reason: err instanceof Error ? err.message : "Insert failed"
        });
        return {
          outcome: "audit_store_failed",
          reason: err instanceof Error ? err.message : "Insert failed"
        };
      }

      if (insertOutcome.outcome === "conflict") {
        onEvent?.({ type: "audit_persistence_failed", reason: "Audit insert conflict" });
        return {
          outcome: "audit_store_failed",
          reason: "Audit insert conflict"
        };
      }

      if (attemptNumber === MAX_RETRY_ATTEMPTS) {
        onEvent?.({
          type: "transient_failure_exhausted",
          bundleId: latestBundle.id,
          httpStatus: lastResponse.status
        });
        return {
          outcome: "transient_failure_exhausted",
          bundleId: latestBundle.id,
          httpStatus: lastResponse.status
        };
      }

      const retryAfterMs = parseRetryAfterHeader(
        lastResponse.headers?.["Retry-After"],
        completedAtUnixMs
      );
      const delayMs = calculateRetryDelay(attemptNumber, deps.retry, retryAfterMs);
      onEvent?.({
        type: "retry_scheduled",
        bundleId: latestBundle.id,
        delayMs
      });
      await deps.retry.sleep(delayMs);
      continue;
    }

    const { outcome, auditStatus } = classifyHttpStatus(lastResponse.status);
    const redactedResponseBody = redactSecrets(lastResponse.body);

    const auditInsert: PublishAttemptInsert = {
      target,
      targetEndpoint: endpoint,
      evidenceBundleId: latestBundle.id,
      researchBriefId: null,
      idempotencyKey,
      requestHash,
      payloadHash: latestBundle.payloadHash,
      status: auditStatus,
      httpStatus: lastResponse.status,
      responseBody: redactedResponseBody,
      errorCode: null,
      errorMessage: null,
      attemptNumber,
      firstAttemptedAtUnixMs,
      completedAtUnixMs,
      receivedAtUnixMs
    };

    let insertOutcome: Awaited<ReturnType<PublishAttemptRepo["insert"]>>;
    try {
      insertOutcome = await publishAttemptRepo.insert(auditInsert);
    } catch (err) {
      onEvent?.({
        type: "audit_persistence_failed",
        reason: err instanceof Error ? err.message : "Insert failed"
      });
      return {
        outcome: "audit_store_failed",
        reason: err instanceof Error ? err.message : "Insert failed"
      };
    }

    if (insertOutcome.outcome === "conflict") {
      onEvent?.({ type: "audit_persistence_failed", reason: "Audit insert conflict" });
      return {
        outcome: "audit_store_failed",
        reason: "Audit insert conflict"
      };
    }

    return mapOutcomeToResult(
      outcome as
        | "created"
        | "idempotent_replay"
        | "validation_failed"
        | "auth_failed"
        | "conflict"
        | "unknown_failed"
        | "permanent_http_failed",
      latestBundle.id,
      lastResponse.status,
      attemptNumber
    );
  }

  return {
    outcome: "transient_failure_exhausted",
    bundleId: latestBundle.id,
    httpStatus: lastHttpStatus
  };
}

function mapOutcomeToResult(
  outcome:
    | "created"
    | "idempotent_replay"
    | "validation_failed"
    | "auth_failed"
    | "conflict"
    | "unknown_failed"
    | "permanent_http_failed",
  bundleId: number,
  httpStatus: number,
  attemptCount: number
): PublishEvidenceBundleResult {
  switch (outcome) {
    case "created":
      return { outcome: "created", bundleId, attemptCount: attemptCount as 1 | 2 | 3 };
    case "idempotent_replay":
      return { outcome: "idempotent_replay", bundleId, attemptCount: attemptCount as 1 | 2 | 3 };
    case "validation_failed":
      return { outcome: "validation_failed", bundleId, httpStatus };
    case "auth_failed":
      return { outcome: "auth_failed", bundleId, httpStatus };
    case "conflict":
      return { outcome: "conflict", bundleId, httpStatus };
    case "unknown_failed":
      return { outcome: "unknown_failed", bundleId, httpStatus };
    case "permanent_http_failed":
      return { outcome: "permanent_http_failed", bundleId, httpStatus };
  }
}

async function insertValidationFailedAudit(
  deps: PublishEvidenceBundleDeps,
  endpoint: string,
  receivedAtUnixMs: number,
  bundle: EvidenceBundleRow,
  diagnosticMessage: string,
  onEvent?: (event: PublishEvidenceBundleEvent) => void
): Promise<PublishEvidenceBundleResult | undefined> {
  const { publishAttemptRepo, clock } = deps;
  const target = endpoint.replace(/^https?:\/\//, "").split("/")[0] ?? "";
  const completedAtUnixMs = new Date(clock.now()).getTime();

  const auditInsert: PublishAttemptInsert = {
    target,
    targetEndpoint: endpoint,
    evidenceBundleId: bundle.id,
    researchBriefId: null,
    idempotencyKey: bundle.idempotencyKey,
    requestHash: bundle.payloadHash,
    payloadHash: bundle.payloadHash,
    status: "validation_failed",
    httpStatus: null,
    responseBody: { diagnostic: diagnosticMessage.slice(0, 500) },
    errorCode: null,
    errorMessage: diagnosticMessage.slice(0, 500),
    attemptNumber: 1,
    firstAttemptedAtUnixMs: receivedAtUnixMs,
    completedAtUnixMs,
    receivedAtUnixMs
  };

  let insertOutcome: Awaited<ReturnType<PublishAttemptRepo["insert"]>>;
  try {
    insertOutcome = await publishAttemptRepo.insert(auditInsert);
  } catch (err: unknown) {
    onEvent?.({
      type: "audit_persistence_failed",
      reason: err instanceof Error ? err.message : "Failed to insert validation failure audit"
    });
    return {
      outcome: "audit_store_failed",
      reason: "Failed to insert validation failure audit"
    };
  }

  if (insertOutcome.outcome === "conflict") {
    onEvent?.({
      type: "audit_persistence_failed",
      reason: "Validation failure audit insert conflict"
    });
    return {
      outcome: "audit_store_failed",
      reason: "Audit insert conflict"
    };
  }

  return undefined;
}
