import { describe, it, expect } from "vitest";
import { deriveClmmSourceObservationKey } from "../../../src/domain/clmm-bundle/identity.js";

describe("deriveClmmSourceObservationKey", () => {
  const baseInput = {
    identityVersion: 1,
    walletId: "wallet_abc123",
    pair: "SOL/USDC",
    poolId: "pool_xyz789",
    observedAtUnixMs: 1700000000000
  };

  it("source observation key is stable for the same version wallet pair pool and observed time", async () => {
    const key1 = await deriveClmmSourceObservationKey(baseInput);
    const key2 = await deriveClmmSourceObservationKey({ ...baseInput });
    expect(key1).toBe(key2);
  });

  it("source observation key changes when wallet pool pair observation time or identity version changes", async () => {
    const key1 = await deriveClmmSourceObservationKey(baseInput);
    const keyWallet = await deriveClmmSourceObservationKey({
      ...baseInput,
      walletId: "wallet_def456"
    });
    const keyPool = await deriveClmmSourceObservationKey({
      ...baseInput,
      poolId: "pool_aaa111"
    });
    const keyTime = await deriveClmmSourceObservationKey({
      ...baseInput,
      observedAtUnixMs: 1700000001000
    });
    const keyVersion = await deriveClmmSourceObservationKey({
      ...baseInput,
      identityVersion: 2
    });

    expect(key1).not.toBe(keyWallet);
    expect(key1).not.toBe(keyPool);
    expect(key1).not.toBe(keyTime);
    expect(key1).not.toBe(keyVersion);
  });

  it("returns a 64-character lowercase SHA-256 hex digest", async () => {
    const key = await deriveClmmSourceObservationKey(baseInput);
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});
