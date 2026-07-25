import type { Source } from "../contracts/taxonomy.js";
import type {
  PerpVenue,
  PerpObservationKind,
  PerpObservationPayloadV1
} from "../contracts/perp-liquidation.js";
import type {
  PerpLiquidationSourcePort,
  PerpLiquidationSourceRequest,
  PerpLiquidationSourceSnapshot,
  PerpLiquidationSourceFact,
  PerpMetricCoverage
} from "../ports/perp-liquidation-source.js";
import type { RawObservationRepo } from "../ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../ports/normalized-observation-repo.js";
import type { DerivedFeatureRepo } from "../ports/feature-repo.js";
import type { CollectionRunContext } from "../contracts/collection-run.js";
import {
  validatePerpObservation,
  normalizePerpObservation,
  derivePerpObservationKey,
  enrichPerpObservation,
  derivePerpLiquidationFeatures
} from "../domain/perp-liquidation/index.js";
import { canonicalizePayload } from "../domain/content-hash.js";
import { getObservationKindEntry } from "../domain/taxonomy/registry.js";
import type { NormalizedObservationRow } from "../contracts/normalized-observation.js";

export type PerpLiquidationCollectionStatus =
  | "accepted"
  | "partial"
  | "degraded"
  | "identical_replay"
  | "malformed"
  | "timeout"
  | "network"
  | "unavailable"
  | "failed";

export interface PerpLiquidationCollectionResult {
  readonly venue: PerpVenue;
  readonly status: PerpLiquidationCollectionStatus;
  readonly rawCount: number;
  readonly normalizedCount: number;
  readonly featureCount: number;
  readonly coverage: Readonly<Record<PerpObservationKind, PerpMetricCoverage>>;
}

export interface CollectPerpLiquidationDeps {
  readonly source: PerpLiquidationSourcePort;
  readonly rawObservationRepo: RawObservationRepo;
  readonly normalizedObservationRepo: NormalizedObservationRepo;
  readonly derivedFeatureRepo: DerivedFeatureRepo;
}

export interface CollectPerpLiquidationInput {
  readonly venue: PerpVenue;
  readonly lookbackMs: number;
}

function mapSourceErrorToStatus(error: unknown): {
  status: PerpLiquidationCollectionStatus;
  diagnostic: string;
} {
  if (error && typeof error === "object" && "code" in error) {
    const err = error as { code: string; message?: string };
    switch (err.code) {
      case "timeout":
        return { status: "timeout", diagnostic: err.message ?? "timeout" };
      case "network":
        return { status: "network", diagnostic: err.message ?? "network error" };
      case "unavailable":
        return { status: "unavailable", diagnostic: err.message ?? "unavailable" };
      case "malformed":
        return { status: "malformed", diagnostic: err.message ?? "malformed" };
    }
  }
  if (error instanceof Error) {
    return { status: "failed", diagnostic: error.message };
  }
  return { status: "failed", diagnostic: "unknown error" };
}

function sortFactsByIdentity(
  facts: readonly PerpLiquidationSourceFact[]
): PerpLiquidationSourceFact[] {
  return [...facts].sort((a, b) => {
    const aKey = `${a.venue}:${a.kind}:${a.payload?.instrument ?? ""}:${a.payload?.observedAtUnixMs ?? 0}:${a.payload?.sourceEventId ?? ""}`;
    const bKey = `${b.venue}:${b.kind}:${b.payload?.instrument ?? ""}:${b.payload?.observedAtUnixMs ?? 0}:${b.payload?.sourceEventId ?? ""}`;
    return aKey.localeCompare(bKey);
  });
}

const ALL_PERP_OBSERVATION_KINDS: readonly PerpObservationKind[] = [
  "funding_rate",
  "open_interest",
  "perp_basis",
  "liquidation_event",
  "leverage_proxy"
];

