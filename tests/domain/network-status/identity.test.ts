import { describe, it, expect } from "vitest";
import { deriveSolanaNetworkStatusObservationKey } from "../../../src/domain/network-status/identity.js";

describe("network-status identity", () => {
  it("derives stable identity from network and collection instant only", async () => {
    const input1 = {
      network: "solana-mainnet-beta" as const,
      observedAtUnixMs: 1700000000000
    };

    const input2 = {
      network: "solana-mainnet-beta" as const,
      observedAtUnixMs: 1700000000000
    };

    const key1 = await deriveSolanaNetworkStatusObservationKey(input1);
    const key2 = await deriveSolanaNetworkStatusObservationKey(input2);

    expect(key1).toBe(key2);
    expect(key1).toMatch(/^[a-f0-9]{64}$/);
  });
});
