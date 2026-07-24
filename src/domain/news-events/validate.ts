import { z } from "zod";
import type {
  NewsEvidenceKind,
  NewsPublisher,
  NewsSourceQuality,
  BoundedNewsSourceRecord
} from "../../contracts/news-events.js";
export type { BoundedNewsSourceRecord };

const MAX_SUMMARY_LENGTH = 1000;
const MAX_CLAIM_LENGTH = 500;
const MAX_CLAIMS = 10;
const MAX_TAGS = 20;
const MAX_REFERENCES = 50;
const MAX_AFFECTED_SCOPE_TOTAL = 100;

export class NewsValidationError extends Error {
  constructor(
    public readonly field: string,
    public readonly message: string
  ) {
    super(`[${field}] ${message}`);
    this.name = "NewsValidationError";
  }
}

const finiteInteger = () =>
  z
    .number()
    .refine(Number.isFinite, { message: "must be a finite number" })
    .refine(Number.isInteger, { message: "must be an integer" });

const nonEmptyString = (message = "must be a non-empty string") =>
  z.string().trim().min(1, message);

const publisherTierSchema = z.enum(["official", "primary", "secondary", "aggregator"]);

const publisherSchema: z.ZodType<NewsPublisher> = z.object({
  publisherId: nonEmptyString("publisherId is required"),
  displayName: nonEmptyString("displayName is required"),
  tier: publisherTierSchema
}) as z.ZodType<NewsPublisher>;

const sourceQualitySchema: z.ZodType<NewsSourceQuality> = z.object({
  providerId: nonEmptyString("providerId is required"),
  reliability: z.number().min(0).max(1, "reliability must be in [0, 1]"),
  completeness: z.enum(["complete", "partial"]),
  confirmation: z.enum(["confirmed", "unconfirmed"]),
  isPaywalled: z.boolean()
}) as z.ZodType<NewsSourceQuality>;