export async function collectPerpLiquidation(
  deps: CollectPerpLiquidationDeps,
  context: CollectionRunContext,
  input: CollectPerpLiquidationInput
): Promise<PerpLiquidationCollectionResult> {
  const { source, rawObservationRepo, normalizedObservationRepo, derivedFeatureRepo } = deps;
  const { venue, lookbackMs } = input;

  const toUnixMs = context.startedAtUnixMs;
  const fromUnixMs = toUnixMs - lookbackMs;

  let snapshot: PerpLiquidationSourceSnapshot;
  try {
    const request: PerpLiquidationSourceRequest = {
      pair: "SOL/USDC",
      fromUnixMs,
      toUnixMs
    };
    snapshot = await source.collect(request);
  } catch (err) {
    const { status } = mapSourceErrorToStatus(err);
    const emptyCoverage = ALL_PERP_OBSERVATION_KINDS.reduce(
      (acc, k) => {
        acc[k] = { kind: k, status: "unavailable", diagnostic: "fetch_failed" };
        return acc;
      },
      {} as Record<PerpObservationKind, PerpMetricCoverage>
    );

    return {
      venue,
      status,
      rawCount: 0,
      normalizedCount: 0,
      featureCount: 0,
      coverage: emptyCoverage
    };
  }

  const coverage = snapshot.coverage;
  const sortedFacts = sortFactsByIdentity(snapshot.facts);

  let rawCount = 0;
  let normalizedCount = 0;
  let hasStale = false;
  let malformedCount = 0;
  let conflictCount = 0;
  let replayCount = 0;
  let validProcessedCount = 0;

  const snapshotNormalizedCandidates: NormalizedObservationRow[] = [];

  for (const fact of sortedFacts) {
    let payload: PerpObservationPayloadV1;
    try {
      const validated = validatePerpObservation(fact.payload);
      payload = normalizePerpObservation(validated);
    } catch {
      malformedCount++;
      continue;
    }

    const sourceObservationKey = await derivePerpObservationKey(payload, snapshot.providerRunId);
    const { payloadCanonical, payloadHash } = await canonicalizePayload(payload);
    const receivedAtUnixMs = context.startedAtUnixMs;
    const fetchedAtUnixMs = snapshot.asOfUnixMs;

    try {
      const rawInsertResult = await rawObservationRepo.insertOrClassify({
        source: venue as Source,
        sourceObservationKey,
        observedAtUnixMs: payload.observedAtUnixMs,
        fetchedAtUnixMs,
        payloadHash,
        payloadCanonical,
        parseStatus: "pending",
        receivedAtUnixMs
      });

      if (rawInsertResult.outcome === "identical_replay") {
        if (rawInsertResult.row.parseStatus !== "pending") {
          replayCount++;
          rawCount++;
          const existingRawRow = rawInsertResult.row;
          // Reuse persisted normalized candidate
          const existingNorm = await normalizedObservationRepo.findByRawObservation(
            existingRawRow.id,
            payload.kind
          );
          if (existingNorm) {
            snapshotNormalizedCandidates.push(existingNorm);
          }
          continue;
        }
      }

      if (rawInsertResult.outcome === "conflict") {
        conflictCount++;
        continue;
      }

      const rawRow = rawInsertResult.row;

      // New insert (outcome === 'inserted') OR existing raw row with parseStatus === 'pending'
      if (rawInsertResult.outcome === "inserted" || rawRow.parseStatus === "pending") {
        try {
          const enriched = await enrichPerpObservation({
            rawObservationId: rawRow.id,
            source: venue as Source,
            payload,
            observedAtUnixMs: payload.observedAtUnixMs,
            fetchedAtUnixMs,
            receivedAtUnixMs,
            nowMs: receivedAtUnixMs,
            codeVersion: "perp-liquidation-v1",
            runId: context.runId
          });

          if (enriched.freshness.isStale) {
            hasStale = true;
          }

          const entry = getObservationKindEntry(enriched.observationKind);
          const normInsert = {
            rawObservationId: rawRow.id,
            source: venue as Source,
            observationKind: enriched.observationKind,
            signalClass: enriched.signalClass,
            evidenceFamily: enriched.evidenceFamily,
            payload: enriched.payload,
            payloadHash: enriched.payloadHash,
            confidence: enriched.confidence,
            confidenceComposite: enriched.confidence.compositeScore,
            confidenceLevel: enriched.confidence.level,
            validUntilUnixMs: enriched.validUntilUnixMs,
            isStale: enriched.isStale,
            staleBehavior: entry.freshnessPolicy.staleBehavior,
            provenance: enriched.provenance,
            receivedAtUnixMs
          };

          const insertedNorm = await normalizedObservationRepo.insert(normInsert);
          await rawObservationRepo.updateParseStatus(rawRow.id, "parsed");

          rawCount++;
          normalizedCount++;
          validProcessedCount++;
          snapshotNormalizedCandidates.push(insertedNorm);
        } catch (err) {
          await rawObservationRepo.updateParseStatus(rawRow.id, "failed");
          malformedCount++;
        }
      }
    } catch {
      malformedCount++;
    }
  }

  // Derive features from current snapshot's normalized candidates
  const coverageList = Object.values(coverage);
  const derivedFeatures = await derivePerpLiquidationFeatures({
    candidates: snapshotNormalizedCandidates,
    coverage: coverageList,
    evaluationAsOfUnixMs: snapshot.asOfUnixMs,
    runId: context.runId,
    codeVersion: "perp-liquidation-v1"
  });

  const insertedFeatures = await derivedFeatureRepo.insertMany(derivedFeatures);
  const featureCount = insertedFeatures.length;

  // Determine Overall Status
  let status: PerpLiquidationCollectionStatus = "accepted";

  const hasUnavailableCoverage = ALL_PERP_OBSERVATION_KINDS.some((kind) => {
    const record = coverage[kind];
    // If a fact for this kind was provided in the snapshot or coverage is required, check if unavailable
    // Leverage proxy is often not supported/unavailable by design, so check if any provided fact or available coverage is degraded
    return record && record.status === "unavailable" && record.diagnostic !== "not_supported";
  });

  if (malformedCount > 0 && validProcessedCount > 0) {
    status = "partial";
  } else if (conflictCount > 0 || (malformedCount > 0 && validProcessedCount === 0)) {
    status = "failed";
  } else if (
    validProcessedCount === 0 &&
    replayCount > 0 &&
    conflictCount === 0 &&
    malformedCount === 0
  ) {
    status = "identical_replay";
  } else if (hasStale || hasUnavailableCoverage) {
    status = "degraded";
  } else if (sortedFacts.length === 0) {
    status = "degraded";
  }

  return {
    venue,
    status,
    rawCount,
    normalizedCount,
    featureCount,
    coverage
  };
}
