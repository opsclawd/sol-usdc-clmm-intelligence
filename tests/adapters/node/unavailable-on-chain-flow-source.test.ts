import { describe, it, expect } from "vitest";
import { UnavailableOnChainFlowSource } from "../../../src/adapters/node/unavailable-on-chain-flow-source.js";

describe("UnavailableOnChainFlowSource", () => {
  it("always reports disabled Helius coverage as unavailable without HTTP", async () => {
    const source = new UnavailableOnChainFlowSource(
      "Helius flow kinds are not implemented in Phase 1"
    );
    await expect(source.collect({ pair: "SOL/USDC", fromUnixMs: 1, toUnixMs: 2 })).rejects.toEqual({
      kind: "unavailable",
      diagnostic: "Helius flow kinds are not implemented in Phase 1"
    });
  });
});
