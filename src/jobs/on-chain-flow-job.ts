import type { OnChainFlowSourcePort } from "../ports/on-chain-flow-source.js";
import type { RawObservationRepo } from "../ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../ports/normalized-observation-repo.js";
import { createCollectionRunContext } from "../application/create-collection-run-context.js";
import {
  collectOnChainFlow,
  type OnChainFlowCollectionResult
} from "../application/collect-on-chain-flow.js";
import type { CollectionRunContext } from "../application/create-collection-run-context.js";
import type { EnvReader } from "../ports/env.js";
import type { Clock } from "../ports/clock.js";
import type { RunIdFactory } from "../ports/run-id.js";
import { redactDiagnostic } from "../application/source-outcome.js";
import type { OnChainFlowThresholds } from "../contracts/on-chain-flow.js";

export type OnChainFlowSourceKey = "helius-api" | "birdeye-api";

export interface ConfiguredOnChainFlowSource {
  readonly source: OnChainFlowSourceKey;
  readonly adapter: OnChainFlowSourcePort;
}

export interface OnChainFlowJobDeps {
  readonly sources: readonly ConfiguredOnChainFlowSource[];
  readonly rawObservationRepo: RawObservationRepo;
  readonly normalizedObservationRepo: NormalizedObservationRepo;
  readonly env: EnvReader;
  readonly clock: Clock;
  readonly runIdFactory: RunIdFactory;
  readonly thresholds: OnChainFlowThresholds;
  readonly lookbackMs: number;
}

export type OnChainFlowJobStatus = "COMPLETE" | "PARTIAL" | "UNAVAILABLE" | "FAILED";

export interface OnChainFlowSourceOutcome {
  readonly source: OnChainFlowSourceKey;
  readonly status: OnChainFlowCollectionResult["status"];
  readonly hasUsableEvidence: boolean;
  readonly accepted: number;
  readonly filtered: number;
  readonly replayed: number;
  readonly failed: number;
  readonly conflict: number;
  readonly sourceObservationId: number | null;
  readonly sourceObservationKey: string | null;
  readonly diagnostic: string | null;
}

export interface OnChainFlowJobResult {
  readonly context: CollectionRunContext;
  readonly outcomes: readonly OnChainFlowSourceOutcome[];
  readonly status: OnChainFlowJobStatus;
  readonly shouldFailCommand: boolean;
}

function isUsableStatus(
  status: OnChainFlowCollectionResult["status"]
): status is "accepted" | "partial" | "degraded" | "identical_replay" {
  return (
    status === "accepted" ||
    status === "partial" ||
    status === "degraded" ||
    status === "identical_replay"
  );
}

function isUnavailableStatus(
  status: OnChainFlowCollectionResult["status"]
): status is "timeout" | "network" | "unavailable" {
  return status === "timeout" || status === "network" || status === "unavailable";
}

function mapCollectionResult(
  result: OnChainFlowCollectionResult,
  source: OnChainFlowSourceKey
): OnChainFlowSourceOutcome {
  let diagnostic: string | null = null;
  if (result.results.length > 0) {
    const failedResult = result.results.find((r) => r.outcome === "failed");
    if (failedResult) {
      diagnostic = failedResult.diagnostic;
    }
  }
  return {
    source,
    status: result.status,
    hasUsableEvidence: isUsableStatus(result.status),
    accepted: result.accepted,
    filtered: result.filtered,
    replayed: result.replayed,
    failed: result.failed,
    conflict: result.conflict,
    sourceObservationId: result.sourceObservationId,
    sourceObservationKey: result.sourceObservationKey,
    diagnostic
  };
}

function reduceOnChainFlowStatus(
  outcomes: readonly OnChainFlowSourceOutcome[]
): OnChainFlowJobStatus {
  let usableCount = 0;
  let nonUsableCount = 0;
  let unavailableCount = 0;

  for (const outcome of outcomes) {
    if (isUsableStatus(outcome.status)) {
      usableCount++;
    } else if (isUnavailableStatus(outcome.status)) {
      unavailableCount++;
      nonUsableCount++;
    } else {
      nonUsableCount++;
    }
  }

  if (usableCount === outcomes.length) {
    return "COMPLETE";
  }

  if (usableCount > 0 && nonUsableCount > 0) {
    return "PARTIAL";
  }

  if (unavailableCount === outcomes.length) {
    return "UNAVAILABLE";
  }

  return "FAILED";
}

export function onChainFlowJob(deps: OnChainFlowJobDeps): () => Promise<OnChainFlowJobResult> {
  return () => runOnChainFlowJob(deps);
}

export async function runOnChainFlowJob(deps: OnChainFlowJobDeps): Promise<OnChainFlowJobResult> {
  if (!deps.sources || deps.sources.length === 0) {
    throw new Error("At least one on-chain flow source must be configured");
  }

  const sourceNames = deps.sources.map((s) => s.source);
  const uniqueSourceNames = new Set(sourceNames);
  const hasDuplicates = uniqueSourceNames.size !== sourceNames.length;

  const heliusCount = deps.sources.filter((s) => s.source === "helius-api").length;
  const birdeyeCount = deps.sources.filter((s) => s.source === "birdeye-api").length;

  if (deps.sources.length !== 2) {
    throw new Error(
      "Exactly two on-chain flow sources (helius-api and birdeye-api) must be configured"
    );
  }

  if (hasDuplicates) {
    throw new Error("Duplicate on-chain flow source names are not allowed");
  }

  if (heliusCount !== 1) {
    throw new Error("Exactly one helius-api source must be configured");
  }

  if (birdeyeCount !== 1) {
    throw new Error("Exactly one birdeye-api source must be configured");
  }

  const context = createCollectionRunContext({
    env: deps.env,
    clock: deps.clock,
    runIdFactory: deps.runIdFactory
  });

  const sortedSources = [...deps.sources].sort((a, b) => a.source.localeCompare(b.source));

  const results = await Promise.all(
    sortedSources.map(async (configuredSource) => {
      try {
        return await collectOnChainFlow(
          {
            source: configuredSource.adapter,
            rawObservationRepo: deps.rawObservationRepo,
            normalizedObservationRepo: deps.normalizedObservationRepo
          },
          context,
          {
            source: configuredSource.source,
            thresholds: deps.thresholds,
            lookbackMs: deps.lookbackMs
          }
        );
      } catch (err: unknown) {
        const diagnosticMsg = err instanceof Error ? err.message : String(err);
        const redactedDiag = redactDiagnostic(diagnosticMsg);
        return {
          status: "failed" as const,
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
              diagnostic: redactedDiag
            }
          ]
        };
      }
    })
  );

  const outcomes = results.map((result, index) =>
    mapCollectionResult(result, sortedSources[index]!.source)
  );

  const status = reduceOnChainFlowStatus(outcomes);

  return {
    context,
    outcomes,
    status,
    shouldFailCommand: status === "FAILED" || status === "UNAVAILABLE"
  };
}
