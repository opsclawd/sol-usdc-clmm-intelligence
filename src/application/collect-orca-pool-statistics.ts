import type { HttpClient } from "../ports/http.js";
import { HttpRequestError } from "../ports/http.js";
import type { EnvReader } from "../ports/env.js";
import type { Clock } from "../ports/clock.js";
import type { RawObservationRepo } from "../ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../ports/normalized-observation-repo.js";
import { mapSourceError } from "./source-outcome.js";
import type { SourceCollectionOutcome, SourceWarning } from "../contracts/collection-run.js";
import type { Freshness, ConfidenceLevel, Source } from "../contracts/taxonomy.js";
import {
  acceptOrcaPoolResponse,
  deriveOrcaSourceObservationKey,
  normalizeOrcaPoolStatistics,
  OrcaPoolValidationError,
  type OrcaPoolData
} from "../domain/pool-statistics/index.js";
import {
  enrichPoolStatistics,
  type EnrichedPoolStatisticsObservation
} from "../domain/pool-statistics/enrich.js";
import { canonicalizePayload } from "../domain/content-hash.js";
import { getObservationKindEntry } from "../domain/taxonomy/registry.js";
import { ingestRawObservation, RawObservationConflictError } from "./ingest-raw-observation.js";
import type { CollectionRunContext } from "./create-collection-run-context.js";
import type { PoolStatisticsPayloadV1 } from "../contracts/normalized-pool-statistics.js";

export interface CollectOrcaPoolStatisticsDeps {
  http: HttpClient;
  env: EnvReader;
  clock: Clock;
  rawObservationRepo: RawObservationRepo;
  normalizedObservationRepo: NormalizedObservationRepo;
}

const SOURCE = "orca-public-api";
const SOURCE_KEY = "orca";

