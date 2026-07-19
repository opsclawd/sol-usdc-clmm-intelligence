import type { HttpClient } from "../ports/http.js";
import type { JsonStore } from "../ports/json-store.js";
import type { EnvReader } from "../ports/env.js";
import type { Clock } from "../ports/clock.js";
import type { RawObservationRepo } from "../ports/observation-repo.js";
import type {
  NormalizedObservationRepo,
  NormalizedObservationInsert
} from "../ports/normalized-observation-repo.js";
import type {
  Freshness,
  ConfidenceLevel,
  ObservationKind,
  SignalClass,
  EvidenceFamily,
  Confidence
} from "../contracts/taxonomy.js";
import {
  acceptPythEnvelope,
  derivePythSourceObservationKey,
  normalizePythPrice,
  type PythHermesEnvelope,
  type AcceptPythEnvelopeResult
} from "../domain/price-observation/pyth.js";
import { canonicalizePayload } from "../domain/content-hash.js";
import {
  enrichPriceObservation,
  type EnrichPriceObservationInput
} from "../domain/price-observation/enrich.js";
import { getObservationKindEntry } from "../domain/taxonomy/registry.js";
import type { OraclePricePayloadV1 } from "../contracts/normalized-price-observation.js";
import {
  ingestRawObservation,
  RawObservationConflictError,
  type IngestRawObservationDeps
} from "./ingest-raw-observation.js";
import { HttpRequestError } from "../ports/http.js";
import type {
  PriceSourceResult,
  AcceptedResult,
  IdenticalReplayResult,
  StaleResult,
  DegradedResult,
  TimeoutResult,
  NetworkResult,
  UnavailableResult,
  MalformedResult,
  NoRouteResult,
  ConflictResult
} from "./price-source-result.js";

import type { CollectionRunContext } from "./create-collection-run-context.js";

export interface CollectPythPriceDeps {
  http: HttpClient;
  jsonStore: JsonStore;
  env: EnvReader;
  clock: Clock;
  rawObservationRepo: RawObservationRepo;
  normalizedObservationRepo: NormalizedObservationRepo;
}

interface RedactedRequestMeta {
  readonly host: string;
  readonly path: string;
  readonly feedId: string;
  readonly version: number;
  readonly runId: string | null;
}

const SOURCE = "pyth-hermes" as const;
const SCHEMA_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_ATTEMPTS = 2;

function buildPythUrl(baseUrl: string, feedId: string): string {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  return `${normalizedBase}/v2/updates/price/latest?ids[]=${encodeURIComponent(feedId)}`;
}

function extractHost(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return url.host;
  } catch {
    return baseUrl;
  }
}

function buildRedactedMeta(params: {
  host: string;
  path: string;
  feedId: string;
  runId: string | null;
}): RedactedRequestMeta {
  return {
    host: params.host,
    path: params.path,
    feedId: params.feedId,
    version: SCHEMA_VERSION,
    runId: params.runId
  };
}

function mapHttpError(err: unknown): PriceSourceResult {
  if (err instanceof HttpRequestError) {
    switch (err.kind) {
      case "timeout":
        return { status: "timeout", summary: err.message } as TimeoutResult;
      case "network":
        return { status: "network", summary: err.message } as NetworkResult;
      case "invalid_json":
        return { status: "malformed", summary: err.message } as MalformedResult;
      case "http_status":
        return {
          status: "unavailable",
          summary: err.message,
          httpStatus: err.status
        } as UnavailableResult;
      default:
        return { status: "failed", summary: err.message };
    }
  }
  if (err instanceof Error) {
    return { status: "failed", summary: err.message };
  }
  return { status: "failed", summary: String(err) };
}

