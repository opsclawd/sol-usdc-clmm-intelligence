import { describe, expect, it } from "vitest";
import {
  DEFAULT_ON_CHAIN_FLOW_LOOKBACK_MS,
  DEFAULT_ON_CHAIN_FLOW_THRESHOLDS
} from "../../../src/domain/on-chain-flow/defaults.js";

describe("on-chain-flow defaults", () => {
  it("uses thresholds attainable for the fifteen-minute SOL/USDC window", () => {
    expect(DEFAULT_ON_CHAIN_FLOW_THRESHOLDS.whaleSwapMinUsdc).toBe("100000");
  });

  it("uses a fifteen-minute lookback", () => {
    expect(DEFAULT_ON_CHAIN_FLOW_LOOKBACK_MS).toBe(15 * 60 * 1000);
  });
});
