import type { HttpClient } from "../ports/http.js";
import type { JsonStore } from "../ports/json-store.js";
import type { EnvReader } from "../ports/env.js";
import type { Clock } from "../ports/clock.js";
import type { RawObservationRepo, RawInsertOutcome } from "../ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../ports/normalized-observation-repo.js";
import type { Source, ParseStatus } from "../contracts/taxonomy.js";
import { acceptClmmBundleEnvelope, acceptClmmBundle } from "../domain/clmm-bundle/validate.js";
import { deriveClmmSourceObservationKey } from "../domain/clmm-bundle/identity.js";
import { normalizeClmmBundle } from "../domain/clmm-bundle/normalize.js";
import { enrichClmmCandidates } from "../domain/clmm-bundle/enrich.js";
import { canonicalizePayload } from "../domain/content-hash.js";
import { getObservationKindEntry } from "../domain/taxonomy/registry.js";
import type { ClmmBundle } from "../contracts/clmm-bundle.js";
import type { ClmmNormalizedCandidate } from "../contracts/normalized-clmm-observation.js";
import {
  ingestRawObservation,
  RawObservationConflictError,
  type IngestRawObservationDeps
} from "./ingest-raw-observation.js";

export interface CollectClmmBundleDeps {
  http: HttpClient;
  jsonStore: JsonStore;
  env: EnvReader;
  clock: Clock;
  rawObservationRepo: RawObservationRepo;
  normalizedObservationRepo: NormalizedObservationRepo;
}

export interface CollectClmmBundleResult {
  rawObservationId: number;
  rawOutcome: RawInsertOutcome;
  normalizedCount: number;
  parseStatus: ParseStatus;
}

export class ClmmObservationConflictError extends RawObservationConflictError {
  constructor(
    source: Source,
    sourceObservationKey: string,
    existingPayloadHash: string,
    incomingPayloadHash: string
  ) {
    super(source, sourceObservationKey, existingPayloadHash, incomingPayloadHash);
    this.name = "ClmmObservationConflictError";
  }
}

export const CLMM_BUNDLE_PATH = "data/latest-clmm-bundle.json";
const SOURCE: Source = "clmm-v2-bundle";

function validateEnvelope(response: Record<string, unknown>): ClmmBundle {
  const { bundle } = acceptClmmBundleEnvelope(response);
  return bundle;
}

async function hashWalletPublicKey(wallet: string): Promise<string> {
  const { payloadHash } = await canonicalizePayload({ wallet });
  return payloadHash;
}

interface RedactedRequestMeta {
  method: "GET";
  path: string;
  walletPublicKeyHash: string;
  intelligenceCodeVersion: string | null;
  intelligencePipelineRunId: string | null;
}

function parseClockNow(clock: Clock): number {
  const now = clock.now();
  const parsed = Date.parse(now);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid clock value: ${now}`);
  }
  return parsed;
}

export async function collectClmmBundle(
  deps: CollectClmmBundleDeps
): Promise<CollectClmmBundleResult> {
  const { http, jsonStore, env, clock, rawObservationRepo, normalizedObservationRepo } = deps;

  const base = env.get("CLMM_DATA_API_BASE");
  const apiKey = env.get("CLMM_INSIGHTS_API_KEY");
  const walletId = env.get("WALLET_PUBLIC_KEY");
  const codeVersion = env.getOptional("INTELLIGENCE_CODE_VERSION") ?? "development";
  const pipelineRunId = env.getOptional("INTELLIGENCE_PIPELINE_RUN_ID") ?? null;

  const normalizedBase = base.replace(/\/$/, "");
  const path = `/insights/sol-usdc/bundle/${walletId}`;
  const url = `${normalizedBase}${path}`;

  const response = await http.getJson<Record<string, unknown>>(url, {
    headers: {
      "x-insights-api-key": apiKey
    }
  });

  const bundle = validateEnvelope(response);

  const receivedAtUnixMs = parseClockNow(clock);
  const { payloadCanonical, payloadHash } = await canonicalizePayload(bundle);

  const walletHash = await hashWalletPublicKey(walletId);
  const sourceObservationKey = await deriveClmmSourceObservationKey({
    identityVersion: 1,
    walletId,
    pair: bundle.pair,
    poolId: bundle.pool.poolId,
    observedAtUnixMs: bundle.observedAtUnixMs
  });

  const redactedMeta: RedactedRequestMeta = {
    method: "GET",
    path,
    walletPublicKeyHash: walletHash,
    intelligenceCodeVersion: codeVersion,
    intelligencePipelineRunId: pipelineRunId
  };

  const ingestDeps: IngestRawObservationDeps = {
    rawObservationRepo,
    normalizedObservationRepo,
    jsonStore
  };

  try {
    const result = await ingestRawObservation<
      ClmmBundle,
      ReturnType<typeof normalizeClmmBundle>[number],
      Awaited<ReturnType<typeof enrichClmmCandidates>>[number],
      ReturnType<NormalizedObservationRepo["insertMany"]>[number]
    >(ingestDeps, {
      source: SOURCE,
      sourceObservationKey,
      observedAtUnixMs: bundle.observedAtUnixMs,
      fetchedAtUnixMs: receivedAtUnixMs,
      payloadCanonical,
      payloadHash,
      sourceRequestMeta: redactedMeta,
      receivedAtUnixMs,
      validatePayload: (canonical) => {
        const parsed = JSON.parse(canonical) as ClmmBundle;
        return { accepted: acceptClmmBundle(parsed) };
      },
      buildCandidates: (accepted) => normalizeClmmBundle(accepted),
      enrichCandidates: async (candidates, rawRow, runId) => {
        const receivedAtUnixMs = rawRow.receivedAtUnixMs;
        const enrichmentCandidates = candidates.map((candidate) => ({
          id: rawRow.id,
          source: SOURCE,
          payloadHash: rawRow.payloadHash,
          receivedAtUnixMs,
          fetchedAtUnixMs: rawRow.fetchedAtUnixMs,
          observedAtUnixMs: rawRow.observedAtUnixMs,
          kind: candidate.kind,
          payload: candidate as ClmmNormalizedCandidate
        }));

        return enrichClmmCandidates({
          candidates: enrichmentCandidates,
          nowMs: receivedAtUnixMs,
          codeVersion,
          runId
        });
      },
      insertNormalized: async (enriched, candidates, rawRow) => {
        const normInserts = enriched.map((e, i) => {
          const cand = candidates[i]!;
          const entry = getObservationKindEntry(e.kind);
          return {
            rawObservationId: rawRow.id,
            source: SOURCE,
            observationKind: cand.kind,
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
        });

        await normalizedObservationRepo.insertMany(normInserts);
        return normInserts.length;
      },
      writeCompatibilityOutput: async (accepted) => {
        await jsonStore.writeJson(CLMM_BUNDLE_PATH, accepted);
      },
      revalidateStoredCanonical: (canonical) => {
        const parsed = JSON.parse(canonical) as ClmmBundle;
        return { accepted: acceptClmmBundle(parsed) };
      }
    });

    return {
      rawObservationId: result.rawObservationId,
      rawOutcome: result.rawOutcome,
      normalizedCount: result.normalizedCount,
      parseStatus: result.parseStatus
    };
  } catch (err) {
    if (err instanceof RawObservationConflictError) {
      throw new ClmmObservationConflictError(
        err.source,
        err.sourceObservationKey,
        err.existingPayloadHash,
        err.incomingPayloadHash
      );
    }
    throw err;
  }
}
