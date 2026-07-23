import type { SupportResistanceSourcePort } from "../ports/support-resistance-source.js";
import type { RawObservationRepo } from "../ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../ports/normalized-observation-repo.js";
import type { Source } from "../contracts/taxonomy.js";
import type {
  SupportResistanceCollectionResult,
  SupportResistanceWarning
} from "../contracts/support-resistance.js";
import type { SupportResistancePayloadV1 } from "../contracts/support-resistance.js";
import type {
  SupportResistanceSourceSnapshot,
  SupportResistanceSourceError
} from "../ports/support-resistance-source.js";
import type { CollectionRunContext } from "./create-collection-run-context.js";
import type {
  BoundedSupportResistanceSnapshot,
  BoundedSupportResistanceClaim
} from "../domain/support-resistance/validate.js";
import { acceptSupportResistanceSnapshot } from "../domain/support-resistance/validate.js";
import { normalizeSupportResistanceClaims } from "../domain/support-resistance/normalize.js";
import { enrichSupportResistanceClaim } from "../domain/support-resistance/enrich.js";
import { deriveSupportResistanceSourceObservationKey } from "../domain/support-resistance/identity.js";
import { canonicalizePayload } from "../domain/content-hash.js";
import { getObservationKindEntry } from "../domain/taxonomy/registry.js";
import {
  ingestRawObservation,
  RawObservationConflictError,
  type IngestRawObservationDeps
} from "./ingest-raw-observation.js";

export interface CollectSupportResistanceDeps {
  supportResistanceSource: SupportResistanceSourcePort;
  rawObservationRepo: RawObservationRepo;
  normalizedObservationRepo: NormalizedObservationRepo;
}

const SOURCE: Source = "technical-analysis-api";

interface RedactedRequestMeta {
  providerId: string;
  providerRunId: string;
  pair: "SOL/USDC";
  intelligenceCodeVersion: string | null;
  intelligencePipelineRunId: string | null;
}

function isSourceError(error: unknown): error is SupportResistanceSourceError {
  if (typeof error !== "object" || error === null) return false;
  const e = error as Record<string, unknown>;
  return (
    e.kind === "timeout" ||
    e.kind === "network" ||
    e.kind === "unavailable" ||
    e.kind === "malformed"
  );
}

function makeEmptyFreshness(): SupportResistanceCollectionResult["freshness"] {
  return {
    isStale: false,
    validUntilUnixMs: 0,
    derivedAt: Date.now(),
    policyKind: "support_resistance_level",
    reasons: []
  };
}

function makeEmptyConfidence(): SupportResistanceCollectionResult["confidence"] {
  return {
    components: {
      sourceReliability: 0,
      dataCompleteness: 0,
      derivationConfidence: 0,
      llmConfidence: null
    },
    compositeScore: 0,
    level: "low",
    weightingVersion: "v1",
    reasons: []
  };
}

function mapErrorToResult(error: SupportResistanceSourceError): SupportResistanceCollectionResult {
  return {
    status: error.kind,
    hasUsableEvidence: false,
    rawId: null,
    rawCount: 0,
    warnings: [],
    freshness: makeEmptyFreshness(),
    confidence: makeEmptyConfidence(),
    diagnostic: error.diagnostic
  };
}

function transformPortToBoundedSnapshot(
  snapshot: SupportResistanceSourceSnapshot
): BoundedSupportResistanceSnapshot {
  const allSourceRefs = new Set<string>();
  for (const claim of snapshot.claims) {
    for (const ref of claim.sourceReferences) {
      allSourceRefs.add(ref);
    }
  }

  const boundedClaims: BoundedSupportResistanceClaim[] = snapshot.claims.map((claim) => {
    const result: BoundedSupportResistanceClaim = {
      evidenceSide: claim.evidenceSide
    };
    if (claim.levelUsdcPerSol !== undefined) {
      result.levelUsdcPerSol = claim.levelUsdcPerSol;
    }
    if (claim.zoneLowerUsdcPerSol !== undefined) {
      result.zoneLowerUsdcPerSol = claim.zoneLowerUsdcPerSol;
    }
    if (claim.zoneUpperUsdcPerSol !== undefined) {
      result.zoneUpperUsdcPerSol = claim.zoneUpperUsdcPerSol;
    }
    return result;
  });

  return {
    providerId: snapshot.providerId,
    providerRunId: snapshot.providerRunId,
    pair: snapshot.pair,
    asOfUnixMs: snapshot.asOfUnixMs,
    sourceReferences: [...allSourceRefs],
    claims: boundedClaims,
    sourceReliability: 1.0
  };
}

