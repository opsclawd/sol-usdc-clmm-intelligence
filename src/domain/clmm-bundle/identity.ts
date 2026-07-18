import { canonicalizePayload } from "../content-hash.js";

export interface ClmmSourceObservationIdentity {
  identityVersion: number;
  walletId: string;
  pair: string;
  poolId: string;
  observedAtUnixMs: number;
}

export async function deriveClmmSourceObservationKey(
  identity: ClmmSourceObservationIdentity
): Promise<string> {
  const { payloadHash } = await canonicalizePayload(identity);
  return payloadHash;
}