const newsSourceRecordInputSchema = z
  .object({
    source: z.enum(["crypto-news-api", "regulatory-monitor-api"]),
    providerId: nonEmptyString("providerId is required"),
    providerRunId: nonEmptyString("providerRunId is required"),
    retrievedAtUnixMs: finiteInteger(),
    articleId: nonEmptyString("articleId is required"),
    sourceVersionId: nonEmptyString("sourceVersionId is required"),
    correctsSourceVersionId: z.string().nullable().optional(),
    title: nonEmptyString("title is required"),
    factualSummary: z.string(),
    extractedClaims: z
      .array(z.string().trim().min(1, "extracted claim cannot be empty"))
      .default([]),
    topicTags: z.array(z.string().trim().min(1, "topic tag cannot be empty")).default([]),
    publishedAtUnixMs: finiteInteger().nullable().optional(),
    sourceUpdatedAtUnixMs: finiteInteger().nullable().optional(),
    publisher: publisherSchema,
    sourceQuality: sourceQualitySchema,
    originatingReportId: nonEmptyString("originatingReportId is required"),
    syndicationId: z.string().nullable().optional(),
    affectedAssets: z.array(z.string().trim().min(1, "affected asset cannot be empty")).default([]),
    affectedProtocols: z
      .array(z.string().trim().min(1, "affected protocol cannot be empty"))
      .default([]),
    affectedJurisdictions: z
      .array(z.string().trim().min(1, "affected jurisdiction cannot be empty"))
      .default([]),
    sourceReferences: z
      .array(z.string().trim().min(1, "source reference cannot be empty"))
      .min(1, "at least one source reference is required"),
    license: nonEmptyString("license is required"),
    retentionMode: z.literal("bounded_factual_extract", {
      errorMap: () => ({ message: "retentionMode must be bounded_factual_extract" })
    }),
    robotsAllowed: z.boolean(),
    termsAllowRetention: z.boolean()
  })
  .passthrough()
  .superRefine((data, ctx) => {
    if ("body" in data || "content" in data || "html" in data || "fullText" in data) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "prohibited long-form fields (body, content, html, fullText) are not allowed"
      });
    }
  })
  .refine(
    (data) => {
      if (!data.robotsAllowed || !data.termsAllowRetention) {
        return false;
      }
      return true;
    },
    {
      message: "robotsAllowed and termsAllowRetention must both be true for bounded retention"
    }
  )
  .refine(
    (data) => {
      for (const ref of data.sourceReferences) {
        if (!ref.startsWith("https://")) {
          return false;
        }
      }
      return true;
    },
    {
      message: "all source references must use HTTPS",
      path: ["sourceReferences"]
    }
  )
  .refine(
    (data) => {
      for (const claim of data.extractedClaims) {
        if (claim.length > MAX_CLAIM_LENGTH) {
          return false;
        }
      }
      return true;
    },
    {
      message: `each extracted claim must not exceed ${MAX_CLAIM_LENGTH} characters`,
      path: ["extractedClaims"]
    }
  )
  .refine((data) => data.extractedClaims.length <= MAX_CLAIMS, {
    message: `extractedClaims must not exceed ${MAX_CLAIMS} items`,
    path: ["extractedClaims"]
  })
  .refine((data) => data.topicTags.length <= MAX_TAGS, {
    message: `topicTags must not exceed ${MAX_TAGS} items`,
    path: ["topicTags"]
  })
  .refine((data) => data.sourceReferences.length <= MAX_REFERENCES, {
    message: `sourceReferences must not exceed ${MAX_REFERENCES} items`,
    path: ["sourceReferences"]
  })
  .refine(
    (data) => {
      const total =
        data.affectedAssets.length +
        data.affectedProtocols.length +
        data.affectedJurisdictions.length;
      return total <= MAX_AFFECTED_SCOPE_TOTAL;
    },
    {
      message: `total affected scope must not exceed ${MAX_AFFECTED_SCOPE_TOTAL} items`,
      path: ["affectedScope"]
    }
  )
  .refine(
    (data) => {
      if (
        data.publishedAtUnixMs !== null &&
        data.publishedAtUnixMs !== undefined &&
        data.sourceUpdatedAtUnixMs !== null &&
        data.sourceUpdatedAtUnixMs !== undefined
      ) {
        return data.sourceUpdatedAtUnixMs >= data.publishedAtUnixMs;
      }
      return true;
    },
    {
      message: "sourceUpdatedAtUnixMs cannot precede publishedAtUnixMs",
      path: ["sourceUpdatedAtUnixMs"]
    }
  )
  .refine(
    (data) => {
      if (data.source === "regulatory-monitor-api") {
        return data.affectedJurisdictions.length > 0;
      }
      return true;
    },
    {
      message: "regulatory_risk records must have at least one affected jurisdiction",
      path: ["affectedJurisdictions"]
    }
  )
  .refine(
    (data) => {
      const secretPattern = /(sk-|api[-_]?key|password|secret|token)\s*[=:]\s*["']?[a-zA-Z0-9_-]/i;
      if (secretPattern.test(data.title)) {
        return false;
      }
      if (secretPattern.test(data.factualSummary)) {
        return false;
      }
      return true;
    },
    {
      message: "payload must not contain apparent secrets or API keys",
      path: ["title"]
    }
  );

export type NewsSourceRecordInput = z.infer<typeof newsSourceRecordInputSchema>;

function normalizeStringArray(arr: readonly string[]): string[] {
  const trimmed = arr.map((s) => s.trim()).filter((s) => s.length > 0);
  return [...new Set(trimmed)].sort();
}

function trimSummary(summary: string): string {
  if (summary.length <= MAX_SUMMARY_LENGTH) return summary;
  return summary.slice(0, MAX_SUMMARY_LENGTH);
}

export function acceptBoundedNewsRecord(input: unknown): BoundedNewsSourceRecord {
  const parsed = newsSourceRecordInputSchema.parse(input);

  const evidenceKind: NewsEvidenceKind =
    parsed.source === "regulatory-monitor-api" ? "regulatory_risk" : "ecosystem_news";

  const topicTags = normalizeStringArray(parsed.topicTags);
  const affectedAssets = normalizeStringArray(parsed.affectedAssets);
  const affectedProtocols = normalizeStringArray(parsed.affectedProtocols);
  const affectedJurisdictions = normalizeStringArray(parsed.affectedJurisdictions);
  const sourceReferences = normalizeStringArray(parsed.sourceReferences);

  return {
    source: parsed.source,
    providerId: parsed.providerId,
    providerRunId: parsed.providerRunId,
    retrievedAtUnixMs: parsed.retrievedAtUnixMs,
    articleId: parsed.articleId,
    sourceVersionId: parsed.sourceVersionId,
    correctsSourceVersionId: parsed.correctsSourceVersionId ?? null,
    evidenceKind,
    title: parsed.title.trim(),
    factualSummary: trimSummary(parsed.factualSummary.trim()),
    extractedClaims: parsed.extractedClaims.map((c) => c.trim()),
    topicTags,
    publishedAtUnixMs: parsed.publishedAtUnixMs ?? null,
    sourceUpdatedAtUnixMs: parsed.sourceUpdatedAtUnixMs ?? null,
    publisher: parsed.publisher,
    sourceQuality: parsed.sourceQuality,
    originatingReportId: parsed.originatingReportId,
    syndicationId: parsed.syndicationId ?? null,
    affectedAssets,
    affectedProtocols,
    affectedJurisdictions,
    sourceReferences,
    rawProvenance: {
      retrievedAtUnixMs: parsed.retrievedAtUnixMs,
      license: parsed.license,
      retentionMode: "bounded_factual_extract",
      robotsCompliance: parsed.robotsAllowed,
      termsAccepted: parsed.termsAllowRetention
    }
  };
}
