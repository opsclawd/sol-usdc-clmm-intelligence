import { describe, it, expect } from "vitest";
import {
  acceptSolanaNetworkStatusBatch,
  SolanaNetworkStatusValidationError
} from "../../../src/domain/network-status/solana-rpc.js";
import {
  ORDERED_HEALTHY_BATCH,
  REVERSED_HEALTHY_BATCH,
  BEHIND_HEALTH_BATCH,
  SLOT_ERROR_BATCH,
  DUPLICATE_ID_BATCH,
  MISSING_ID_BATCH,
  UNKNOWN_ID_BATCH,
  WRONG_JSONRPC_BATCH,
  UNSAFE_NEGATIVE_SLOT_BATCH,
  UNSAFE_NEGATIVE_SLOTS_BEHIND_BATCH,
  ARBITRARY_PROVIDER_FIELDS_BATCH
} from "../../fixtures/solana-network-status.js";

describe("solana-rpc network status validation", () => {
  it("accepts healthy getHealth and getSlot responses regardless of batch order", () => {
    const ordered = acceptSolanaNetworkStatusBatch(ORDERED_HEALTHY_BATCH);
    expect(ordered).toEqual({
      health: "ok",
      slot: 250000000,
      slotsBehind: null,
      slotUnavailable: false
    });

    const reversed = acceptSolanaNetworkStatusBatch(REVERSED_HEALTHY_BATCH);
    expect(reversed).toEqual({
      health: "ok",
      slot: 250000000,
      slotsBehind: null,
      slotUnavailable: false
    });
  });

  it("accepts Solana node-behind error minus 32005 as degraded health evidence", () => {
    const behind = acceptSolanaNetworkStatusBatch(BEHIND_HEALTH_BATCH);
    expect(behind).toEqual({
      health: "behind",
      slot: 250000000,
      slotsBehind: 12,
      slotUnavailable: false
    });
  });

  it("accepts slot error response as slot: null and slotUnavailable: true", () => {
    const slotError = acceptSolanaNetworkStatusBatch(SLOT_ERROR_BATCH);
    expect(slotError).toEqual({
      health: "ok",
      slot: null,
      slotsBehind: null,
      slotUnavailable: true
    });
  });

  it("rejects duplicate missing unknown or mismatched JSON-RPC response ids", () => {
    expect(() => acceptSolanaNetworkStatusBatch(DUPLICATE_ID_BATCH)).toThrow(
      SolanaNetworkStatusValidationError
    );
    expect(() => acceptSolanaNetworkStatusBatch(MISSING_ID_BATCH)).toThrow(
      SolanaNetworkStatusValidationError
    );
    expect(() => acceptSolanaNetworkStatusBatch(UNKNOWN_ID_BATCH)).toThrow(
      SolanaNetworkStatusValidationError
    );
    expect(() => acceptSolanaNetworkStatusBatch(WRONG_JSONRPC_BATCH)).toThrow(
      SolanaNetworkStatusValidationError
    );
    expect(() => acceptSolanaNetworkStatusBatch(UNSAFE_NEGATIVE_SLOT_BATCH)).toThrow(
      SolanaNetworkStatusValidationError
    );
    expect(() => acceptSolanaNetworkStatusBatch(UNSAFE_NEGATIVE_SLOTS_BEHIND_BATCH)).toThrow(
      SolanaNetworkStatusValidationError
    );
  });

  it("ignores arbitrary provider extra fields", () => {
    const withExtra = acceptSolanaNetworkStatusBatch(ARBITRARY_PROVIDER_FIELDS_BATCH);
    expect(withExtra).toEqual({
      health: "ok",
      slot: 250000000,
      slotsBehind: null,
      slotUnavailable: false
    });
  });
});