export async function collectOrcaPoolStatistics(
  deps: CollectOrcaPoolStatisticsDeps,
  context: CollectionRunContext
): Promise<SourceCollectionOutcome> {
  const { http, env, rawObservationRepo, normalizedObservationRepo } = deps;

  const base = env.getOptional("ORCA_API_BASE") ?? "https://api.orca.so/v2/solana";
  const poolAddress = env.get("WHIRLPOOL_ADDRESS");
  const tokenAMint = env.getOptional("SOL_MINT") ?? "So11111111111111111111111111111111111111112";
  const tokenBMint = env.getOptional("USDC_MINT") ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const codeVersion = env.getOptional("INTELLIGENCE_CODE_VERSION") ?? "development";
  const pipelineRunId = context.runId;

  const normalizedBase = base.replace(/\/$/, "");
  const path = "/public/pool";
  const url = `${normalizedBase}${path}?address=${poolAddress}&stats=24h`;

  let response: unknown;
  try {
    response = await http.getJson<unknown>(url, {
      timeoutMs: 5000,
      maxAttempts: 2
    });
  } catch (err) {
    let status: "timeout" | "network" | "unavailable" | "malformed" = "network";
    const diagnostic = err instanceof Error ? err.message : String(err);

    if (err instanceof HttpRequestError) {
      if (err.kind === "timeout") {
        status = "timeout";
      } else if (err.kind === "http_status") {
        const code = err.status ?? 0;
        if (code === 404 || code === 429 || code >= 500) {
          status = "unavailable";
        } else {
          status = "network";
        }
      } else if (err.kind === "invalid_json") {
        status = "malformed";
      } else {
        status = "network";
      }
    } else if (diagnostic.includes("JSON") || diagnostic.includes("Unexpected token")) {
      status = "malformed";
    }

    return {
      sourceKey: SOURCE_KEY,
      source: SOURCE,
      status,
      hasUsableEvidence: false,
      rawObservationId: null,
      normalizedCount: 0,
      warnings: [],
      freshness: null,
      confidenceLevel: null,
      diagnostic
    };
  }

  let acceptedData: ReturnType<typeof acceptOrcaPoolResponse>;
  try {
    acceptedData = acceptOrcaPoolResponse(response, poolAddress, tokenAMint, tokenBMint);
  } catch (err) {
    return {
      sourceKey: SOURCE_KEY,
      source: SOURCE,
      status: err instanceof OrcaPoolValidationError ? "malformed" : "failed",
      hasUsableEvidence: false,
      rawObservationId: null,
      normalizedCount: 0,
      warnings: [],
      freshness: null,
      confidenceLevel: null,
      diagnostic: err instanceof Error ? err.message : String(err)
    };
  }

  const { payloadCanonical, payloadHash } = await canonicalizePayload(response);
  const observedAtUnixMs = Date.parse(acceptedData.accepted.updatedAt);
  const sourceObservationKey = await deriveOrcaSourceObservationKey({
    poolAddress,
    updatedAt: acceptedData.accepted.updatedAt,
    updatedSlot: acceptedData.accepted.updatedSlot
  });

  const redactedMeta = {
    method: "GET" as const,
    host: "api.orca.so",
    path,
    poolAddress,
    statsWindow: "24h",
    apiVersion: "v2",
    intelligenceCodeVersion: codeVersion,
    intelligencePipelineRunId: pipelineRunId
  };

  const ingestDeps = {
    rawObservationRepo,
    normalizedObservationRepo,
    jsonStore: {
      writeJson: async () => {}, // absence of JSON-store writes
      readJson: async () => undefined
    }
  };

  try {
    const ingestResult = await ingestRawObservation<
      OrcaPoolData,
      PoolStatisticsPayloadV1,
      EnrichedPoolStatisticsObservation
    >(ingestDeps, {
      source: SOURCE as Source,
      sourceObservationKey,
      observedAtUnixMs,
      fetchedAtUnixMs: context.startedAtUnixMs,
      payloadCanonical,
      payloadHash,
      sourceRequestMeta: redactedMeta,
      receivedAtUnixMs: context.startedAtUnixMs,
      validatePayload: (canonical) => {
        const parsed = JSON.parse(canonical);
        const { accepted } = acceptOrcaPoolResponse(parsed, poolAddress, tokenAMint, tokenBMint);
        return { accepted };
      },
      buildCandidates: (accepted) => {
        return [
          normalizeOrcaPoolStatistics({ accepted, fetchedAtUnixMs: context.startedAtUnixMs })
        ];
      },
      enrichCandidates: async (candidates, rawRow) => {
        const cand = candidates[0]!;
        const enriched = await enrichPoolStatistics({
          candidate: {
            id: rawRow.id,
            source: SOURCE as Source,
            payloadHash: rawRow.payloadHash,
            receivedAtUnixMs: rawRow.receivedAtUnixMs,
            fetchedAtUnixMs: rawRow.fetchedAtUnixMs,
            observedAtUnixMs: rawRow.observedAtUnixMs,
            kind: "pool_statistics",
            payload: cand
          },
          nowMs: rawRow.receivedAtUnixMs,
          codeVersion,
          runId: pipelineRunId
        });
        return [enriched];
      },
      insertNormalized: async (enriched, candidates, rawRow) => {
        const e = enriched[0]!;
        const cand = candidates[0]!;
        const entry = getObservationKindEntry("pool_statistics");
        const normInsert = {
          rawObservationId: rawRow.id,
          source: SOURCE as Source,
          observationKind: "pool_statistics" as const,
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
      "pool_statistics"
    );

    if (!normRow) {
      return {
        sourceKey: SOURCE_KEY,
        source: SOURCE,
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

    const payload = normRow.payload as PoolStatisticsPayloadV1;
    const hasUsableEvidence =
      payload.tvlUsdc !== null || payload.volume24hUsdc !== null || payload.fees24hUsdc !== null;

    const warnings: SourceWarning[] = (payload.warnings || []).map((w) => ({
      source: SOURCE_KEY,
      code: w,
      message: `Orca warning: ${w}`
    }));

    const freshness: Freshness = {
      isStale: normRow.isStale,
      validUntilUnixMs: normRow.validUntilUnixMs ?? 0,
      derivedAt: context.startedAtUnixMs,
      policyKind: "pool_statistics",
      reasons: normRow.isStale ? ["expired_past_max_observed_age"] : []
    };

    let status: "accepted" | "identical_replay" | "degraded" | "stale" = "accepted";
    if (normRow.isStale) {
      status = "stale";
    } else if (payload.sourceQuality.completeness === "partial" || !hasUsableEvidence) {
      status = "degraded";
    } else if (ingestResult.rawOutcome.outcome === "identical_replay") {
      status = "identical_replay";
    }

    return {
      sourceKey: SOURCE_KEY,
      source: SOURCE,
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
    if (err instanceof Error && err.name === "PostPersistenceOutputError") {
      return mapSourceError(SOURCE_KEY, SOURCE, err);
    }

    let rawObservationId: number | null = null;
    try {
      const existing = await rawObservationRepo.findByIdentity(SOURCE, sourceObservationKey);
      if (existing) {
        rawObservationId = existing.id;
      }
    } catch {
      // Ignore lookup failures during error handling
    }

    const status = err instanceof RawObservationConflictError ? "conflict" : "failed";

    return {
      sourceKey: SOURCE_KEY,
      source: SOURCE,
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
