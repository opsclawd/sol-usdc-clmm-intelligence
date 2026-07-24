import type { NewsSourcePort } from "../ports/news-source.js";
import type { RawObservationRepo } from "../ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../ports/normalized-observation-repo.js";
import { createCollectionRunContext } from "../application/create-collection-run-context.js";
import {
  collectNewsEvidence,
  type NewsEvidenceCollectionResult
} from "../application/collect-news-evidence.js";
import type { CollectionRunContext } from "../application/create-collection-run-context.js";
import type { EnvReader } from "../ports/env.js";
import type { Clock } from "../ports/clock.js";
import type { RunIdFactory } from "../ports/run-id.js";
import { redactSecretMentions } from "../domain/redact-secrets.js";

export type NewsSourceKey = "crypto-news-api" | "regulatory-monitor-api";

export interface ConfiguredNewsSource {
  readonly source: NewsSourceKey;
  readonly adapter: NewsSourcePort;
}

export interface NewsEvidenceJobDeps {
  readonly sources: readonly ConfiguredNewsSource[];
  readonly rawObservationRepo: RawObservationRepo;
  readonly normalizedObservationRepo: NormalizedObservationRepo;
  readonly env: EnvReader;
  readonly clock: Clock;
  readonly runIdFactory: RunIdFactory;
}

export type NewsEvidenceJobStatus = "COMPLETE" | "PARTIAL" | "UNAVAILABLE" | "FAILED";

export interface NewsSourceOutcome {
  readonly source: NewsSourceKey;
  readonly status: NewsEvidenceCollectionResult["status"];
  readonly hasUsableEvidence: boolean;
  readonly rawObservationIds: readonly number[];
  readonly normalizedCount: number;
  readonly failedArticleIds: readonly string[];
  readonly warnings: readonly string[];
  readonly diagnostic: string | null;
}

export interface NewsEvidenceJobResult {
  readonly context: CollectionRunContext;
  readonly outcomes: readonly NewsSourceOutcome[];
  readonly status: NewsEvidenceJobStatus;
  readonly shouldFailCommand: boolean;
}

function isUsableStatus(
  status: NewsEvidenceCollectionResult["status"]
): status is "accepted" | "partial" | "degraded" | "identical_replay" {
  return (
    status === "accepted" ||
    status === "partial" ||
    status === "degraded" ||
    status === "identical_replay"
  );
}

function mapCollectionResult(result: NewsEvidenceCollectionResult): NewsSourceOutcome {
  return {
    source: result.source,
    status: result.status,
    hasUsableEvidence: isUsableStatus(result.status),
    rawObservationIds: result.rawObservationIds,
    normalizedCount: result.normalizedCount,
    failedArticleIds: result.failedArticleIds,
    warnings: result.warnings,
    diagnostic: result.diagnostic
  };
}

function reduceNewsEvidenceStatus(outcomes: readonly NewsSourceOutcome[]): NewsEvidenceJobStatus {
  let usableCount = 0;
  let nonUsableCount = 0;
  let unavailableCount = 0;

  for (const outcome of outcomes) {
    if (isUsableStatus(outcome.status)) {
      usableCount++;
    } else if (
      outcome.status === "timeout" ||
      outcome.status === "network" ||
      outcome.status === "unavailable"
    ) {
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

export function newsEvidenceJob(deps: NewsEvidenceJobDeps): () => Promise<NewsEvidenceJobResult> {
  return () => runNewsEvidenceJob(deps);
}

export async function runNewsEvidenceJob(
  deps: NewsEvidenceJobDeps
): Promise<NewsEvidenceJobResult> {
  if (!deps.sources || deps.sources.length === 0) {
    throw new Error("At least one news source must be configured");
  }

  const sourceNames = deps.sources.map((s) => s.source);
  const uniqueSourceNames = new Set(sourceNames);
  if (uniqueSourceNames.size !== sourceNames.length) {
    throw new Error("Duplicate news source names are not allowed");
  }

  const context = createCollectionRunContext({
    env: deps.env,
    clock: deps.clock,
    runIdFactory: deps.runIdFactory
  });

  const collectPromises = deps.sources.map((configuredSource) => {
    return collectNewsEvidence(
      {
        newsSource: configuredSource.adapter,
        rawObservationRepo: deps.rawObservationRepo,
        normalizedObservationRepo: deps.normalizedObservationRepo
      },
      context,
      configuredSource.source
    ).catch((err: unknown) => {
      const diagnosticMsg = err instanceof Error ? err.message : String(err);
      const redactedDiag = redactSecretMentions(diagnosticMsg);
      return {
        source: configuredSource.source,
        status: "failed" as const,
        rawObservationIds: [] as readonly number[],
        normalizedCount: 0,
        failedArticleIds: [] as readonly string[],
        warnings: [] as readonly string[],
        diagnostic: redactedDiag
      };
    });
  });

  const results = await Promise.all(collectPromises);

  const orderedResults: NewsEvidenceCollectionResult[] = deps.sources.map((configuredSource) => {
    return results.find((r) => r.source === configuredSource.source) ?? results[0]!;
  });

  const outcomes = orderedResults.map(mapCollectionResult);

  const status = reduceNewsEvidenceStatus(outcomes);

  return {
    context,
    outcomes,
    status,
    shouldFailCommand: status === "FAILED" || status === "UNAVAILABLE"
  };
}
