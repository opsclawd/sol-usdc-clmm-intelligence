import type { HttpClient, HttpResponse } from "../ports/http.js";
import { HttpRequestError } from "../ports/http.js";
import type { RetryControl } from "../ports/retry.js";
import type { JsonStore } from "../ports/json-store.js";
import type { EnvReader } from "../ports/env.js";
import type { RawObservationRepo } from "../ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../ports/normalized-observation-repo.js";
import type { CollectionRunContext } from "./create-collection-run-context.js";
import type { Freshness, ConfidenceLevel, Source } from "../contracts/taxonomy.js";
import type {
  NetworkStatusWarning,
  NetworkStatusPayloadV1
} from "../contracts/normalized-network-status.js";
import {
  acceptSolanaNetworkStatusBatch,
  deriveSolanaNetworkStatusObservationKey,
  normalizeSolanaNetworkStatus,
  enrichNetworkStatus,
  SolanaNetworkStatusValidationError,
  type EnrichedNetworkStatusObservation
} from "../domain/network-status/index.js";
import { canonicalizePayload } from "../domain/content-hash.js";
import { getObservationKindEntry } from "../domain/taxonomy/registry.js";
import { ingestRawObservation, RawObservationConflictError } from "./ingest-raw-observation.js";

export interface CollectSolanaNetworkStatusDeps {
  readonly http: HttpClient;
  readonly retryControl: RetryControl;
  readonly jsonStore: JsonStore;
  readonly env: EnvReader;
  readonly rawObservationRepo: RawObservationRepo;
  readonly normalizedObservationRepo: NormalizedObservationRepo;
}

export interface SolanaNetworkStatusSourceResult {
  readonly status:
    | "accepted"
    | "identical_replay"
    | "degraded"
    | "timeout"
    | "network"
    | "unavailable"
    | "malformed"
    | "conflict"
    | "failed";
  readonly hasUsableEvidence: boolean;
  readonly rawObservationId: number | null;
  readonly normalizedCount: number;
  readonly warnings: readonly NetworkStatusWarning[];
  readonly freshness: Freshness | null;
  readonly confidenceLevel: ConfidenceLevel | null;
  readonly diagnostic: string | null;
}

const SOURCE: Source = "solana-rpc";

function sanitizeUrl(rawUrl: string): { hostLabel: string; safeDiagnosticUrl: string } {
  try {
    const parsed = new URL(rawUrl);
    return {
      hostLabel: parsed.hostname,
      safeDiagnosticUrl: `${parsed.protocol}//${parsed.hostname}`
    };
  } catch {
    return {
      hostLabel: "unknown-host",
      safeDiagnosticUrl: "invalid-url"
    };
  }
}

