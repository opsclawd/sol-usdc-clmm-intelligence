import { canonicalizePayload } from "../content-hash.js";

export interface SupportResistanceSourceObservationIdentity {
  readonly providerId: string;
  readonly providerRunId: string;
}

export interface SupportResistanceEquivalenceIdentity {
  readonly providerId: string;
  readonly providerRunId: string;
  readonly pair: string;
  readonly evidenceSide: "SUPPORT" | "RESISTANCE";
  readonly levelType: "point" | "zone";
  readonly levelUsdcPerSol?: number;
  readonly zoneLowerUsdcPerSol?: number;
  readonly zoneUpperUsdcPerSol?: number;
  readonly timeframe: string;
  readonly thesisCodes: readonly string[];
}

export async function deriveSupportResistanceSourceObservationKey(
  identity: SupportResistanceSourceObservationIdentity
): Promise<string> {
  const { payloadHash } = await canonicalizePayload({
    providerId: identity.providerId,
    providerRunId: identity.providerRunId
  });
  return payloadHash;
}

export async function deriveSupportResistanceEquivalenceKey(
  identity: SupportResistanceEquivalenceIdentity
): Promise<string> {
  const sortedThesisCodes = [...identity.thesisCodes].sort();

  const canonicalIdentity = {
    providerId: identity.providerId,
    providerRunId: identity.providerRunId,
    pair: identity.pair,
    evidenceSide: identity.evidenceSide,
    levelType: identity.levelType,
    levelUsdcPerSol: identity.levelUsdcPerSol ?? null,
    zoneLowerUsdcPerSol: identity.zoneLowerUsdcPerSol ?? null,
    zoneUpperUsdcPerSol: identity.zoneUpperUsdcPerSol ?? null,
    timeframe: identity.timeframe,
    thesisCodes: sortedThesisCodes
  };

  const { payloadHash } = await canonicalizePayload(canonicalIdentity);
  return payloadHash;
}
