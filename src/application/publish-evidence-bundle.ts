import type { Clock } from "../ports/clock.js";
import type { HttpClient, HttpResponse } from "../ports/http.js";
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
  readonly retry?: RetryControl;
}

export interface PublishEvidenceBundleConfig {
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;
const ENDPOINT_PATH = "/v1/evidence/sol-usdc";
const SUPPORTED_SCHEMA_VERSION = "evidence-bundle.v1";

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
  return { outcome: "permanent_http_failed", auditStatus: "unknown_failed" };
}

export type PublishEvidenceBundleResult =
  | { readonly outcome: "created"; readonly bundleId: number; readonly attemptCount: 1 }
  | { readonly outcome: "idempotent_replay"; readonly bundleId: number; readonly attemptCount: 1 }
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
  | { readonly outcome: "audit_store_failed"; readonly reason: string };

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
  | { readonly type: "audit_persistence_failed"; readonly reason: string };

export async function publishEvidenceBundle(
  deps: PublishEvidenceBundleDeps,
  _config: PublishEvidenceBundleConfig = {}
): Promise<PublishEvidenceBundleResult> {
  const { clock, http, env, bundleRepo, publishAttemptRepo, contract } = deps;
  const timeoutMs = _config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const baseUrl = env.get("REGIME_ENGINE_BASE_URL");
  const authToken = env.get("REGIME_ENGINE_AUTH_TOKEN");

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
      `Unsupported schema version: ${latestBundle.schemaVersion}`
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
      `Contract validation failed: ${err instanceof Error ? err.message : String(err)}`
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
      "Contract validation mismatch: canonical/hash/idempotency key mismatch"
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

  let response: HttpResponse<unknown>;
  try {
    response = await http.postJsonRaw<unknown>(endpoint, latestBundle.payload, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Idempotency-Key": latestBundle.idempotencyKey,
        "Content-Type": "application/json"
      },
      timeoutMs,
      maxAttempts: 1
    });
  } catch (err) {
    return {
      outcome: "permanent_http_failed",
      bundleId: latestBundle.id,
      httpStatus: 0
    };
  }

  const { outcome, auditStatus } = classifyHttpStatus(response.status);

  const redactedResponseBody = redactSecrets(response.body);

  const auditInsert: PublishAttemptInsert = {
    target,
    targetEndpoint: endpoint,
    evidenceBundleId: latestBundle.id,
    researchBriefId: null,
    idempotencyKey: latestBundle.idempotencyKey,
    requestHash,
    payloadHash: latestBundle.payloadHash,
    status: auditStatus,
    httpStatus: response.status,
    responseBody: redactedResponseBody,
    errorCode: null,
    errorMessage: null,
    attemptNumber: 1,
    firstAttemptedAtUnixMs,
    completedAtUnixMs: receivedAtUnixMs,
    receivedAtUnixMs
  };

  let insertOutcome: Awaited<ReturnType<PublishAttemptRepo["insert"]>>;
  try {
    insertOutcome = await publishAttemptRepo.insert(auditInsert);
  } catch (err) {
    return {
      outcome: "audit_store_failed",
      reason: err instanceof Error ? err.message : "Insert failed"
    };
  }

  if (insertOutcome.outcome === "conflict") {
    return {
      outcome: "audit_store_failed",
      reason: "Audit insert conflict"
    };
  }

  return {
    outcome: outcome as
      | "created"
      | "idempotent_replay"
      | "validation_failed"
      | "auth_failed"
      | "conflict"
      | "unknown_failed"
      | "permanent_http_failed",
    bundleId: latestBundle.id,
    httpStatus: response.status
  };
}

async function insertValidationFailedAudit(
  deps: PublishEvidenceBundleDeps,
  endpoint: string,
  receivedAtUnixMs: number,
  bundle: EvidenceBundleRow,
  diagnosticMessage: string
): Promise<PublishEvidenceBundleResult | undefined> {
  const { publishAttemptRepo, clock } = deps;
  const clockNow = clock.now();
  const firstAttemptedAtUnixMs = new Date(clockNow).getTime();
  const target = endpoint.replace(/^https?:\/\//, "").split("/")[0] ?? "";

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
    firstAttemptedAtUnixMs,
    completedAtUnixMs: receivedAtUnixMs,
    receivedAtUnixMs
  };

  try {
    await publishAttemptRepo.insert(auditInsert);
  } catch {
    return {
      outcome: "audit_store_failed",
      reason: "Failed to insert validation failure audit"
    };
  }

  return undefined;
}
