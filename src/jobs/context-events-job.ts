import type { ScheduledEventSourcePort } from "../ports/scheduled-event-source.js";
import type { ProtocolIncidentSourcePort } from "../ports/protocol-incident-source.js";
import type { RawObservationRepo } from "../ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../ports/normalized-observation-repo.js";
import { createCollectionRunContext } from "../application/create-collection-run-context.js";
import {
  collectScheduledEvents,
  type CollectScheduledEventsDeps
} from "../application/collect-scheduled-events.js";
import {
  collectProtocolIncidents,
  type CollectProtocolIncidentsDeps
} from "../application/collect-protocol-incidents.js";
import type { ContextEventCollectionResult } from "../application/collect-context-events.js";
import type { CollectionRunContext } from "../application/create-collection-run-context.js";
import type { EnvReader } from "../ports/env.js";
import type { Clock } from "../ports/clock.js";
import type { RunIdFactory } from "../ports/run-id.js";

export interface ContextEventsJobDeps {
  readonly scheduledEventSource: ScheduledEventSourcePort;
  readonly protocolIncidentSource: ProtocolIncidentSourcePort;
  readonly rawObservationRepo: RawObservationRepo;
  readonly normalizedObservationRepo: NormalizedObservationRepo;
  readonly env: EnvReader;
  readonly clock: Clock;
  readonly runIdFactory: RunIdFactory;
}

export type ContextEventsJobStatus = "COMPLETE" | "PARTIAL" | "UNAVAILABLE" | "FAILED";

export interface ContextSourceOutcome {
  readonly status: ContextEventCollectionResult["status"];
  readonly hasUsableEvidence: boolean;
  readonly rawObservationId: number | null;
  readonly normalizedCount: number;
  readonly warnings: readonly string[];
  readonly diagnostic: string | null;
}

export interface ContextEventsJobResult {
  readonly context: CollectionRunContext;
  readonly scheduledEvents: ContextSourceOutcome;
  readonly protocolIncidents: ContextSourceOutcome;
  readonly status: ContextEventsJobStatus;
  readonly shouldFailCommand: boolean;
}

function mapCollectionResult(result: ContextEventCollectionResult): ContextSourceOutcome {
  const hasUsableEvidence =
    result.status === "accepted" ||
    result.status === "identical_replay" ||
    result.status === "degraded" ||
    result.status === "stale";

  return {
    status: result.status,
    hasUsableEvidence,
    rawObservationId: result.rawObservationId,
    normalizedCount: result.normalizedCount,
    warnings: result.warnings,
    diagnostic: result.diagnostic
  };
}

function reduceContextEventsStatus(
  scheduledOutcome: ContextSourceOutcome,
  incidentOutcome: ContextSourceOutcome
): ContextEventsJobStatus {
  const hasUsableScheduled =
    scheduledOutcome.hasUsableEvidence && scheduledOutcome.status !== "failed";
  const hasUsableIncidents =
    incidentOutcome.hasUsableEvidence && incidentOutcome.status !== "failed";

  const scheduledAbsent =
    scheduledOutcome.status === "unavailable" ||
    scheduledOutcome.status === "timeout" ||
    scheduledOutcome.status === "network";
  const incidentAbsent =
    incidentOutcome.status === "unavailable" ||
    incidentOutcome.status === "timeout" ||
    incidentOutcome.status === "network";

  const scheduledFailed = scheduledOutcome.status === "failed";
  const incidentFailed = incidentOutcome.status === "failed";

  if (scheduledFailed || incidentFailed) {
    return "FAILED";
  }

  if (hasUsableScheduled && hasUsableIncidents) {
    return "COMPLETE";
  }

  if ((hasUsableScheduled && incidentAbsent) || (hasUsableIncidents && scheduledAbsent)) {
    return "PARTIAL";
  }

  if (scheduledAbsent && incidentAbsent) {
    return "UNAVAILABLE";
  }

  return "UNAVAILABLE";
}

export function contextEventsJob(
  deps: ContextEventsJobDeps
): () => Promise<ContextEventsJobResult> {
  return () => runContextEventsJob(deps);
}

export async function runContextEventsJob(
  deps: ContextEventsJobDeps
): Promise<ContextEventsJobResult> {
  const context = createCollectionRunContext({
    env: deps.env,
    clock: deps.clock,
    runIdFactory: deps.runIdFactory
  });

  const scheduledDeps: CollectScheduledEventsDeps = {
    eventSource: deps.scheduledEventSource,
    rawObservationRepo: deps.rawObservationRepo,
    normalizedObservationRepo: deps.normalizedObservationRepo
  };

  const incidentDeps: CollectProtocolIncidentsDeps = {
    incidentSource: deps.protocolIncidentSource,
    rawObservationRepo: deps.rawObservationRepo,
    normalizedObservationRepo: deps.normalizedObservationRepo
  };

  const scheduledPromise = collectScheduledEvents(scheduledDeps, context).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "failed" as const,
      rawObservationId: null,
      normalizedCount: 0,
      warnings: [] as readonly string[],
      diagnostic: message
    };
  });

  const incidentPromise = collectProtocolIncidents(incidentDeps, context).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "failed" as const,
      rawObservationId: null,
      normalizedCount: 0,
      warnings: [] as readonly string[],
      diagnostic: message
    };
  });

  const [scheduledResult, incidentResult] = await Promise.all([scheduledPromise, incidentPromise]);

  const scheduledOutcome = mapCollectionResult(scheduledResult);
  const incidentOutcome = mapCollectionResult(incidentResult);

  const status = reduceContextEventsStatus(scheduledOutcome, incidentOutcome);

  return {
    context,
    scheduledEvents: scheduledOutcome,
    protocolIncidents: incidentOutcome,
    status,
    shouldFailCommand: status === "FAILED" || status === "UNAVAILABLE"
  };
}
