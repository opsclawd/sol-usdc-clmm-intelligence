import type { NewsEvidenceKind } from "../../src/contracts/news-events.js";
import type {
  BoundedNewsSourceRecord,
  NewsSourceRecordInput
} from "../../src/domain/news-events/validate.js";
import type { NewsSourceQuality, NewsPublisher } from "../../src/contracts/news-events.js";

export interface BoundedNewsSourceRecordOverrides {
  readonly source?: "crypto-news-api" | "regulatory-monitor-api";
  readonly providerId?: string;
  readonly providerRunId?: string;
  readonly retrievedAtUnixMs?: number;
  readonly articleId?: string;
  readonly sourceVersionId?: string;
  readonly correctsSourceVersionId?: string | null;
  readonly title?: string;
  readonly factualSummary?: string;
  readonly extractedClaims?: string[];
  readonly topicTags?: string[];
  readonly publishedAtUnixMs?: number | null;
  readonly sourceUpdatedAtUnixMs?: number | null;
  readonly publisher?: NewsPublisher;
  readonly sourceQuality?: NewsSourceQuality;
  readonly originatingReportId?: string;
  readonly syndicationId?: string | null;
  readonly affectedAssets?: string[];
  readonly affectedProtocols?: string[];
  readonly affectedJurisdictions?: string[];
  readonly sourceReferences?: string[];
  readonly license?: string;
  readonly retentionMode?: "bounded_factual_extract";
  readonly robotsAllowed?: boolean;
  readonly termsAllowRetention?: boolean;
  readonly extraField?: unknown;
  readonly body?: string;
  readonly content?: string;
  readonly html?: string;
}

function makeDefaultPublisher(): NewsPublisher {
  return {
    publisherId: "publisher-001",
    displayName: "Test Publisher",
    tier: "primary"
  };
}

function makeDefaultSourceQuality(): NewsSourceQuality {
  return {
    providerId: "crypto-news-api",
    reliability: 0.8,
    completeness: "complete",
    confirmation: "confirmed",
    isPaywalled: false
  };
}

export function makeBoundedNewsSourceRecord(
  overrides?: BoundedNewsSourceRecordOverrides
): NewsSourceRecordInput {
  const source = overrides?.source ?? "crypto-news-api";
  const providerId = overrides?.providerId ?? source;

  return {
    source,
    providerId,
    providerRunId: overrides?.providerRunId ?? "run-001",
    retrievedAtUnixMs: overrides?.retrievedAtUnixMs ?? 1705400000000,
    articleId: overrides?.articleId ?? "article-001",
    sourceVersionId: overrides?.sourceVersionId ?? "v1",
    correctsSourceVersionId: overrides?.correctsSourceVersionId ?? null,
    title: overrides?.title ?? "Test Article Title",
    factualSummary:
      overrides?.factualSummary ?? "This is a test factual summary of the article content.",
    extractedClaims: overrides?.extractedClaims ?? [
      "Claim 1: Solana network processed 1000 transactions.",
      "Claim 2: Average fee was 0.001 SOL."
    ],
    topicTags: overrides?.topicTags ?? ["solana", "defi", "news"],
    publishedAtUnixMs:
      overrides?.publishedAtUnixMs !== undefined ? overrides.publishedAtUnixMs : 1705390000000,
    sourceUpdatedAtUnixMs:
      overrides?.sourceUpdatedAtUnixMs !== undefined ? overrides.sourceUpdatedAtUnixMs : null,
    publisher: overrides?.publisher ?? makeDefaultPublisher(),
    sourceQuality: overrides?.sourceQuality ?? makeDefaultSourceQuality(),
    originatingReportId: overrides?.originatingReportId ?? "report-001",
    syndicationId: overrides?.syndicationId ?? null,
    affectedAssets: overrides?.affectedAssets ?? ["SOL"],
    affectedProtocols: overrides?.affectedProtocols ?? ["Solana"],
    affectedJurisdictions: overrides?.affectedJurisdictions ?? [],
    sourceReferences: overrides?.sourceReferences ?? ["https://example.com/article"],
    license: overrides?.license ?? "CC BY 4.0",
    retentionMode: overrides?.retentionMode ?? "bounded_factual_extract",
    robotsAllowed: overrides?.robotsAllowed ?? true,
    termsAllowRetention: overrides?.termsAllowRetention ?? true,
    ...(overrides?.extraField !== undefined ? { extraField: overrides.extraField } : {}),
    ...(overrides?.body !== undefined ? { body: overrides.body } : {}),
    ...(overrides?.content !== undefined ? { content: overrides.content } : {}),
    ...(overrides?.html !== undefined ? { html: overrides.html } : {})
  };
}