export async function collectPythPrice(
  deps: CollectPythPriceDeps,
  context: CollectionRunContext
): Promise<PriceSourceResult> {
  const { http, jsonStore, env, rawObservationRepo, normalizedObservationRepo } = deps;

  const baseUrl = env.get("PYTH_HERMES_BASE_URL");
  const apiKey = env.getOptional("PYTH_API_KEY");
  const feedId = env.get("PYTH_SOL_USD_FEED_ID");
  const pipelineRunId = context.runId;
  const codeVersion = env.getOptional("INTELLIGENCE_CODE_VERSION") ?? "development";

  const url = buildPythUrl(baseUrl, feedId);
  const host = extractHost(baseUrl);

  const headers: Record<string, string> = {};
  if (apiKey) {
    headers["api-key"] = apiKey;
  }

  let envelope: PythHermesEnvelope;
  let acceptResult: AcceptPythEnvelopeResult;
  let firstCandidate: ReturnType<typeof normalizePythPrice> | undefined;
  let enrichedIsStale: boolean | undefined;
  let enrichedValidUntilUnixMs: number | undefined;
  let enrichedConfidenceLevel: ConfidenceLevel | undefined;

  try {
    const requestOptions = {
      ...(Object.keys(headers).length > 0 && { headers }),
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxAttempts: DEFAULT_MAX_ATTEMPTS
    };
    const response = await http.getJson<PythHermesEnvelope>(url, requestOptions);
    envelope = response;
    acceptResult = acceptPythEnvelope(envelope, feedId);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Feed mismatch")) {
      return { status: "no_route", summary: err.message } as NoRouteResult;
    }
    return mapHttpError(err);
  }

  const receivedAtUnixMs = context.startedAtUnixMs;
  const { payloadCanonical, payloadHash } = await canonicalizePayload(envelope);

  const sourceObservationKey = await derivePythSourceObservationKey({
    feedId,
    publishTimeUnixSeconds: acceptResult.priceUpdate.price.timestamp,
    slot: acceptResult.priceUpdate.slot ?? 0
  });

  const redactedMeta = buildRedactedMeta({
    host,
    path: "/v2/updates/price/latest",
    feedId,
    runId: pipelineRunId
  });

  const observedAtUnixMs = acceptResult.priceUpdate.price.timestamp * 1000;
  const fetchedAtUnixMs = receivedAtUnixMs;

  const ingestDeps: IngestRawObservationDeps = {
    rawObservationRepo,
    normalizedObservationRepo,
    jsonStore
  };

  try {
    const result = await ingestRawObservation<
      PythHermesEnvelope,
      OraclePricePayloadV1,
      Awaited<ReturnType<typeof enrichPriceObservation>>
    >(ingestDeps, {
      source: SOURCE,
      sourceObservationKey,
      observedAtUnixMs,
      fetchedAtUnixMs,
      payloadCanonical,
      payloadHash,
      sourceRequestMeta: redactedMeta,
      receivedAtUnixMs,
      validatePayload: (canonical) => {
        const parsed = JSON.parse(canonical) as PythHermesEnvelope;
        const { envelope } = acceptPythEnvelope(parsed, feedId);
        return { accepted: envelope };
      },
      buildCandidates: (accepted) => {
        const normalized = normalizePythPrice(accepted, feedId, fetchedAtUnixMs);
        firstCandidate = normalized;
        return [normalized];
      },
      enrichCandidates: async (candidates, rawRow) => {
        const candidate = candidates[0];
        if (!candidate) return [];

        const nowMs = rawRow.receivedAtUnixMs;
        const input: EnrichPriceObservationInput = {
          rawObservationId: rawRow.id,
          source: SOURCE,
          sourceObservationKey: rawRow.sourceObservationKey,
          payloadHash: rawRow.payloadHash,
          observedAtUnixMs: rawRow.observedAtUnixMs,
          fetchedAtUnixMs: rawRow.fetchedAtUnixMs,
          receivedAtUnixMs: rawRow.receivedAtUnixMs,
          payload: candidate,
          nowMs,
          codeVersion,
          pipelineRunId: pipelineRunId ?? "dev",
          collector: "collect-pyth-price",
          jobName: "pyth-oracle-job"
        };

        const enriched = await enrichPriceObservation(input);
        enrichedIsStale = enriched.isStale;
        enrichedValidUntilUnixMs = enriched.validUntilUnixMs;
        enrichedConfidenceLevel = enriched.confidenceLevel as ConfidenceLevel;
        return [enriched];
      },
      insertNormalized: async (enriched, candidates, rawRow) => {
        if (enriched.length === 0) return 0;

        const entry = getObservationKindEntry(enriched[0]!.observationKind as ObservationKind);
        const normInserts = enriched.map((e, i) => {
          const cand = candidates[i]!;
          const conf = e.confidence as Confidence;
          return {
            rawObservationId: rawRow.id,
            source: SOURCE,
            observationKind: cand.kind,
            signalClass: e.signalClass as SignalClass,
            evidenceFamily: e.evidenceFamily as EvidenceFamily,
            payload: cand as OraclePricePayloadV1,
            payloadHash: e.payloadHash,
            confidence: conf,
            confidenceComposite: conf.compositeScore,
            confidenceLevel: conf.level,
            validUntilUnixMs: e.validUntilUnixMs,
            isStale: e.isStale,
            staleBehavior: entry.freshnessPolicy.staleBehavior,
            provenance: e.provenance,
            receivedAtUnixMs: rawRow.receivedAtUnixMs
          };
        });

        await normalizedObservationRepo.insertMany(
          normInserts as readonly NormalizedObservationInsert[]
        );
        return normInserts.length;
      }
    });

    if (!firstCandidate) {
      firstCandidate = normalizePythPrice(envelope, feedId, fetchedAtUnixMs);
    }

    const warnings = firstCandidate.warnings;
    const hasWideConfidence = warnings.includes("wide_confidence_interval");

    let freshness: Freshness;
    let confidenceLevel: ConfidenceLevel;

    if (enrichedIsStale !== undefined) {
      freshness = {
        isStale: enrichedIsStale,
        validUntilUnixMs: enrichedValidUntilUnixMs ?? 0,
        derivedAt: receivedAtUnixMs,
        policyKind: "oracle_price",
        reasons: []
      };
      confidenceLevel = enrichedConfidenceLevel ?? "medium";
    } else {
      // enrichCandidates is skipped when ingestRawObservation short-circuits on an
      // already-parsed identical replay, so fall back to the last persisted row.
      const latestNormalized = await normalizedObservationRepo.findLatestByKind(
        SOURCE,
        "oracle_price"
      );

      if (latestNormalized) {
        freshness = {
          isStale: latestNormalized.isStale,
          validUntilUnixMs: latestNormalized.validUntilUnixMs ?? 0,
          derivedAt: receivedAtUnixMs,
          policyKind: "oracle_price",
          reasons: []
        };
        confidenceLevel = (latestNormalized.confidenceLevel as ConfidenceLevel) ?? "medium";
      } else {
        freshness = {
          isStale: false,
          validUntilUnixMs: observedAtUnixMs + 60_000,
          derivedAt: receivedAtUnixMs,
          policyKind: "oracle_price",
          reasons: []
        };
        confidenceLevel = "medium";
      }
    }

    if (freshness.isStale) {
      return {
        status: "stale",
        rawObservationId: result.rawObservationId,
        normalizedCount: result.normalizedCount,
        warnings,
        freshness,
        confidenceLevel
      } as StaleResult;
    }

    if (hasWideConfidence) {
      return {
        status: "degraded",
        rawObservationId: result.rawObservationId,
        normalizedCount: result.normalizedCount,
        warnings,
        freshness,
        confidenceLevel,
        reason: "wide_confidence_interval"
      } as DegradedResult;
    }

    if (result.rawOutcome.outcome === "identical_replay") {
      return {
        status: "identical_replay",
        rawObservationId: result.rawObservationId,
        normalizedCount: result.normalizedCount,
        warnings,
        freshness,
        confidenceLevel
      } as IdenticalReplayResult;
    }

    return {
      status: "accepted",
      rawObservationId: result.rawObservationId,
      normalizedCount: result.normalizedCount,
      warnings,
      freshness,
      confidenceLevel
    } as AcceptedResult;
  } catch (err) {
    if (err instanceof RawObservationConflictError) {
      return {
        status: "conflict",
        summary: `Observation conflict: existing ${err.existingPayloadHash.slice(0, 8)} vs incoming ${err.incomingPayloadHash.slice(0, 8)}`,
        existingPayloadHash: err.existingPayloadHash,
        incomingPayloadHash: err.incomingPayloadHash
      } as ConflictResult;
    }
    return mapHttpError(err);
  }
}

export { PriceSourceResult, safeSummary } from "./price-source-result.js";
