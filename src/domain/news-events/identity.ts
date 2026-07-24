import { canonicalizePayload } from "../content-hash.js";

export interface NewsObservationKeyInput {
  readonly source: "crypto-news-api" | "regulatory-monitor-api";
  readonly providerId: string;
  readonly articleId: string;
  readonly sourceVersionId: string;
  readonly boundedPayloadHash: string;
}

export async function deriveNewsObservationKey(input: NewsObservationKeyInput): Promise<string> {
  const { payloadHash } = await canonicalizePayload({
    source: input.source,
    providerId: input.providerId,
    articleId: input.articleId,
    sourceVersionId: input.sourceVersionId,
    boundedPayloadHash: input.boundedPayloadHash
  });
  return payloadHash;
}
