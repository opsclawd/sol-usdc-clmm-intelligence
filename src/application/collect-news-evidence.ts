import type {
  NewsSourcePort,
  NewsSourceSnapshot,
  BoundedNewsSourceRecord
} from "../ports/news-source.js";
import type { RawObservationRepo } from "../ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../ports/normalized-observation-repo.js";
import type { JsonStore } from "../ports/json-store.js";
import type { CollectionRunContext } from "./create-collection-run-context.js";
import { acceptBoundedNewsRecord } from "../domain/news-events/validate.js";
import { normalizeNewsRecord } from "../domain/news-events/normalize.js";
import { deriveNewsObservationKey } from "../domain/news-events/identity.js";
import { clusterNewsEvidence } from "../domain/news-events/cluster.js";
import { enrichNewsEvidence } from "../domain/news-events/enrich.js";
import { canonicalizePayload } from "../domain/content-hash.js";
import { ingestRawObservation, RawObservationConflictError } from "./ingest-raw-observation.js";
import { redactSecretMentions } from "../domain/redact-secrets.js";
import type { NewsEvidencePayload } from "../contracts/news-events.js";

export type NewsEvidenceCollectionStatus =
  | "accepted"
  | "partial"
  | "degraded"
  | "identical_replay"
  | "timeout"
  | "network"
  | "unavailable"
  | "malformed"
  | "conflict"
  | "failed";

export interface NewsEvidenceCollectionResult {
  readonly source: "crypto-news-api" | "regulatory-monitor-api";
  readonly status: NewsEvidenceCollectionStatus;
  readonly rawObservationIds: readonly number[];
  readonly normalizedCount: number;
  readonly failedArticleIds: readonly string[];
  readonly warnings: readonly string[];
  readonly diagnostic: string | null;
}

export interface CollectNewsEvidenceDeps {
  newsSource: NewsSourcePort;
  rawObservationRepo: RawObservationRepo;
  normalizedObservationRepo: NormalizedObservationRepo;
  jsonStore?: JsonStore;
}

const defaultJsonStore: JsonStore = {
  readJson: async () => undefined,
  writeJson: async () => {}
};

