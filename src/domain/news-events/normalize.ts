import type {
  NewsPayloadV1,
  RegulatoryPayloadV1,
  NewsEvidenceWarning
} from "../../contracts/news-events.js";
import type { BoundedNewsSourceRecord } from "./validate.js";

const ECOSYSTEM_NEWS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REGULATORY_RISK_MAX_AGE_MS = 72 * 60 * 60 * 1000;

export type UnclusteredNewsEvidencePayload = NewsPayloadV1 | RegulatoryPayloadV1;

function computeAsOfUnixMs(publishedAtUnixMs: number | null, retrievedAtUnixMs: number): number {
  return publishedAtUnixMs ?? retrievedAtUnixMs;
}

function computeExpiresAtUnixMs(
  asOfUnixMs: number,
  evidenceKind: "ecosystem_news" | "regulatory_risk"
): number {
  const maxAge =
    evidenceKind === "regulatory_risk" ? REGULATORY_RISK_MAX_AGE_MS : ECOSYSTEM_NEWS_MAX_AGE_MS;
  return asOfUnixMs + maxAge;
}

function deriveWarnings(
  record: BoundedNewsSourceRecord,
  asOfUnixMs: number,
  nowMs: number
): NewsEvidenceWarning[] {
  const warnings: NewsEvidenceWarning[] = [];

  if (record.correctsSourceVersionId !== null) {
    warnings.push("correction");
  }

  if (record.sourceQuality.confirmation === "unconfirmed") {
    warnings.push("unconfirmed_claim");
  }

  if (record.sourceQuality.completeness === "partial") {
    warnings.push("partial_material");
  }

  if (record.sourceQuality.isPaywalled) {
    warnings.push("paywalled_material");
  }

  const maxAge =
    record.evidenceKind === "regulatory_risk"
      ? REGULATORY_RISK_MAX_AGE_MS
      : ECOSYSTEM_NEWS_MAX_AGE_MS;
  if (nowMs > asOfUnixMs + maxAge) {
    warnings.push("stale_observation");
  }

  return warnings;
}

export function normalizeNewsRecord(
  input: BoundedNewsSourceRecord,
  nowMs: number
): UnclusteredNewsEvidencePayload {
  const asOfUnixMs = computeAsOfUnixMs(input.publishedAtUnixMs, input.retrievedAtUnixMs);
  const expiresAtUnixMs = computeExpiresAtUnixMs(asOfUnixMs, input.evidenceKind);
  const warnings = deriveWarnings(input, asOfUnixMs, nowMs);

  const basePayload = {
    articleId: input.articleId,
    sourceVersionId: input.sourceVersionId,
    correctsSourceVersionId: input.correctsSourceVersionId,
    clusterId: "",
    title: input.title,
    factualSummary: input.factualSummary,
    extractedClaims: input.extractedClaims,
    topicTags: input.topicTags,
    publishedAtUnixMs: input.publishedAtUnixMs,
    sourceUpdatedAtUnixMs: input.sourceUpdatedAtUnixMs,
    retrievedAtUnixMs: input.retrievedAtUnixMs,
    asOfUnixMs,
    expiresAtUnixMs,
    publisher: input.publisher,
    sourceQuality: input.sourceQuality,
    corroborationState: "single_source" as const,
    originatingReportId: input.originatingReportId,
    syndicationId: input.syndicationId,
    affectedAssets: input.affectedAssets,
    affectedProtocols: input.affectedProtocols,
    affectedJurisdictions: input.affectedJurisdictions,
    sourceReferences: input.sourceReferences,
    rawProvenance: input.rawProvenance,
    warnings
  };

  if (input.evidenceKind === "regulatory_risk") {
    return {
      evidenceKind: "regulatory_risk",
      ...basePayload
    } as RegulatoryPayloadV1;
  }

  return {
    evidenceKind: "ecosystem_news",
    ...basePayload
  } as NewsPayloadV1;
}
