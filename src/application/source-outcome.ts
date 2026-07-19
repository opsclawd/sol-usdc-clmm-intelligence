import type { CoreSourceKey, SourceCollectionOutcome } from "../contracts/collection-run.js";
import type { Source } from "../contracts/taxonomy.js";
import type { PriceSourceResult } from "./price-source-result.js";
import { PostPersistenceOutputError } from "./ingest-raw-observation.js";
import type { CollectClmmBundleResult } from "./collect-clmm-bundle.js";

export function redactDiagnostic(text: string): string {
  if (!text) return "";
  let redacted = text;
  const keys = [
    "api[_-]?key",
    "bearer\\s*token",
    "auth\\s*token",
    "bearer",
    "token",
    "auth",
    "secret"
  ];
  for (const key of keys) {
    const regex = new RegExp(`(${key})\\s*([=:]\\s*|\\s+)(\\S+)`, "gi");
    redacted = redacted.replace(regex, "[REDACTED]");
  }
  return redacted;
}

export function mapPriceSourceOutcome(
  sourceKey: "pyth" | "jupiter",
  source: "pyth-hermes" | "jupiter-quote",
  result: PriceSourceResult
): SourceCollectionOutcome {
  const warnings =
    "warnings" in result && result.warnings
      ? result.warnings.map((w) => ({
          source: sourceKey,
          code: w,
          message: null
        }))
      : [];

  let hasUsableEvidence = false;
  if (
    result.status === "accepted" ||
    result.status === "identical_replay" ||
    result.status === "stale" ||
    result.status === "degraded"
  ) {
    hasUsableEvidence = true;
  }
  if (result.status === "failed" && result.hasUsableEvidence !== undefined) {
    hasUsableEvidence = result.hasUsableEvidence;
  }

  const rawObservationId =
    "rawObservationId" in result
      ? result.rawObservationId
      : result.status === "failed" && result.durableEvidence
        ? result.durableEvidence.rawObservationId
        : null;

  const normalizedCount =
    "normalizedCount" in result
      ? result.normalizedCount
      : result.status === "failed" && result.durableEvidence
        ? result.durableEvidence.normalizedCount
        : 0;

  const freshness = "freshness" in result ? result.freshness : null;
  const confidenceLevel = "confidenceLevel" in result ? result.confidenceLevel : null;
  const diagnostic = "summary" in result ? redactDiagnostic(result.summary) : null;

  return {
    sourceKey,
    source,
    status: result.status,
    hasUsableEvidence,
    rawObservationId,
    normalizedCount,
    warnings,
    freshness,
    confidenceLevel,
    diagnostic
  };
}

export function mapClmmSourceOutcome(result: CollectClmmBundleResult): SourceCollectionOutcome {
  const status = result.rawOutcome.outcome === "identical_replay" ? "identical_replay" : "accepted";
  return {
    sourceKey: "clmm-v2",
    source: "clmm-v2-bundle",
    status,
    hasUsableEvidence: true,
    rawObservationId: result.rawObservationId,
    normalizedCount: result.normalizedCount,
    warnings: [],
    freshness: null,
    confidenceLevel: null,
    diagnostic: null
  };
}

export function mapSourceError(
  sourceKey: CoreSourceKey,
  source: Source,
  error: unknown
): SourceCollectionOutcome {
  if (
    error instanceof Error &&
    (error.name === "RawObservationConflictError" ||
      error.name === "ClmmObservationConflictError" ||
      "existingPayloadHash" in error)
  ) {
    const err = error as {
      existingPayloadHash?: string;
      incomingPayloadHash?: string;
      source?: string;
      sourceObservationKey?: string;
    };
    const existing = err.existingPayloadHash ? String(err.existingPayloadHash).slice(0, 8) : "";
    const incoming = err.incomingPayloadHash ? String(err.incomingPayloadHash).slice(0, 8) : "";
    const msg = `Conflict for ${err.source || source}:${err.sourceObservationKey || ""}: existing hash ${existing} vs incoming ${incoming}`;
    return {
      sourceKey,
      source,
      status: "conflict",
      hasUsableEvidence: false,
      rawObservationId: null,
      normalizedCount: 0,
      warnings: [],
      freshness: null,
      confidenceLevel: null,
      diagnostic: redactDiagnostic(msg)
    };
  }

  if (error instanceof Error && error.name === "PostPersistenceOutputError") {
    const err = error as PostPersistenceOutputError;
    return {
      sourceKey,
      source,
      status: "failed",
      hasUsableEvidence: true,
      rawObservationId: err.rawObservationId,
      normalizedCount: err.normalizedCount,
      warnings: [],
      freshness: null,
      confidenceLevel: null,
      diagnostic: redactDiagnostic(err.message)
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    sourceKey,
    source,
    status: "failed",
    hasUsableEvidence: false,
    rawObservationId: null,
    normalizedCount: 0,
    warnings: [],
    freshness: null,
    confidenceLevel: null,
    diagnostic: redactDiagnostic(message)
  };
}
