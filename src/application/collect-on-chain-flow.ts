import type { Source } from "../contracts/taxonomy.js";
import type { OnChainFlowThresholds } from "../contracts/on-chain-flow.js";
import type {
  OnChainFlowSourcePort,
  OnChainFlowSourceRequest,
  OnChainFlowSourceSnapshot
} from "../ports/on-chain-flow-source.js";
import type { RawObservationRepo } from "../ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../ports/normalized-observation-repo.js";
import type { CollectionRunContext } from "../contracts/collection-run.js";
import {
  acceptOnChainFlowSourceEvent,
  parseOnChainFlowThresholds,
  qualifiesOnChainFlow,
  normalizeOnChainFlow,
  deriveOnChainFlowSourceObservationKey,
  enrichOnChainFlow,
  type AcceptedOnChainFlowSourceEvent,
  type ParsedOnChainFlowThresholds,
  type OnChainFlowPayloadV1
} from "../domain/on-chain-flow/index.js";
import { canonicalizePayload } from "../domain/content-hash.js";
import { getObservationKindEntry } from "../domain/taxonomy/registry.js";
import { RawObservationConflictError } from "./ingest-raw-observation.js";
import type { OnChainFlowEnrichmentCandidate } from "../domain/on-chain-flow/enrich.js";

export interface CollectOnChainFlowDeps {
  source: OnChainFlowSourcePort;
  rawObservationRepo: RawObservationRepo;
  normalizedObservationRepo: NormalizedObservationRepo;
}

export interface OnChainFlowCollectionResult {
  status:
    | "accepted"
    | "partial"
    | "degraded"
    | "identical_replay"
    | "malformed"
    | "timeout"
    | "network"
    | "unavailable"
    | "failed";
  accepted: number;
  filtered: number;
  replayed: number;
  failed: number;
  conflict: number;
  sourceObservationId: number | null;
  sourceObservationKey: string | null;
  results: readonly {
    sourceEventId: string;
    sourceObservationKey: string;
    sourceObservationId: number;
    outcome: "accepted" | "filtered" | "replayed" | "conflict" | "failed";
    diagnostic: string | null;
  }[];
}

function mapSourceErrorToStatus(error: unknown): {
  status: "timeout" | "network" | "unavailable" | "malformed" | "failed";
  diagnostic: string;
} {
  if (error && typeof error === "object" && "kind" in error) {
    const err = error as { kind: string; diagnostic?: string };
    switch (err.kind) {
      case "timeout":
        return { status: "timeout", diagnostic: err.diagnostic ?? "timeout" };
      case "network":
        return { status: "network", diagnostic: err.diagnostic ?? "network error" };
      case "unavailable":
        return { status: "unavailable", diagnostic: err.diagnostic ?? "unavailable" };
      case "malformed":
        return { status: "malformed", diagnostic: err.diagnostic ?? "malformed" };
    }
  }
  if (error instanceof Error) {
    return { status: "failed", diagnostic: error.message };
  }
  return { status: "failed", diagnostic: "unknown error" };
}

function sortEventsByIdentity(
  events: readonly AcceptedOnChainFlowSourceEvent[]
): AcceptedOnChainFlowSourceEvent[] {
  return [...events].sort((a, b) => {
    const aId = (a as { sourceEventId?: string }).sourceEventId;
    const aHash = (a as { transactionHash?: string }).transactionHash;
    const aKey = a.eventKind + ":" + (aId ?? aHash ?? "");
    const bId = (b as { sourceEventId?: string }).sourceEventId;
    const bHash = (b as { transactionHash?: string }).transactionHash;
    const bKey = b.eventKind + ":" + (bId ?? bHash ?? "");
    return aKey.localeCompare(bKey);
  });
}

function getSourceEventId(event: AcceptedOnChainFlowSourceEvent): string {
  const sourceEventId = (event as { sourceEventId?: string }).sourceEventId;
  if (sourceEventId) return sourceEventId;
  const transactionHash = (event as { transactionHash?: string }).transactionHash;
  if (transactionHash) return transactionHash;
  return String((event as { timestampUnixMs?: number }).timestampUnixMs ?? "unknown");
}

