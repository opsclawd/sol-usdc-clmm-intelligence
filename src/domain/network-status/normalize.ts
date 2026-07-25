import type {
  NetworkStatusPayloadV1,
  NetworkStatusWarning
} from "../../contracts/normalized-network-status.js";
import type { AcceptedSolanaNetworkStatus } from "./solana-rpc.js";

export function normalizeSolanaNetworkStatus(input: {
  readonly accepted: AcceptedSolanaNetworkStatus;
  readonly observedAtUnixMs: number;
}): NetworkStatusPayloadV1 {
  const warnings: NetworkStatusWarning[] = [];

  if (input.accepted.health === "behind") {
    warnings.push("node_behind");
  }

  if (input.accepted.slotUnavailable || input.accepted.slot === null) {
    warnings.push("slot_unavailable");
  }

  warnings.sort();

  return {
    kind: "network_status",
    schemaVersion: 1,
    network: "solana-mainnet-beta",
    observedAtUnixMs: input.observedAtUnixMs,
    health: input.accepted.health,
    slot: input.accepted.slot,
    slotsBehind: input.accepted.slotsBehind,
    warnings
  };
}
