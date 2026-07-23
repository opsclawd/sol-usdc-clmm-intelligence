import { canonicalizePayload } from "../content-hash.js";

export interface ContextSnapshotObservationKeyInput {
  source: "macro-calendar-api" | "solana-status-api";
  providerId: string;
  sourceObservedAtUnixMs: number;
  payloadHash: string;
}

export async function deriveContextSnapshotObservationKey(
  input: ContextSnapshotObservationKeyInput
): Promise<string> {
  const { payloadHash } = await canonicalizePayload(input);
  return payloadHash;
}
