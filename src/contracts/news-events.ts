export type NewsEvidenceKind = "ecosystem_news" | "regulatory_risk";

export type NewsCorroborationState =
  | "unconfirmed"
  | "single_source"
  | "independently_corroborated"
  | "conflicting";

export type NewsEvidenceWarning =
  | "unconfirmed_claim"
  | "correction"
  | "partial_material"
  | "paywalled_material"
  | "source_disagreement"
  | "stale_observation";

export type NewsPublisherTier = "official" | "primary" | "secondary" | "aggregator";

export interface NewsPublisher {
  readonly publisherId: string;
  readonly displayName: string;
  readonly tier: NewsPublisherTier;
}

export type NewsSourceCompleteness = "complete" | "partial";
export type NewsSourceConfirmation = "confirmed" | "unconfirmed";

export interface NewsSourceQuality {
  readonly providerId: string;
  readonly reliability: number;
  readonly completeness: NewsSourceCompleteness;
  readonly confirmation: NewsSourceConfirmation;
  readonly isPaywalled: boolean;
}

export interface NewsRawProvenance {
  readonly retrievedAtUnixMs: number;
  readonly license: string;
  readonly retentionMode: "bounded_factual_extract";
  readonly robotsCompliance: boolean;
  readonly termsAccepted: boolean;
}

export interface NewsPayloadV1 {
  readonly evidenceKind: "ecosystem_news";
  readonly articleId: string;
  readonly sourceVersionId: string;
  readonly correctsSourceVersionId: string | null;
  readonly clusterId: string;
  readonly title: string;
  readonly factualSummary: string;
  readonly extractedClaims: readonly string[];
  readonly topicTags: readonly string[];
  readonly publishedAtUnixMs: number | null;
  readonly sourceUpdatedAtUnixMs: number | null;
  readonly retrievedAtUnixMs: number;
  readonly asOfUnixMs: number;
  readonly expiresAtUnixMs: number;
  readonly publisher: NewsPublisher;
  readonly sourceQuality: NewsSourceQuality;
  readonly corroborationState: NewsCorroborationState;
  readonly originatingReportId: string;
  readonly syndicationId: string | null;
  readonly affectedAssets: readonly string[];
  readonly affectedProtocols: readonly string[];
  readonly affectedJurisdictions: readonly string[];
  readonly sourceReferences: readonly string[];
  readonly rawProvenance: NewsRawProvenance;
  readonly warnings: readonly NewsEvidenceWarning[];
}

export interface RegulatoryPayloadV1 extends Omit<NewsPayloadV1, "evidenceKind"> {
  readonly evidenceKind: "regulatory_risk";
}

export type NewsEvidencePayload = NewsPayloadV1 | RegulatoryPayloadV1;