export async function collectSolanaNetworkStatus(
  deps: CollectSolanaNetworkStatusDeps,
  context: CollectionRunContext
): Promise<SolanaNetworkStatusSourceResult> {
  const { http, retryControl, env, rawObservationRepo, normalizedObservationRepo } = deps;

  const rawRpcUrl = env.get("SOLANA_RPC_URL");
  const apiKey = env.getOptional("SOLANA_RPC_API_KEY");
  const codeVersion = env.getOptional("INTELLIGENCE_CODE_VERSION") ?? "development";
  const { hostLabel, safeDiagnosticUrl } = sanitizeUrl(rawRpcUrl);

  const requestBatch = [
    { jsonrpc: "2.0", id: "health", method: "getHealth" },
    { jsonrpc: "2.0", id: "slot", method: "getSlot", params: [{ commitment: "confirmed" }] }
  ] as const;

  const headers: Record<string, string> = {};
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  let response: HttpResponse<unknown> | null = null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) {
      const delayMs = 25 + Math.floor(retryControl.jitterUnit() * 25);
      await retryControl.sleep(delayMs);
    }

    try {
      response = await http.postJsonRaw(rawRpcUrl, requestBatch, {
        headers,
        timeoutMs: 5000,
        maxAttempts: 1
      });

      if (response.status >= 200 && response.status < 300) {
        lastError = null;
        break;
      }

      // Check if status code is retryable (408, 429, or 5xx)
      const code = response.status;
      const isRetryableStatus = code === 408 || code === 429 || code >= 500;

      if (!isRetryableStatus || attempt === 2) {
        lastError = new HttpRequestError("http_status", `HTTP ${code}`, code, isRetryableStatus);
        response = null;
        break;
      }
    } catch (err) {
      lastError = err;
      response = null;

      let isRetryable = false;
      if (err instanceof HttpRequestError) {
        isRetryable = err.retryable;
      } else if (err instanceof Error) {
        // Generic network/timeout check
        isRetryable = true;
      }

      if (!isRetryable || attempt === 2) {
        break;
      }
    }
  }

  if (!response) {
    let status: "timeout" | "network" | "unavailable" | "malformed" = "network";
    let message = "RPC request failed";

    if (lastError instanceof HttpRequestError) {
      if (lastError.kind === "timeout") {
        status = "timeout";
        message = "RPC request timed out";
      } else if (lastError.kind === "http_status") {
        const code = lastError.status ?? 0;
        if (code === 408 || code === 429 || code >= 500) {
          status = "unavailable";
        } else if (code >= 400 && code < 500) {
          status = "unavailable";
        } else {
          status = "network";
        }
        message = `RPC HTTP error status ${code}`;
      } else if (lastError.kind === "invalid_json") {
        status = "malformed";
        message = "RPC response was invalid JSON";
      } else {
        status = "network";
        message = "RPC network error";
      }
    } else if (lastError instanceof Error) {
      const errMsg = lastError.message;
      if (errMsg.includes("JSON") || errMsg.includes("Unexpected token")) {
        status = "malformed";
        message = "RPC response was invalid JSON";
      } else {
        message = "RPC request failed";
      }
    }

    const sanitizedDiagnostic = `${message} (${safeDiagnosticUrl})`;

    return {
      status,
      hasUsableEvidence: false,
      rawObservationId: null,
      normalizedCount: 0,
      warnings: [],
      freshness: null,
      confidenceLevel: null,
      diagnostic: sanitizedDiagnostic
    };
  }

  const payloadCanonicalResult = await canonicalizePayload(response.body);
  const sourceObservationKey = await deriveSolanaNetworkStatusObservationKey({
    network: "solana-mainnet-beta",
    observedAtUnixMs: context.startedAtUnixMs
  });

  const redactedMeta = {
    method: "POST" as const,
    host: hostLabel,
    network: "solana-mainnet-beta" as const,
    rpcMethods: ["getHealth", "getSlot"],
    codeVersion,
    runId: context.runId
  };

  const ingestDeps = {
    rawObservationRepo,
    normalizedObservationRepo,
    jsonStore: deps.jsonStore
  };

  try {
    const ingestResult = await ingestRawObservation<
      ReturnType<typeof acceptSolanaNetworkStatusBatch>,
      NetworkStatusPayloadV1,
      EnrichedNetworkStatusObservation
    >(ingestDeps, {
      source: SOURCE,
      sourceObservationKey,
      observedAtUnixMs: context.startedAtUnixMs,
      fetchedAtUnixMs: context.startedAtUnixMs,
      payloadCanonical: payloadCanonicalResult.payloadCanonical,
      payloadHash: payloadCanonicalResult.payloadHash,
      sourceRequestMeta: redactedMeta,
      receivedAtUnixMs: context.startedAtUnixMs,
      validatePayload: (canonical) => {
        const parsed = JSON.parse(canonical);
        const accepted = acceptSolanaNetworkStatusBatch(parsed);
        return { accepted };
      },
      buildCandidates: (accepted) => {
        return [
          normalizeSolanaNetworkStatus({
            accepted,
            observedAtUnixMs: context.startedAtUnixMs
          })
        ];
      },
      enrichCandidates: async (candidates, rawRow) => {
        const cand = candidates[0]!;
        const enriched = await enrichNetworkStatus({
          rawObservationId: rawRow.id,
          sourceObservationKey: rawRow.sourceObservationKey,
          rawPayloadHash: rawRow.payloadHash,
          observedAtUnixMs: rawRow.observedAtUnixMs,
          fetchedAtUnixMs: rawRow.fetchedAtUnixMs,
          receivedAtUnixMs: rawRow.receivedAtUnixMs,
          payload: cand,
          nowMs: rawRow.receivedAtUnixMs,
          codeVersion,
          runId: context.runId
        });
        return [enriched];
      },
      insertNormalized: async (enriched, candidates, rawRow) => {
        const e = enriched[0]!;
        const cand = candidates[0]!;
        const entry = getObservationKindEntry("network_status");
        const normInsert = {
          rawObservationId: rawRow.id,
          source: SOURCE,
          observationKind: "network_status" as const,
          signalClass: e.signalClass,
          evidenceFamily: e.evidenceFamily,
          payload: cand,
          payloadHash: e.payloadHash,
          confidence: e.confidence,
          confidenceComposite: e.confidence.compositeScore,
          confidenceLevel: e.confidence.level,
          validUntilUnixMs: e.freshness.validUntilUnixMs,
          isStale: e.freshness.isStale,
          staleBehavior: entry.freshnessPolicy.staleBehavior,
          provenance: e.provenance,
          receivedAtUnixMs: rawRow.receivedAtUnixMs
        };
        await normalizedObservationRepo.insertMany([normInsert]);
        return 1;
      }
    });

    const normRow = await normalizedObservationRepo.findByRawObservation(
      ingestResult.rawObservationId,
      "network_status"
    );

    if (!normRow) {
      return {
        status: "failed",
        hasUsableEvidence: false,
        rawObservationId: ingestResult.rawObservationId,
        normalizedCount: 0,
        warnings: [],
        freshness: null,
        confidenceLevel: null,
        diagnostic: "Normalized row not found after ingestion"
      };
    }

    const payload = normRow.payload as NetworkStatusPayloadV1;
    const warnings = payload.warnings || [];
    const hasUsableEvidence = true; // Solana network status evidence is usable even when node is behind or slot unavailable

    const freshness: Freshness = {
      isStale: normRow.isStale,
      validUntilUnixMs: normRow.validUntilUnixMs ?? 0,
      derivedAt: context.startedAtUnixMs,
      policyKind: "network_status",
      reasons: normRow.isStale ? ["expired_past_max_observed_age"] : []
    };

    let status: "accepted" | "identical_replay" | "degraded" = "accepted";
    if (warnings.length > 0) {
      status = "degraded";
    } else if (ingestResult.rawOutcome.outcome === "identical_replay") {
      status = "identical_replay";
    }

    return {
      status,
      hasUsableEvidence,
      rawObservationId: ingestResult.rawObservationId,
      normalizedCount: ingestResult.normalizedCount,
      warnings,
      freshness,
      confidenceLevel: normRow.confidenceLevel as ConfidenceLevel,
      diagnostic: null
    };
  } catch (err) {
    let rawObservationId: number | null = null;
    try {
      const existing = await rawObservationRepo.findByIdentity(SOURCE, sourceObservationKey);
      if (existing) {
        rawObservationId = existing.id;
      }
    } catch {
      // Ignore lookup failure
    }

    if (err instanceof SolanaNetworkStatusValidationError || err instanceof SyntaxError) {
      return {
        status: "malformed",
        hasUsableEvidence: false,
        rawObservationId,
        normalizedCount: 0,
        warnings: [],
        freshness: null,
        confidenceLevel: null,
        diagnostic: err.message
      };
    }

    const status = err instanceof RawObservationConflictError ? "conflict" : "failed";

    return {
      status,
      hasUsableEvidence: false,
      rawObservationId,
      normalizedCount: 0,
      warnings: [],
      freshness: null,
      confidenceLevel: null,
      diagnostic: err instanceof Error ? err.message : String(err)
    };
  }
}