export async function collectOnChainFlow(
  deps: CollectOnChainFlowDeps,
  context: CollectionRunContext,
  input: {
    source: "helius-api" | "birdeye-api";
    thresholds: OnChainFlowThresholds;
    lookbackMs: number;
  }
): Promise<OnChainFlowCollectionResult> {
  const { source, rawObservationRepo, normalizedObservationRepo } = deps;
  const { lookbackMs } = input;

  const toUnixMs = context.startedAtUnixMs;
  const fromUnixMs = toUnixMs - lookbackMs;

  let snapshot: OnChainFlowSourceSnapshot;
  try {
    const request: OnChainFlowSourceRequest = {
      pair: "SOL/USDC",
      fromUnixMs,
      toUnixMs
    };
    snapshot = await source.collect(request);
  } catch (err) {
    const { status, diagnostic } = mapSourceErrorToStatus(err);
    return {
      status,
      accepted: 0,
      filtered: 0,
      replayed: 0,
      failed: 0,
      conflict: 0,
      sourceObservationId: null,
      sourceObservationKey: null,
      results: [
        {
          sourceEventId: "",
          sourceObservationKey: "",
          sourceObservationId: 0,
          outcome: "failed" as const,
          diagnostic
        }
      ]
    };
  }

  if (snapshot.events.length === 0) {
    return {
      status: "accepted",
      accepted: 0,
      filtered: 0,
      replayed: 0,
      failed: 0,
      conflict: 0,
      sourceObservationId: null,
      sourceObservationKey: null,
      results: []
    };
  }

  const parsedThresholds: ParsedOnChainFlowThresholds = parseOnChainFlowThresholds(
    input.thresholds
  );
  const results: {
    sourceEventId: string;
    sourceObservationKey: string;
    sourceObservationId: number;
    outcome: "accepted" | "filtered" | "replayed" | "conflict" | "failed";
    diagnostic: string | null;
  }[] = [];
  let accepted = 0;
  let filtered = 0;
  let replayed = 0;
  let failed = 0;
  let conflict = 0;
  let hasStale = false;

  const sortedEvents = sortEventsByIdentity(
    snapshot.events as readonly AcceptedOnChainFlowSourceEvent[]
  );

  for (const event of sortedEvents) {
    let validatedEvent: AcceptedOnChainFlowSourceEvent;
    try {
      validatedEvent = acceptOnChainFlowSourceEvent(event);
    } catch {
      failed++;
      results.push({
        sourceEventId: String(
          (event as { sourceEventId?: string }).sourceEventId ??
            (event as { transactionHash?: string }).transactionHash ??
            "unknown"
        ),
        sourceObservationKey: "",
        sourceObservationId: 0,
        outcome: "failed",
        diagnostic: "validation failed"
      });
      continue;
    }

    const passesThreshold = qualifiesOnChainFlow(validatedEvent, parsedThresholds);
    if (!passesThreshold) {
      filtered++;
      results.push({
        sourceEventId: getSourceEventId(validatedEvent),
        sourceObservationKey: "",
        sourceObservationId: 0,
        outcome: "filtered",
        diagnostic: null
      });
      continue;
    }

    let normalizedPayload: OnChainFlowPayloadV1;
    try {
      normalizedPayload = normalizeOnChainFlow(validatedEvent, context.startedAtUnixMs);
    } catch {
      failed++;
      results.push({
        sourceEventId: getSourceEventId(validatedEvent),
        sourceObservationKey: "",
        sourceObservationId: 0,
        outcome: "failed",
        diagnostic: "normalization failed"
      });
      continue;
    }

    const sourceObservationKey = await deriveOnChainFlowSourceObservationKey(
      normalizedPayload,
      input.source as Source,
      snapshot.providerRunId
    );

    const { payloadCanonical, payloadHash } = await canonicalizePayload(normalizedPayload);
    const receivedAtUnixMs = context.startedAtUnixMs;
    const fetchedAtUnixMs = snapshot.asOfUnixMs;

    try {
      const rawInsertResult = await rawObservationRepo.insertOrClassify({
        source: input.source as Source,
        sourceObservationKey,
        observedAtUnixMs: normalizedPayload.observedAtUnixMs,
        fetchedAtUnixMs,
        payloadHash,
        payloadCanonical,
        parseStatus: "pending",
        receivedAtUnixMs
      });

      if (rawInsertResult.outcome === "identical_replay") {
        replayed++;
        results.push({
          sourceEventId: normalizedPayload.sourceEventId,
          sourceObservationKey,
          sourceObservationId: rawInsertResult.row.id,
          outcome: "replayed",
          diagnostic: null
        });
        continue;
      }

      if (rawInsertResult.outcome === "conflict") {
        conflict++;
        results.push({
          sourceEventId: normalizedPayload.sourceEventId,
          sourceObservationKey,
          sourceObservationId: rawInsertResult.row.id,
          outcome: "conflict",
          diagnostic: `existing hash ${rawInsertResult.row.payloadHash.slice(0, 8)} vs incoming ${rawInsertResult.incomingPayloadHash.slice(0, 8)}`
        });
        continue;
      }

      const rawRow = rawInsertResult.row;

      const candidates = [
        {
          id: rawRow.id,
          source: input.source as Source,
          payload: normalizedPayload,
          observedAtUnixMs: normalizedPayload.observedAtUnixMs,
          receivedAtUnixMs,
          fetchedAtUnixMs
        }
      ];

      try {
        const enriched = await enrichOnChainFlow({
          candidates: candidates as readonly OnChainFlowEnrichmentCandidate[],
          nowMs: receivedAtUnixMs,
          codeVersion: "on-chain-flow-v1",
          runId: context.runId
        });

        if (enriched[0]!.freshness.isStale) {
          hasStale = true;
        }

        const entry = getObservationKindEntry(enriched[0]!.kind);
        const normInserts = enriched.map((e, i) => {
          const cand = candidates[i]!;
          return {
            rawObservationId: rawRow.id,
            source: input.source as Source,
            observationKind: cand.payload.eventType as Parameters<
              typeof getObservationKindEntry
            >[0],
            signalClass: e.signalClass,
            evidenceFamily: e.evidenceFamily,
            payload: cand.payload,
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
        await rawObservationRepo.updateParseStatus(rawRow.id, "parsed");

        accepted++;
        results.push({
          sourceEventId: normalizedPayload.sourceEventId,
          sourceObservationKey,
          sourceObservationId: rawRow.id,
          outcome: "accepted",
          diagnostic: null
        });
      } catch (err) {
        await rawObservationRepo.updateParseStatus(rawRow.id, "failed");
        failed++;
        results.push({
          sourceEventId: normalizedPayload.sourceEventId,
          sourceObservationKey,
          sourceObservationId: rawRow.id,
          outcome: "failed",
          diagnostic: err instanceof Error ? err.message : "processing failed"
        });
      }
    } catch (err) {
      if (err instanceof RawObservationConflictError) {
        conflict++;
        results.push({
          sourceEventId: normalizedPayload.sourceEventId,
          sourceObservationKey,
          sourceObservationId: 0,
          outcome: "conflict",
          diagnostic: "payload hash conflict"
        });
      } else {
        failed++;
        results.push({
          sourceEventId: normalizedPayload.sourceEventId,
          sourceObservationKey,
          sourceObservationId: 0,
          outcome: "failed",
          diagnostic: err instanceof Error ? err.message : "unknown error"
        });
      }
    }
  }

  let status: OnChainFlowCollectionResult["status"] = "accepted";
  if (accepted === 0 && replayed === 0 && failed > 0) {
    status = "malformed";
  } else if (hasStale && accepted > 0 && failed === 0 && conflict === 0) {
    status = "degraded";
  } else if (accepted > 0 && (failed > 0 || conflict > 0)) {
    status = "partial";
  } else if (accepted === 0 && replayed > 0 && conflict === 0 && failed === 0) {
    status = "identical_replay";
  } else if (conflict > 0 || failed > 0) {
    status = "failed";
  }

  const firstAccepted = results.find((r) => r.outcome === "accepted");
  return {
    status,
    accepted,
    filtered,
    replayed,
    failed,
    conflict,
    sourceObservationId: firstAccepted?.sourceObservationId ?? null,
    sourceObservationKey: firstAccepted?.sourceObservationKey ?? null,
    results
  };
}
