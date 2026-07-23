import type { Source } from "../contracts/taxonomy.js";
import type { ScheduledEventSourcePort } from "../ports/scheduled-event-source.js";
import type { CollectionRunContext } from "./create-collection-run-context.js";
import type { EnrichedContextEventObservation } from "../domain/context-events/enrich.js";
import {
  normalizeScheduledEvents,
  enrichContextEvent,
  deriveContextSnapshotObservationKey
} from "../domain/context-events/index.js";
import { canonicalizePayload } from "../domain/content-hash.js";
import {
  collectContextEvents,
  type CollectContextEventsDeps,
  type ContextEventCollectionResult
} from "./collect-context-events.js";

export interface CollectScheduledEventsDeps extends CollectContextEventsDeps {
  eventSource: ScheduledEventSourcePort;
}

const SOURCE: Source = "macro-calendar-api";

export async function collectScheduledEvents(
  deps: CollectScheduledEventsDeps,
  context: CollectionRunContext
): Promise<ContextEventCollectionResult> {
  const { eventSource, rawObservationRepo, normalizedObservationRepo } = deps;

  const nowMs = context.startedAtUnixMs;
  const fromUnixMs = nowMs - 86400000;
  const toUnixMs = nowMs + 86400000;

  let collectedSnapshot: Awaited<ReturnType<ScheduledEventSourcePort["collect"]>> | null = null;

  try {
    collectedSnapshot = await eventSource.collect({
      pair: "SOL/USDC",
      fromUnixMs,
      toUnixMs
    });
  } catch (err) {
    if (err && typeof err === "object" && "kind" in err) {
      const errorKind = (err as { kind: string }).kind;
      if (errorKind === "timeout") {
        return {
          status: "timeout",
          rawObservationId: null,
          normalizedCount: 0,
          warnings: [],
          diagnostic: (err as { diagnostic?: string }).diagnostic ?? "timeout"
        };
      }
      if (errorKind === "network") {
        return {
          status: "network",
          rawObservationId: null,
          normalizedCount: 0,
          warnings: [],
          diagnostic: (err as { diagnostic?: string }).diagnostic ?? "network error"
        };
      }
      if (errorKind === "unavailable") {
        return {
          status: "unavailable",
          rawObservationId: null,
          normalizedCount: 0,
          warnings: [],
          diagnostic: (err as { diagnostic?: string }).diagnostic ?? "unavailable"
        };
      }
      if (errorKind === "malformed") {
        return {
          status: "malformed",
          rawObservationId: null,
          normalizedCount: 0,
          warnings: [],
          diagnostic: (err as { diagnostic?: string }).diagnostic ?? "malformed"
        };
      }
    }
    return {
      status: "failed",
      rawObservationId: null,
      normalizedCount: 0,
      warnings: [],
      diagnostic: err instanceof Error ? err.message : String(err)
    };
  }

  if (!collectedSnapshot.events || collectedSnapshot.events.length === 0) {
    return {
      status: "accepted",
      rawObservationId: null,
      normalizedCount: 0,
      warnings: [],
      diagnostic: null
    };
  }

  const snapshot = collectedSnapshot;

  const boundedSnapshots = snapshot.events.map((event) => ({
    providerId: snapshot.providerId,
    providerSourceEventId: event.eventId,
    source: "macro-calendar-api" as const,
    snapshot: {
      providerId: snapshot.providerId,
      providerSourceEventId: event.eventId,
      title: `Event: ${event.eventId}`,
      description: `Scheduled event from ${snapshot.providerId}`,
      scheduledStartUnixMs: event.scheduledUnixMs,
      scheduledEndUnixMs: null,
      severity: "MEDIUM" as const,
      status: "SCHEDULED" as const,
      sourceReferences: [...event.sourceReferences] as unknown[],
      affectedScope: ["SOL/USDC"],
      sourceQuality: {
        providerId: snapshot.providerId,
        reliability: 0.85,
        completeness: "complete" as const,
        confirmation: "primary" as const
      },
      sourceObservedAtUnixMs: snapshot.asOfUnixMs
    },
    sourceObservedAtUnixMs: snapshot.asOfUnixMs,
    retrievedAtUnixMs: context.startedAtUnixMs
  }));

  const stablePayloads = boundedSnapshots.map((bounded) => ({
    providerId: bounded.providerId,
    providerSourceEventId: bounded.providerSourceEventId,
    source: bounded.source,
    snapshot: bounded.snapshot,
    sourceObservedAtUnixMs: bounded.sourceObservedAtUnixMs
  }));

  const payloadCanonical = JSON.stringify(stablePayloads);
  const { payloadHash } = await canonicalizePayload(stablePayloads);

  const sourceObservationKey = await deriveContextSnapshotObservationKey({
    source: "macro-calendar-api",
    providerId: snapshot.providerId,
    sourceObservedAtUnixMs: snapshot.asOfUnixMs,
    payloadHash
  });

  const result = await collectContextEvents(
    { rawObservationRepo, normalizedObservationRepo },
    context,
    {
      source: SOURCE,
      sourceObservationKey,
      observedAtUnixMs: snapshot.asOfUnixMs,
      fetchedAtUnixMs: context.startedAtUnixMs,
      payloadCanonical,
      payloadHash,
      buildCandidates: () => {
        return stablePayloads.flatMap((bounded) =>
          normalizeScheduledEvents(
            {
              ...bounded,
              payloadHash: "",
              retrievedAtUnixMs: context.startedAtUnixMs
            },
            context.startedAtUnixMs,
            context.startedAtUnixMs
          )
        );
      },
      enrichCandidates: async (candidates, rawRow) => {
        const enriched: EnrichedContextEventObservation[] = [];
        for (const candidate of candidates) {
          const e = await enrichContextEvent({
            payload: candidate,
            source: "macro-calendar-api",
            rawId: rawRow.id,
            nowMs: context.startedAtUnixMs,
            codeVersion: "context-events-v1",
            runId: context.runId
          });
          enriched.push(e);
        }
        return enriched;
      }
    }
  );

  if (result.status === "degraded") {
    return result;
  }
  return result;
}
