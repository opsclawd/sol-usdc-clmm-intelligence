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
  acceptJupiterQuote,
  deriveJupiterSourceObservationKey,
  normalizeJupiterQuote,
  type JupiterQuote
} from "../domain/price-observation/jupiter.js";
import { canonicalizePayload } from "../domain/content-hash.js";
import {
  enrichPriceObservation,
  type EnrichPriceObservationInput
} from "../domain/price-observation/enrich.js";
import { getObservationKindEntry } from "../domain/taxonomy/registry.js";
import type { ExecutableQuotePayloadV1 } from "../contracts/normalized-price-observation.js";
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

export interface CollectJupiterQuoteDeps {
  http: HttpClient;
  jsonStore: JsonStore;
  env: EnvReader;
  clock: Clock;
  rawObservationRepo: RawObservationRepo;
  normalizedObservationRepo: NormalizedObservationRepo;
}

const SOURCE = "jupiter-quote" as const;
const SCHEMA_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_ATTEMPTS = 2;
export const PRICE_SNAPSHOT_PATH = "data/latest-price-snapshot.json";

function parseClockNow(clock: Clock): number {
  const now = clock.now();
  const parsed = Date.parse(now);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid clock value: ${now}`);
  }
  return parsed;
}

function extractHost(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return url.host;
  } catch {
    return baseUrl;
  }
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

export async function collectJupiterQuote(
  deps: CollectJupiterQuoteDeps
): Promise<PriceSourceResult> {
  const { http, jsonStore, env, clock, rawObservationRepo, normalizedObservationRepo } = deps;

  const baseUrl = env.get("JUPITER_API_BASE");
  const apiKey = env.getOptional("JUPITER_API_KEY");

  const solMint = env.get("SOL_MINT", "So11111111111111111111111111111111111111112");
  const usdcMint = env.get("USDC_MINT", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

  const pipelineRunId = env.getOptional("INTELLIGENCE_PIPELINE_RUN_ID") ?? null;
  const codeVersion = env.getOptional("INTELLIGENCE_CODE_VERSION") ?? "development";

  const host = extractHost(baseUrl);
  const normalizedBase = baseUrl.replace(/\/$/, "");

  const url = `${normalizedBase}/quote?inputMint=${encodeURIComponent(solMint)}&outputMint=${encodeURIComponent(usdcMint)}&amount=1000000000&swapMode=ExactIn&slippageBps=50&restrictIntermediateTokens=true`;

  const headers: Record<string, string> = {};
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  let quote: JupiterQuote;
  let firstCandidate: ReturnType<typeof normalizeJupiterQuote> | undefined;
  let enrichedIsStale: boolean | undefined;
  let enrichedValidUntilUnixMs: number | undefined;
  let enrichedConfidenceLevel: ConfidenceLevel | undefined;

  try {
    const requestOptions = {
      ...(Object.keys(headers).length > 0 && { headers }),
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxAttempts: DEFAULT_MAX_ATTEMPTS
    };
    const response = await http.getJson<unknown>(url, requestOptions);
    quote = response as JupiterQuote;

    if (quote && typeof quote === "object" && ("errorCode" in quote || "message" in quote)) {
      const errObj = quote as Record<string, unknown>;
      if (
        errObj.errorCode === "COULD_NOT_FIND_ANY_ROUTE" ||
        (typeof errObj.message === "string" &&
          (errObj.message.includes("COULD_NOT_FIND_ANY_ROUTE") ||
            errObj.message.includes("no route")))
      ) {
        return {
          status: "no_route",
          summary: String(errObj.message || errObj.errorCode || "COULD_NOT_FIND_ANY_ROUTE")
        } as NoRouteResult;
      }
    }

    acceptJupiterQuote(quote);
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes("COULD_NOT_FIND_ANY_ROUTE") ||
        err.message.includes("no route available") ||
        err.message.includes("Route plan must contain at least one route"))
    ) {
      return { status: "no_route", summary: err.message } as NoRouteResult;
    }
    if (err instanceof Error && err.message.includes("Invalid Jupiter quote")) {
      return { status: "malformed", summary: err.message } as MalformedResult;
    }
    return mapHttpError(err);
  }

  const receivedAtUnixMs = parseClockNow(clock);
  const { payloadCanonical, payloadHash } = await canonicalizePayload(quote);

  const sourceObservationKey = await deriveJupiterSourceObservationKey({
    inputMint: quote.inputMint,
    outputMint: quote.outputMint,
    inAmount: quote.inAmount,
    swapMode: quote.swapMode,
    contextSlot: quote.contextSlot
  });

  const redactedMeta = {
    host,
    path: "/quote",
    inputMint: solMint,
    outputMint: usdcMint,
    amount: "1000000000",
    swapMode: "ExactIn",
    slippageBps: 50,
    restrictIntermediateTokens: true,
    version: SCHEMA_VERSION,
    runId: pipelineRunId
  };

  const observedAtUnixMs = receivedAtUnixMs;
  const fetchedAtUnixMs = receivedAtUnixMs;

  const ingestDeps: IngestRawObservationDeps = {
    rawObservationRepo,
    normalizedObservationRepo,
    jsonStore
  };

  try {
    const result = await ingestRawObservation<
      JupiterQuote,
      ExecutableQuotePayloadV1,
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
        const parsed = JSON.parse(canonical) as JupiterQuote;
        const { quote: acceptedQuote } = acceptJupiterQuote(parsed);
        return { accepted: acceptedQuote };
      },
      buildCandidates: (accepted) => {
        const normalized = normalizeJupiterQuote(accepted, fetchedAtUnixMs);
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
          collector: "collect-jupiter-quote",
          jobName: "jupiter-quote-job"
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
            payload: cand as ExecutableQuotePayloadV1,
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
      },
      writeCompatibilityOutput: async (accepted) => {
        const normalized = normalizeJupiterQuote(accepted, fetchedAtUnixMs);
        const priceStr = normalized.quoteData.price;
        if (!priceStr) {
          throw new Error("Quote price is missing or null");
        }
        const priceNum = parseFloat(priceStr);
        if (!Number.isFinite(priceNum) || priceNum <= 0 || priceNum > 100000) {
          throw new Error(`Implied price out of safe range: ${priceStr}`);
        }

        await jsonStore.writeJson(PRICE_SNAPSHOT_PATH, {
          pair: "SOL/USDC",
          timestamp: clock.now(),
          source: SOURCE,
          priceUsd: priceNum,
          confidence: "high",
          raw: accepted
        });
      }
    });

    if (!firstCandidate) {
      firstCandidate = normalizeJupiterQuote(quote, fetchedAtUnixMs);
    }

    const warnings = firstCandidate.warnings;
    const hasHighImpact = warnings.includes("price_impact_exceeds_threshold");

    let freshness: Freshness;
    let confidenceLevel: ConfidenceLevel;

    if (enrichedIsStale !== undefined) {
      freshness = {
        isStale: enrichedIsStale,
        validUntilUnixMs: enrichedValidUntilUnixMs ?? 0,
        derivedAt: receivedAtUnixMs,
        policyKind: "executable_quote",
        reasons: []
      };
      confidenceLevel = enrichedConfidenceLevel ?? "medium";
    } else {
      const latestNormalized = await normalizedObservationRepo.findLatestByKind(
        SOURCE,
        "executable_quote"
      );

      if (latestNormalized) {
        freshness = {
          isStale: latestNormalized.isStale,
          validUntilUnixMs: latestNormalized.validUntilUnixMs ?? 0,
          derivedAt: receivedAtUnixMs,
          policyKind: "executable_quote",
          reasons: []
        };
        confidenceLevel = (latestNormalized.confidenceLevel as ConfidenceLevel) ?? "medium";
      } else {
        freshness = {
          isStale: false,
          validUntilUnixMs: observedAtUnixMs + 30_000,
          derivedAt: receivedAtUnixMs,
          policyKind: "executable_quote",
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

    if (hasHighImpact) {
      return {
        status: "degraded",
        rawObservationId: result.rawObservationId,
        normalizedCount: result.normalizedCount,
        warnings,
        freshness,
        confidenceLevel,
        reason: "price_impact_exceeds_threshold"
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
    if (err instanceof HttpRequestError) {
      return mapHttpError(err);
    }
    throw err;
  }
}
