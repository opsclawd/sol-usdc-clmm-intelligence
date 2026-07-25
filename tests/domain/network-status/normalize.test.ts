import { describe, it, expect } from "vitest";
import { normalizeSolanaNetworkStatus } from "../../../src/domain/network-status/normalize.js";

describe("network-status normalization", () => {
  it("normalizes a healthy batch without warnings", () => {
    const payload = normalizeSolanaNetworkStatus({
      accepted: {
        health: "ok",
        slot: 250000000,
        slotsBehind: null,
        slotUnavailable: false
      },
      observedAtUnixMs: 1700000000000
    });

    expect(payload).toEqual({
      kind: "network_status",
      schemaVersion: 1,
      network: "solana-mainnet-beta",
      observedAtUnixMs: 1700000000000,
      health: "ok",
      slot: 250000000,
      slotsBehind: null,
      warnings: []
    });
  });

  it("normalizes node-behind and missing slot as explicit sorted warnings", () => {
    const payload = normalizeSolanaNetworkStatus({
      accepted: {
        health: "behind",
        slot: null,
        slotsBehind: 12,
        slotUnavailable: true
      },
      observedAtUnixMs: 1700000000000
    });

    expect(payload).toEqual({
      kind: "network_status",
      schemaVersion: 1,
      network: "solana-mainnet-beta",
      observedAtUnixMs: 1700000000000,
      health: "behind",
      slot: null,
      slotsBehind: 12,
      warnings: ["node_behind", "slot_unavailable"]
    });
  });
});