export async function collectNewsEvidence(
  deps: CollectNewsEvidenceDeps,
  context: CollectionRunContext,
  source: "crypto-news-api" | "regulatory-monitor-api"
): Promise<NewsEvidenceCollectionResult> {
  const fromUnixMs = context.startedAtUnixMs - 7 * 86_400_000;
  const toUnixMs = context.startedAtUnixMs;

  let snapshot: NewsSourceSnapshot;
  try {
    snapshot = await deps.newsSource.collect({
      pair: "SOL/USDC",
      source,
      fromUnixMs,
      toUnixMs
    });
  } catch (err: unknown) {
    const diagnosticMsg =
      err && typeof err === "object" && "diagnostic" in err
        ? String((err as { diagnostic: unknown }).diagnostic)
        : err instanceof Error
          ? err.message
          : String(err);
    const redactedDiag = redactSecretMentions(diagnosticMsg);

    const kind =
      err && typeof err === "object" && "kind" in err ? (err as { kind: string }).kind : null;

    if (kind === "timeout") {
      return {
        source,
        status: "timeout",
        rawObservationIds: [],
        normalizedCount: 0,
        failedArticleIds: [],
        warnings: [],
        diagnostic: redactedDiag
      };
    }
    if (kind === "network") {
      return {
        source,
        status: "network",
        rawObservationIds: [],
        normalizedCount: 0,
        failedArticleIds: [],
        warnings: [],
        diagnostic: redactedDiag
      };
    }
    if (kind === "unavailable") {
      return {
        source,
        status: "unavailable",
        rawObservationIds: [],
        normalizedCount: 0,
        failedArticleIds: [],
        warnings: [],
        diagnostic: redactedDiag
      };
    }
    if (kind === "malformed") {
      return {
        source,
        status: "malformed",
        rawObservationIds: [],
        normalizedCount: 0,
        failedArticleIds: [],
        warnings: [],
        diagnostic: redactedDiag
      };
    }
    return {
      source,
      status: "failed",
      rawObservationIds: [],
      normalizedCount: 0,
      failedArticleIds: [],
      warnings: [],
      diagnostic: redactedDiag
    };
  }

  if (snapshot.source !== source) {
    return {
      source,
      status: "malformed",
      rawObservationIds: [],
      normalizedCount: 0,
      failedArticleIds: [],
      warnings: [],
      diagnostic: redactSecretMentions(
        `Source mismatch: requested ${source}, received ${snapshot.source}`
      )
    };
  }

  if (!snapshot.records || snapshot.records.length === 0) {
    return {
      source,
      status: "accepted",
      rawObservationIds: [],
      normalizedCount: 0,
      failedArticleIds: [],
      warnings: [],
      diagnostic: null
    };
  }

  const rawObservationIds: number[] = [];
  let totalNormalizedCount = 0;
  const failedArticleIds: string[] = [];
  const warningsSet = new Set<string>();

  let identicalReplayCount = 0;
  let conflictCount = 0;
  let successCount = 0;

  const sortedRecords = [...snapshot.records].sort((a, b) => {
    const articleCompare = (a.articleId ?? "").localeCompare(b.articleId ?? "");
    if (articleCompare !== 0) return articleCompare;
    return (a.sourceVersionId ?? "").localeCompare(b.sourceVersionId ?? "");
  });

  for (const rec of sortedRecords) {
    let boundedRecord: BoundedNewsSourceRecord;
    try {
      if (
        "rawProvenance" in rec &&
        rec.rawProvenance !== null &&
        typeof rec.rawProvenance === "object"
      ) {
        boundedRecord = rec as BoundedNewsSourceRecord;
        if (
          !boundedRecord.rawProvenance.robotsCompliance ||
          !boundedRecord.rawProvenance.termsAccepted
        ) {
          throw new Error("Robots and terms compliance required for bounded retention");
        }
      } else {
        boundedRecord = acceptBoundedNewsRecord(rec);
      }
    } catch {
      failedArticleIds.push((rec as { articleId?: string }).articleId ?? "unknown");
      continue;
    }

    try {
      const { payloadCanonical, payloadHash } = await canonicalizePayload(boundedRecord);
      const sourceObservationKey = await deriveNewsObservationKey({
        source,
        providerId: boundedRecord.providerId,
        articleId: boundedRecord.articleId,
        sourceVersionId: boundedRecord.sourceVersionId,
        boundedPayloadHash: payloadHash
      });

      const res = await ingestRawObservation(
        {
          rawObservationRepo: deps.rawObservationRepo,
          normalizedObservationRepo: deps.normalizedObservationRepo,
          jsonStore: deps.jsonStore ?? defaultJsonStore
        },
        {
          source,
          sourceObservationKey,
          observedAtUnixMs: boundedRecord.publishedAtUnixMs ?? boundedRecord.retrievedAtUnixMs,
          fetchedAtUnixMs: boundedRecord.retrievedAtUnixMs,
          payloadCanonical,
          payloadHash,
          sourceRequestMeta: { providerRunId: boundedRecord.providerRunId },
          receivedAtUnixMs: context.startedAtUnixMs,
          validatePayload: (canonical) => {
            const parsed = JSON.parse(canonical) as ReturnType<typeof acceptBoundedNewsRecord>;
            return { accepted: parsed };
          },
          buildCandidates: (accepted) => {
            return [normalizeNewsRecord(accepted, context.startedAtUnixMs)];
          },
          enrichCandidates: async (candidates, rawRow) => {
            const sevenDaysAgo = context.startedAtUnixMs - 7 * 86_400_000;
            const historyRows = await deps.normalizedObservationRepo.listCandidates({
              sourceKinds: [
                { source: "crypto-news-api", observationKind: "ecosystem_news" },
                { source: "crypto-news-api", observationKind: "regulatory_risk" },
                { source: "regulatory-monitor-api", observationKind: "ecosystem_news" },
                { source: "regulatory-monitor-api", observationKind: "regulatory_risk" }
              ],
              receivedAtOrAfterUnixMs: sevenDaysAgo
            });

            const historicalPayloads: NewsEvidencePayload[] = [];
            for (const hRow of historyRows) {
              if (hRow.payload && typeof hRow.payload === "object" && "articleId" in hRow.payload) {
                historicalPayloads.push(hRow.payload as NewsEvidencePayload);
              }
            }

            const clustered = await clusterNewsEvidence({
              historical: historicalPayloads,
              incoming: candidates
            });

            const enrichedList = [];
            for (const candidatePayload of candidates) {
              const matched = clustered.find(
                (c) =>
                  c.articleId === candidatePayload.articleId &&
                  c.sourceVersionId === candidatePayload.sourceVersionId
              ) ?? {
                ...candidatePayload,
                clusterId: "",
                corroborationState: "single_source" as const,
                warnings: candidatePayload.warnings
              };

              const enriched = await enrichNewsEvidence({
                payload: matched as NewsEvidencePayload,
                source,
                rawId: rawRow.id,
                nowMs: context.startedAtUnixMs,
                codeVersion: "news-evidence-v1",
                runId: context.runId
              });
              enrichedList.push(enriched);
            }
            return enrichedList;
          },
          insertNormalized: async (enriched, _candidates, rawRow) => {
            const inserts = enriched.map((item) => {
              for (const w of item.payload.warnings) {
                warningsSet.add(w);
              }
              return {
                rawObservationId: rawRow.id,
                source,
                observationKind: item.payload.evidenceKind,
                signalClass: "contextual" as const,
                evidenceFamily: "news_evidence" as const,
                payload: item.payload,
                payloadHash: item.payloadHash,
                confidence: item.confidence,
                confidenceComposite: item.confidence.compositeScore,
                confidenceLevel: item.confidence.level,
                validUntilUnixMs: item.freshness.validUntilUnixMs,
                isStale: item.freshness.isStale,
                staleBehavior: "allow_context_only" as const,
                provenance: item.provenance,
                receivedAtUnixMs: context.startedAtUnixMs
              };
            });

            const inserted = await deps.normalizedObservationRepo.insertMany(inserts);
            return inserted.length;
          }
        }
      );

      if (!rawObservationIds.includes(res.rawObservationId)) {
        rawObservationIds.push(res.rawObservationId);
      }
      totalNormalizedCount += res.normalizedCount;

      if (res.rawOutcome.outcome === "identical_replay") {
        identicalReplayCount++;
      } else {
        successCount++;
      }
    } catch (err) {
      if (err instanceof RawObservationConflictError) {
        conflictCount++;
      }
      failedArticleIds.push(rec.articleId);
    }
  }

  let finalStatus: NewsEvidenceCollectionStatus;
  if (failedArticleIds.length > 0) {
    if (successCount > 0 || identicalReplayCount > 0) {
      finalStatus = "partial";
    } else if (conflictCount > 0) {
      finalStatus = "conflict";
    } else {
      finalStatus = "failed";
    }
  } else if (identicalReplayCount > 0 && successCount === 0) {
    finalStatus = "identical_replay";
  } else {
    finalStatus = "accepted";
  }

  return {
    source,
    status: finalStatus,
    rawObservationIds,
    normalizedCount: totalNormalizedCount,
    failedArticleIds,
    warnings: Array.from(warningsSet).sort(),
    diagnostic: null
  };
}
