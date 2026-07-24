export type NetworkStatusWarning = "node_behind" | "slot_unavailable";

export interface NetworkStatusPayloadV1 {
  readonly kind: "network_status";
  readonly schemaVersion: 1;
  readonly network: "solana-mainnet-beta";
  readonly observedAtUnixMs: number;
  readonly health: "ok" | "behind";
  readonly slot: number | null;
  readonly slotsBehind: number | null;
  readonly warnings: readonly NetworkStatusWarning[];
}
