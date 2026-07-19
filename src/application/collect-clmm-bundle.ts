import type { HttpClient } from "../ports/http.js";
import type { JsonStore } from "../ports/json-store.js";
import type { EnvReader } from "../ports/env.js";
import type { Clock } from "../ports/clock.js";
import type {
  RawObservationRepo,
  RawInsertOutcome,
  RawObservationRow
} from "../ports/observation-repo.js";
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

export class ClmmObservationConflictError extends Error {
  constructor(
    public readonly source: Source,
    public readonly sourceObservationKey: string,
    public readonly existingPayloadHash: string,
    public readonly incomingPayloadHash: string
  ) {
    super(
      `Conflict for ${source}:${sourceObservationKey}: existing hash ${existingPayloadHash} vs incoming ${incomingPayloadHash}`
    );
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
  const { http, jsonStore, env, clock, rawObservationRepo } = deps;

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

  const rawInsertResult = await rawObservationRepo.insertOrClassify({
    source: SOURCE,
    sourceObservationKey,
    observedAtUnixMs: bundle.observedAtUnixMs,
    fetchedAtUnixMs: receivedAtUnixMs,
    payloadHash,
    payloadCanonical,
    parseStatus: "pending",
    sourceRequestMeta: redactedMeta,
    receivedAtUnixMs
  });

  if (rawInsertResult.outcome === "conflict") {
    throw new ClmmObservationConflictError(
      SOURCE,
      sourceObservationKey,
      rawInsertResult.row.payloadHash,
      rawInsertResult.incomingPayloadHash
    );
  }

  if (rawInsertResult.outcome === "identical_replay") {
    const existingRow = rawInsertResult.row;

    if (existingRow.parseStatus === "parsed") {
      await jsonStore.writeJson(CLMM_BUNDLE_PATH, bundle);
      return {
        rawObservationId: existingRow.id,
        rawOutcome: rawInsertResult,
        normalizedCount: 0,
        parseStatus: "parsed"
      };
    }

    const canonicalBundle = JSON.parse(existingRow.payloadCanonical) as ClmmBundle;
    const validatedBundle = acceptClmmBundle(canonicalBundle);
    return await normalizeAndStore(
      deps,
      existingRow,
      rawInsertResult,
      validatedBundle,
      bundle,
      codeVersion,
      pipelineRunId
    );
  }

  return await normalizeAndStore(
    deps,
    rawInsertResult.row,
    rawInsertResult,
    bundle,
    bundle,
    codeVersion,
    pipelineRunId
  );
}

async function normalizeAndStore(
  deps: CollectClmmBundleDeps,
  rawRow: RawObservationRow,
  rawOutcome: RawInsertOutcome,
  bundle: ClmmBundle,
  compatibilityBundle: ClmmBundle,
  codeVersion: string,
  pipelineRunId: string | null
): Promise<CollectClmmBundleResult> {
  const { rawObservationRepo, normalizedObservationRepo, jsonStore } = deps;

  const receivedAtUnixMs = rawRow.receivedAtUnixMs;
  const nowMs = receivedAtUnixMs;

  let parseStatus: ParseStatus = "pending";
  let normalizedCount = 0;

  try {
    const candidates = normalizeClmmBundle(bundle);

    const enrichmentCandidates = candidates.map((candidate) => ({
      id: rawRow.id,
      source: SOURCE,
      payloadHash: rawRow.payloadHash,
      receivedAtUnixMs,
      fetchedAtUnixMs: rawRow.fetchedAtUnixMs,
      observedAtUnixMs: bundle.observedAtUnixMs,
      kind: candidate.kind,
      payload: candidate as ClmmNormalizedCandidate
    }));

    const enriched = await enrichClmmCandidates({
      candidates: enrichmentCandidates,
      nowMs,
      codeVersion,
      runId: pipelineRunId
    });

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
        receivedAtUnixMs
      };
    });

    await normalizedObservationRepo.insertMany(normInserts);
    normalizedCount = normInserts.length;
    parseStatus = "parsed";
  } catch (err) {
    try {
      await rawObservationRepo.updateParseStatus(rawRow.id, "failed");
    } catch {
      throw err;
    }
    throw err;
  }

  await rawObservationRepo.updateParseStatus(rawRow.id, parseStatus);

  await jsonStore.writeJson(CLMM_BUNDLE_PATH, compatibilityBundle);

  return {
    rawObservationId: rawRow.id,
    rawOutcome,
    normalizedCount,
    parseStatus
  };
}