export async function collectSupportResistance(
  deps: CollectSupportResistanceDeps,
  context: CollectionRunContext
): Promise<SupportResistanceCollectionResult> {
  const { supportResistanceSource, rawObservationRepo, normalizedObservationRepo } = deps;

  let snapshot: SupportResistanceSourceSnapshot;
  try {
    snapshot = await supportResistanceSource.collect({ pair: "SOL/USDC" });
  } catch (error) {
    if (isSourceError(error)) {
      return mapErrorToResult(error);
    }
    throw error;
  }

  let boundedSnapshot: BoundedSupportResistanceSnapshot;
  try {
    const transformed = transformPortToBoundedSnapshot(snapshot);
    boundedSnapshot = acceptSupportResistanceSnapshot(transformed);
  } catch (validationError) {
    return {
      status: "malformed",
      hasUsableEvidence: false,
      rawId: null,
      rawCount: 0,
      warnings: [],
      freshness: makeEmptyFreshness(),
      confidence: makeEmptyConfidence(),
      diagnostic: validationError instanceof Error ? validationError.message : "Validation failed"
    };
  }

  const receivedAtUnixMs = context.startedAtUnixMs;
  const canonicalizableSnapshot = JSON.parse(
    JSON.stringify(boundedSnapshot)
  ) as BoundedSupportResistanceSnapshot;
  const { payloadCanonical, payloadHash } = await canonicalizePayload(canonicalizableSnapshot);

  const primaryEvidenceSide = boundedSnapshot.claims[0]?.evidenceSide ?? "RESISTANCE";
  const sourceObservationKey = await deriveSupportResistanceSourceObservationKey({
    providerId: boundedSnapshot.providerId,
    providerRunId: boundedSnapshot.providerRunId,
    evidenceSide: primaryEvidenceSide
  });

  const codeVersion = "development";
  const pipelineRunId = context.runId;

  const redactedMeta: RedactedRequestMeta = {
    providerId: boundedSnapshot.providerId,
    providerRunId: boundedSnapshot.providerRunId,
    pair: boundedSnapshot.pair,
    intelligenceCodeVersion: codeVersion,
    intelligencePipelineRunId: pipelineRunId
  };

  const ingestDeps: IngestRawObservationDeps = {
    rawObservationRepo,
    normalizedObservationRepo,
    jsonStore: { readJson: async () => undefined, writeJson: async () => {} }
  };

  const normalizationResult = await normalizeSupportResistanceClaims(boundedSnapshot);
  const preComputedCandidates: SupportResistancePayloadV1[] = [...normalizationResult.accepted];
  const allWarnings: SupportResistanceWarning[] = [...normalizationResult.warnings];

  for (const candidate of preComputedCandidates) {
    if (candidate.warnings.includes("duplicate_equivalent_claim")) {
      allWarnings.push("duplicate_equivalent_claim");
      break;
    }
  }

  if (normalizationResult.rejected.length > 0) {
    for (const rej of normalizationResult.rejected) {
      if (rej.reason === "missing_level" || rej.reason === "malformed_level") {
        allWarnings.push("missing_level");
      }
    }
  }

  let normalizedResult: {
    rawObservationId: number;
    normalizedCount: number;
    parseStatus: "pending" | "parsed" | "failed";
    warnings: SupportResistanceWarning[];
    freshness: SupportResistanceCollectionResult["freshness"];
    confidence: SupportResistanceCollectionResult["confidence"];
    status: SupportResistanceCollectionResult["status"];
  };

  try {
    const result = await ingestRawObservation<
      BoundedSupportResistanceSnapshot,
      SupportResistancePayloadV1,
      Awaited<ReturnType<typeof enrichSupportResistanceClaim>>
    >(ingestDeps, {
      source: SOURCE,
      sourceObservationKey,
      observedAtUnixMs: boundedSnapshot.asOfUnixMs,
      fetchedAtUnixMs: receivedAtUnixMs,
      payloadCanonical,
      payloadHash,
      sourceRequestMeta: redactedMeta,
      receivedAtUnixMs,
      validatePayload: (canonical) => {
        const parsed = JSON.parse(canonical) as BoundedSupportResistanceSnapshot;
        return { accepted: acceptSupportResistanceSnapshot(parsed) };
      },
      buildCandidates: () => {
        return preComputedCandidates;
      },
      enrichCandidates: async (candidates, rawRow) => {
        const receivedAt = rawRow.receivedAtUnixMs;
        const enriched = await Promise.all(
          candidates.map(async (candidate) => {
            const sourceValidUntil = candidate.expiresAtUnixMs ?? candidate.asOfUnixMs + 86400000;
            return enrichSupportResistanceClaim({
              payload: candidate,
              nowMs: receivedAt,
              codeVersion,
              runId: pipelineRunId,
              rawId: rawRow.id,
              sourceValidUntilUnixMs: sourceValidUntil
            });
          })
        );
        return enriched;
      },
      insertNormalized: async (enriched, candidates, rawRow) => {
        if (enriched.length === 0) return 0;

        const normInserts = enriched.map((e, i) => {
          const cand = candidates[i]!;
          const entryForKind = getObservationKindEntry(cand.kind);
          return {
            rawObservationId: rawRow.id,
            source: SOURCE,
            observationKind: cand.kind,
            signalClass: entryForKind.signalClass,
            evidenceFamily: entryForKind.evidenceFamily,
            payload: cand,
            payloadHash: e.payloadHash,
            confidence: e.confidence,
            confidenceComposite: e.confidence.compositeScore,
            confidenceLevel: e.confidence.level,
            validUntilUnixMs: e.freshness.validUntilUnixMs,
            isStale: e.freshness.isStale,
            staleBehavior: entryForKind.freshnessPolicy.staleBehavior,
            provenance: e.provenance,
            receivedAtUnixMs: rawRow.receivedAtUnixMs
          };
        });

        await normalizedObservationRepo.insertMany(normInserts);
        return normInserts.length;
      },
      revalidateStoredCanonical: (canonical) => {
        const parsed = JSON.parse(canonical) as BoundedSupportResistanceSnapshot;
        return { accepted: acceptSupportResistanceSnapshot(parsed) };
      }
    });

    let finalNormalizedCount = result.normalizedCount;
    let status: SupportResistanceCollectionResult["status"] = "accepted";

    if (
      result.rawOutcome.outcome === "identical_replay" &&
      result.parseStatus === "parsed" &&
      finalNormalizedCount === 0
    ) {
      const existingRows = await normalizedObservationRepo.findBySource(
        SOURCE,
        "support_resistance_level",
        boundedSnapshot.asOfUnixMs
      );
      const forThisRaw = existingRows.filter((r) => r.rawObservationId === result.rawObservationId);
      finalNormalizedCount = forThisRaw.length;

      if (finalNormalizedCount > 0) {
        status = "identical_replay";
      }
    } else if (
      result.rawOutcome.outcome === "identical_replay" &&
      result.parseStatus === "parsed" &&
      finalNormalizedCount > 0
    ) {
      status = "accepted";
    } else if (
      result.rawOutcome.outcome === "identical_replay" &&
      result.parseStatus === "parsed"
    ) {
      status = "identical_replay";
    }

    let isStale = false;
    let hasWarnings = allWarnings.length > 0;
    let freshness = makeEmptyFreshness();
    let confidence = makeEmptyConfidence();

    if (finalNormalizedCount > 0) {
      const rows = await normalizedObservationRepo.findBySource(
        SOURCE,
        "support_resistance_level",
        boundedSnapshot.asOfUnixMs
      );
      const forThisRaw = rows.filter((r) => r.rawObservationId === result.rawObservationId);

      if (forThisRaw.length > 0) {
        isStale = forThisRaw.every((r) => r.isStale);
        hasWarnings = forThisRaw.some((r) => {
          const p = r.payload as SupportResistancePayloadV1;
          return p.warnings && p.warnings.length > 0;
        });

        if (forThisRaw[0]) {
          freshness = {
            isStale: forThisRaw[0].isStale,
            validUntilUnixMs: forThisRaw[0].validUntilUnixMs ?? 0,
            derivedAt: Date.now(),
            policyKind: "support_resistance_level",
            reasons: []
          };
          confidence = forThisRaw[0].confidence;
        }
      }
    }

    if (status === "accepted") {
      if (isStale) {
        status = "stale";
      } else if (hasWarnings) {
        status = "degraded";
      }
    }

    normalizedResult = {
      rawObservationId: result.rawObservationId,
      normalizedCount: finalNormalizedCount,
      parseStatus: result.parseStatus,
      warnings: allWarnings,
      freshness,
      confidence,
      status
    };
  } catch (error) {
    if (error instanceof RawObservationConflictError) {
      throw error;
    }

    throw error;
  }

  return {
    status:
      normalizedResult.parseStatus === "failed"
        ? "failed"
        : normalizedResult.normalizedCount === 0 && normalizedResult.warnings.length === 0
          ? "degraded"
          : (normalizedResult.status ?? "accepted"),
    hasUsableEvidence:
      normalizedResult.normalizedCount > 0 || normalizedResult.parseStatus === "parsed",
    rawId: String(normalizedResult.rawObservationId),
    rawCount: 1,
    warnings: normalizedResult.warnings,
    freshness: normalizedResult.freshness,
    confidence: normalizedResult.confidence,
    diagnostic: null
  };
}
