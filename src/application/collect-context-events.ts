import type { Source } from "../contracts/taxonomy.js";
import type { RawObservationRepo, RawObservationRow } from "../ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../ports/normalized-observation-repo.js";
import type { CollectionRunContext } from "./create-collection-run-context.js";
import type {
  ScheduledEventPayloadV1,
  ProtocolIncidentPayloadV1
} from "../contracts/context-events.js";
import type { EnrichedContextEventObservation } from "../domain/context-events/enrich.js";
import { getObservationKindEntry } from "../domain/taxonomy/registry.js";
import { ingestRawObservation } from "./ingest-raw-observation.js";

export type ContextEventCollectionStatus =
  | "accepted"
  | "degraded"
  | "stale"
  | "identical_replay"
  | "malformed"
  | "timeout"
  | "network"
  | "unavailable"
  | "failed";

export interface ContextEventCollectionResult {
  readonly status: ContextEventCollectionStatus;
  readonly rawObservationId: number | null;
  readonly normalizedCount: number;
  readonly warnings: readonly string[];
  readonly diagnostic: string | null;
}

export interface CollectContextEventsDeps {
  rawObservationRepo: RawObservationRepo;
  normalizedObservationRepo: NormalizedObservationRepo;
}

function redactDiagnostic(diagnostic: string): string {
  return diagnostic
    .replace(/api[_-]?key/gi, "[REDACTED]")
    .replace(/secret/gi, "[REDACTED]")
    .replace(/password/gi, "[REDACTED]");
}

export async function collectContextEvents<TAccepted>(
  deps: CollectContextEventsDeps,
  context: CollectionRunContext,
  input: {
    source: Source;
    sourceObservationKey: string;
    observedAtUnixMs: number;
    fetchedAtUnixMs: number;
    payloadCanonical: string;
    payloadHash: string;
    validatePayload: (canonical: string) => TAccepted;
    buildCandidates: (
      accepted: TAccepted,
      rawRow: RawObservationRow
    ) => readonly ScheduledEventPayloadV1[] | readonly ProtocolIncidentPayloadV1[];
    enrichCandidates: (
      candidates: readonly ScheduledEventPayloadV1[] | readonly ProtocolIncidentPayloadV1[],
      rawRow: RawObservationRow,
      runId: string | null
    ) => Promise<readonly EnrichedContextEventObservation[]>;
  }
): Promise<ContextEventCollectionResult> {
  const { rawObservationRepo, normalizedObservationRepo } = deps;

  const collectedWarnings: string[] = [];

  try {
    const ingestResult = await ingestRawObservation<
      TAccepted,
      ScheduledEventPayloadV1 | ProtocolIncidentPayloadV1,
      EnrichedContextEventObservation
    >(
      {
        rawObservationRepo,
        normalizedObservationRepo,
        jsonStore: null as never
      },
      {
        source: input.source,
        sourceObservationKey: input.sourceObservationKey,
        observedAtUnixMs: input.observedAtUnixMs,
        fetchedAtUnixMs: input.fetchedAtUnixMs,
        payloadCanonical: input.payloadCanonical,
        payloadHash: input.payloadHash,
        sourceRequestMeta: null,
        receivedAtUnixMs: context.startedAtUnixMs,
        validatePayload: (canonical: string) => ({ accepted: input.validatePayload(canonical) }),
        buildCandidates: (accepted: TAccepted, rawRow: RawObservationRow) => {
          const candidates = input.buildCandidates(accepted, rawRow);
          for (const candidate of candidates) {
            for (const warning of candidate.warnings) {
              collectedWarnings.push(warning);
            }
          }
          return candidates;
        },
        enrichCandidates: async (
          candidates: readonly (ScheduledEventPayloadV1 | ProtocolIncidentPayloadV1)[],
          rawRow: RawObservationRow
        ) => {
          const enriched = await input.enrichCandidates(
            candidates as readonly ScheduledEventPayloadV1[] | readonly ProtocolIncidentPayloadV1[],
            rawRow,
            context.runId
          );
          for (const e of enriched) {
            if (e.freshness.isStale) {
              collectedWarnings.push("stale_observation");
            }
          }
          return enriched;
        },
        insertNormalized: async (
          enriched: readonly EnrichedContextEventObservation[],
          _candidates: readonly (ScheduledEventPayloadV1 | ProtocolIncidentPayloadV1)[],
          rawRow: RawObservationRow
        ) => {
          return insertNormalizedRows(normalizedObservationRepo, enriched, rawRow, input.source);
        }
      }
    );

    if (ingestResult.rawOutcome.outcome === "identical_replay") {
      return {
        status: "identical_replay",
        rawObservationId: ingestResult.rawObservationId,
        normalizedCount: 0,
        warnings: [],
        diagnostic: null
      };
    }

    const uniqueWarnings = [...new Set(collectedWarnings)];
    const hasWarnings = uniqueWarnings.length > 0;
    const hasStaleOnly =
      uniqueWarnings.length === 1 && uniqueWarnings.includes("stale_observation");

    return {
      status: hasStaleOnly ? "stale" : hasWarnings ? "degraded" : "accepted",
      rawObservationId: ingestResult.rawObservationId,
      normalizedCount: ingestResult.normalizedCount,
      warnings: uniqueWarnings,
      diagnostic: null
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "failed",
      rawObservationId: null,
      normalizedCount: 0,
      warnings: [],
      diagnostic: redactDiagnostic(message)
    };
  }
}

async function insertNormalizedRows(
  normalizedObservationRepo: NormalizedObservationRepo,
  enriched: readonly EnrichedContextEventObservation[],
  rawRow: RawObservationRow,
  source: Source
): Promise<number> {
  const normInserts = enriched.map((e) => {
    const entry = getObservationKindEntry(e.kind);
    return {
      rawObservationId: rawRow.id,
      source,
      observationKind: e.kind,
      signalClass: e.signalClass,
      evidenceFamily: e.evidenceFamily,
      payload: e.payloadCanonical,
      payloadHash: e.payloadHash,
      confidence: e.confidence,
      confidenceComposite: e.confidence.compositeScore,
      confidenceLevel: e.confidence.level,
      validUntilUnixMs: e.freshness.validUntilUnixMs,
      isStale: e.freshness.isStale,
      staleBehavior: entry.freshnessPolicy.staleBehavior,
      provenance: e.provenance,
      receivedAtUnixMs: e.receivedAtUnixMs
    };
  });

  await normalizedObservationRepo.insertMany(normInserts);
  return normInserts.length;
}
