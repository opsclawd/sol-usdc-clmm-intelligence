import { canonicalHash } from "../content-hash.js";

export function deriveSolanaNetworkStatusObservationKey(input: {
  readonly network: "solana-mainnet-beta";
  readonly observedAtUnixMs: number;
}): Promise<string> {
  return canonicalHash({
    identityVersion: 1,
    network: input.network,
    observedAtUnixMs: input.observedAtUnixMs
  });
}
