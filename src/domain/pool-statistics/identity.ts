import { canonicalHash } from "../content-hash.js";

export interface OrcaSourceIdentityInput {
  readonly poolAddress: string;
  readonly updatedAt: string;
  readonly updatedSlot: number;
}

export async function deriveOrcaSourceObservationKey(
  input: OrcaSourceIdentityInput
): Promise<string> {
  const identityPayload = {
    identityVersion: 1,
    poolAddress: input.poolAddress,
    updatedAt: input.updatedAt,
    updatedSlot: input.updatedSlot
  };
  return canonicalHash(identityPayload);
}
