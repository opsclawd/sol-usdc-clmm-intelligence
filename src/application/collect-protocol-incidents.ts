import type { Source } from "../contracts/taxonomy.js";
import type { ProtocolIncidentSourcePort } from "../ports/protocol-incident-source.js";
import type { CollectionRunContext } from "./create-collection-run-context.js";
import type { EnrichedContextEventObservation } from "../domain/context-events/enrich.js";
import {
  normalizeProtocolIncidents,
  enrichContextEvent,
  deriveContextSnapshotObservationKey
} from "../domain/context-events/index.js";
import { canonicalizePayload } from "../domain/content-hash.js";
import {
  collectContextEvents,
  type CollectContextEventsDeps,
  type ContextEventCollectionResult
} from "./collect-context-events.js";

export interface CollectProtocolIncidentsDeps extends CollectContextEventsDeps {
  incidentSource: ProtocolIncidentSourcePort;
}

const SOURCE: Source = "solana-status-api";

export async function collectProtocolIncidents(
  deps: CollectProtocolIncidentsDeps,
  context: CollectionRunContext
): Promise<ContextEventCollectionResult> {
  const { incidentSource, rawObservationRepo, normalizedObservationRepo } = deps;

  let collectedSnapshot: Awaited<ReturnType<ProtocolIncidentSourcePort["collect"]>> | null = null;

  try {
    collectedSnapshot = await incidentSource.collect({
      network: "solana-mainnet"
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

  if (!collectedSnapshot.incidents || collectedSnapshot.incidents.length === 0) {
    return {
      status: "accepted",
      rawObservationId: null,
      normalizedCount: 0,
      warnings: [],
      diagnostic: null
    };
  }

  const snapshot = collectedSnapshot;

  const boundedSnapshots = snapshot.incidents.map((incident) => ({
    providerId: snapshot.providerId,
    providerSourceEventId: incident.incidentId,
    source: "solana-status-api" as const,
    snapshot: {
      providerId: snapshot.providerId,
      providerSourceEventId: incident.incidentId,
      title: `Incident: ${incident.incidentId}`,
      description: `Protocol incident from ${snapshot.providerId}`,
      detectedAtUnixMs: snapshot.asOfUnixMs,
      resolvedAtUnixMs: null,
      severity: (incident.severity as "CRITICAL" | "HIGH" | "MEDIUM" | "LOW") || "HIGH",
      status: "UNCONFIRMED" as const,
      sourceReferences: [...incident.sourceReferences] as unknown[],
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
    source: "solana-status-api",
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
          normalizeProtocolIncidents(
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
            source: "solana-status-api",
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

  return result;
}