export function makeRegulatoryRiskRecord(
  overrides?: BoundedNewsSourceRecordOverrides
): NewsSourceRecordInput {
  return makeBoundedNewsSourceRecord({
    source: "regulatory-monitor-api",
    providerId: "regulatory-monitor-api",
    ...overrides,
    topicTags: overrides?.topicTags ?? ["regulation", "sec", "cryptocurrency"],
    affectedJurisdictions: overrides?.affectedJurisdictions ?? ["US", "EU"]
  });
}

export function makePaywalledRecord(
  overrides?: BoundedNewsSourceRecordOverrides
): NewsSourceRecordInput {
  return makeBoundedNewsSourceRecord({
    sourceQuality: {
      ...makeDefaultSourceQuality(),
      isPaywalled: true,
      completeness: "partial"
    },
    ...overrides
  });
}

export function makeUnconfirmedRecord(
  overrides?: BoundedNewsSourceRecordOverrides
): NewsSourceRecordInput {
  return makeBoundedNewsSourceRecord({
    sourceQuality: {
      ...makeDefaultSourceQuality(),
      confirmation: "unconfirmed"
    },
    ...overrides
  });
}

export function makeStaleRecord(
  nowMs: number,
  overrides?: BoundedNewsSourceRecordOverrides
): NewsSourceRecordInput {
  const stalePublishedAt = nowMs - 1000 * 60 * 60 * 25;
  return makeBoundedNewsSourceRecord({
    publishedAtUnixMs: stalePublishedAt,
    retrievedAtUnixMs: stalePublishedAt + 1000,
    ...overrides
  });
}

export function makeLongString(length: number): string {
  return "x".repeat(length);
}

export function makeRecordWithLongSummary(
  length: number,
  overrides?: BoundedNewsSourceRecordOverrides
): NewsSourceRecordInput {
  return makeBoundedNewsSourceRecord({
    factualSummary: makeLongString(length),
    ...overrides
  });
}

export function makeRecordWithManyClaims(
  count: number,
  overrides?: BoundedNewsSourceRecordOverrides
): NewsSourceRecordInput {
  const claims = Array.from({ length: count }, (_, i) => `Claim ${i + 1}: Test claim content.`);
  return makeBoundedNewsSourceRecord({
    extractedClaims: claims,
    ...overrides
  });
}

export function makeRecordWithManyTags(
  count: number,
  overrides?: BoundedNewsSourceRecordOverrides
): NewsSourceRecordInput {
  const tags = Array.from({ length: count }, (_, i) => `tag${i + 1}`);
  return makeBoundedNewsSourceRecord({
    topicTags: tags,
    ...overrides
  });
}

export function makeRecordWithManyReferences(
  count: number,
  overrides?: BoundedNewsSourceRecordOverrides
): NewsSourceRecordInput {
  const references = Array.from({ length: count }, (_, i) => `https://example.com/source${i + 1}`);
  return makeBoundedNewsSourceRecord({
    sourceReferences: references,
    ...overrides
  });
}

export function makeRecordWithManyAffectedScope(
  overrides?: BoundedNewsSourceRecordOverrides
): NewsSourceRecordInput {
  return makeBoundedNewsSourceRecord({
    affectedAssets: Array.from({ length: 50 }, (_, i) => `ASSET${i + 1}`),
    affectedProtocols: Array.from({ length: 50 }, (_, i) => `PROTOCOL${i + 1}`),
    affectedJurisdictions: Array.from({ length: 50 }, (_, i) => `JURISDICTION${i + 1}`),
    ...overrides
  });
}

export function makeRecordMissingHttps(
  overrides?: BoundedNewsSourceRecordOverrides
): NewsSourceRecordInput {
  return makeBoundedNewsSourceRecord({
    sourceReferences: ["http://example.com/article", "https://example.com/article"],
    ...overrides
  });
}

export function makeRecordWithDuplicateTags(
  overrides?: BoundedNewsSourceRecordOverrides
): NewsSourceRecordInput {
  return makeBoundedNewsSourceRecord({
    topicTags: ["solana", "defi", "solana", "news", "defi"],
    ...overrides
  });
}

export function makeCorrectionRecord(
  overrides?: BoundedNewsSourceRecordOverrides
): NewsSourceRecordInput {
  return makeBoundedNewsSourceRecord({
    sourceVersionId: "v2",
    correctsSourceVersionId: "v1",
    title: "Updated Test Article Title",
    ...overrides
  });
}

export function makeIncompleteRecord(
  overrides?: BoundedNewsSourceRecordOverrides
): NewsSourceRecordInput {
  return makeBoundedNewsSourceRecord({
    publishedAtUnixMs: null,
    sourceUpdatedAtUnixMs: null,
    ...overrides
  });
}

export type { BoundedNewsSourceRecord, NewsSourceQuality, NewsPublisher, NewsEvidenceKind };
