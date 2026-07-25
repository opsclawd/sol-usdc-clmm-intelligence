import type { PerpVenue } from "../contracts/perp-liquidation.js";
import type { PerpLiquidationSourcePort } from "../ports/perp-liquidation-source.js";
import type { RawObservationRepo } from "../ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../ports/normalized-observation-repo.js";
import type { DerivedFeatureRepo } from "../ports/feature-repo.js";
import { createCollectionRunContext } from "../application/create-collection-run-context.js";
import {
  collectPerpLiquidation,
  type PerpLiquidationCollectionResult
} from "../application/collect-perp-liquidation.js";
import type { CollectionRunContext } from "../application/create-collection-run-context.js";
import type { EnvReader } from "../ports/env.js";
import type { Clock } from "../ports/clock.js";
import type { RunIdFactory } from "../ports/run-id.js";
import { redactDiagnostic } from "../application/source-outcome.js";

export type PerpLiquidationSourceKey = PerpVenue;

export interface ConfiguredPerpLiquidationSource {
  readonly source: PerpLiquidationSourceKey;
  readonly adapter: PerpLiquidationSourcePort;
}

export interface PerpLiquidationJobDeps {
  readonly sources: readonly ConfiguredPerpLiquidationSource[];
  readonly rawObservationRepo: RawObservationRepo;
  readonly normalizedObservationRepo: NormalizedObservationRepo;
  readonly derivedFeatureRepo: DerivedFeatureRepo;
  readonly env: EnvReader;
  readonly clock: Clock;
  readonly runIdFactory: RunIdFactory;
  readonly binanceSymbol: string;
  readonly driftMarketIndex: number;
  readonly driftPrecision: {
    readonly pricePrecision: string;
    readonly basePrecision: string;
    readonly quotePrecision: string;
  };
  readonly lookbackMs: number;
}

export type PerpLiquidationJobStatus = "COMPLETE" | "PARTIAL" | "UNAVAILABLE" | "FAILED";

export interface PerpLiquidationSourceOutcome {
  readonly source: PerpLiquidationSourceKey;
  readonly status: PerpLiquidationCollectionResult["status"];
  readonly hasUsableEvidence: boolean;
  readonly rawCount: number;
  readonly normalizedCount: number;
  readonly featureCount: number;
  readonly diagnostic: string | null;
}

export interface PerpLiquidationJobResult {
  readonly context: CollectionRunContext;
  readonly outcomes: readonly PerpLiquidationSourceOutcome[];
  readonly status: PerpLiquidationJobStatus;
  readonly shouldFailCommand: boolean;
}

function isUsableStatus(
  status: PerpLiquidationCollectionResult["status"]
): status is "accepted" | "partial" | "degraded" | "identical_replay" {
  return (
    status === "accepted" ||
    status === "partial" ||
    status === "degraded" ||
    status === "identical_replay"
  );
}

function isUnavailableStatus(
  status: PerpLiquidationCollectionResult["status"]
): status is "timeout" | "network" | "unavailable" {
  return status === "timeout" || status === "network" || status === "unavailable";
}

function mapCollectionResult(
  result: PerpLiquidationCollectionResult,
  source: PerpLiquidationSourceKey
): PerpLiquidationSourceOutcome {
  let diagnostic: string | null = null;
  if (result.coverage) {
    const coverageValues = Object.values(result.coverage);
    const badCoverage = coverageValues.find((c) => c?.diagnostic);
    if (badCoverage?.diagnostic) {
      diagnostic = redactDiagnostic(badCoverage.diagnostic);
    }
  }

  return {
    source,
    status: result.status,
    hasUsableEvidence: isUsableStatus(result.status),
    rawCount: result.rawCount,
    normalizedCount: result.normalizedCount,
    featureCount: result.featureCount,
    diagnostic
  };
}

function reducePerpLiquidationStatus(
  outcomes: readonly PerpLiquidationSourceOutcome[]
): PerpLiquidationJobStatus {
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

export function perpLiquidationJob(
  deps: PerpLiquidationJobDeps
): () => Promise<PerpLiquidationJobResult> {
  return () => runPerpLiquidationJob(deps);
}

export async function runPerpLiquidationJob(
  deps: PerpLiquidationJobDeps
): Promise<PerpLiquidationJobResult> {
  if (!deps.sources || deps.sources.length === 0) {
    throw new Error("At least one perp liquidation source must be configured");
  }

  const sourceNames = deps.sources.map((s) => s.source);
  const uniqueSourceNames = new Set(sourceNames);
  const hasDuplicates = uniqueSourceNames.size !== sourceNames.length;

  const binanceCount = deps.sources.filter((s) => s.source === "binance-fapi").length;
  const driftCount = deps.sources.filter((s) => s.source === "drift-api").length;

  if (deps.sources.length !== 2) {
    throw new Error(
      "Exactly two perp liquidation sources (binance-fapi and drift-api) must be configured"
    );
  }

  if (hasDuplicates) {
    throw new Error("Duplicate perp liquidation source names are not allowed");
  }

  if (binanceCount !== 1) {
    throw new Error("Exactly one binance-fapi source must be configured");
  }

  if (driftCount !== 1) {
    throw new Error("Exactly one drift-api source must be configured");
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
        return await collectPerpLiquidation(
          {
            source: configuredSource.adapter,
            rawObservationRepo: deps.rawObservationRepo,
            normalizedObservationRepo: deps.normalizedObservationRepo,
            derivedFeatureRepo: deps.derivedFeatureRepo
          },
          context,
          {
            venue: configuredSource.source,
            lookbackMs: deps.lookbackMs
          }
        );
      } catch (err: unknown) {
        const diagnosticMsg = err instanceof Error ? err.message : String(err);
        const redactedDiag = redactDiagnostic(diagnosticMsg);
        return {
          venue: configuredSource.source,
          status: "failed" as const,
          rawCount: 0,
          normalizedCount: 0,
          featureCount: 0,
          coverage: {
            funding_rate: {
              kind: "funding_rate" as const,
              status: "unavailable" as const,
              diagnostic: redactedDiag
            },
            open_interest: {
              kind: "open_interest" as const,
              status: "unavailable" as const,
              diagnostic: redactedDiag
            },
            perp_basis: {
              kind: "perp_basis" as const,
              status: "unavailable" as const,
              diagnostic: redactedDiag
            },
            liquidation_event: {
              kind: "liquidation_event" as const,
              status: "unavailable" as const,
              diagnostic: redactedDiag
            },
            leverage_proxy: {
              kind: "leverage_proxy" as const,
              status: "unavailable" as const,
              diagnostic: redactedDiag
            }
          }
        };
      }
    })
  );

  const outcomes = results.map((result, index) =>
    mapCollectionResult(result, sortedSources[index]!.source)
  );

  const status = reducePerpLiquidationStatus(outcomes);

  return {
    context,
    outcomes,
    status,
    shouldFailCommand: status === "FAILED" || status === "UNAVAILABLE"
  };
}
