export interface AcceptedSolanaNetworkStatus {
  readonly health: "ok" | "behind";
  readonly slot: number | null;
  readonly slotsBehind: number | null;
  readonly slotUnavailable: boolean;
}

export class SolanaNetworkStatusValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SolanaNetworkStatusValidationError";
  }
}

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

export function acceptSolanaNetworkStatusBatch(input: unknown): AcceptedSolanaNetworkStatus {
  if (!Array.isArray(input) || input.length !== 2) {
    throw new SolanaNetworkStatusValidationError(
      "Input must be an array of exactly 2 JSON-RPC responses"
    );
  }

  let healthResponse: Record<string, unknown> | null = null;
  let slotResponse: Record<string, unknown> | null = null;

  for (const item of input) {
    if (!isObject(item)) {
      throw new SolanaNetworkStatusValidationError("RPC response item must be an object");
    }
    if (item.jsonrpc !== "2.0") {
      throw new SolanaNetworkStatusValidationError("RPC response jsonrpc must be '2.0'");
    }
    if (item.id === "health") {
      if (healthResponse !== null) {
        throw new SolanaNetworkStatusValidationError("Duplicate 'health' response id");
      }
      healthResponse = item;
    } else if (item.id === "slot") {
      if (slotResponse !== null) {
        throw new SolanaNetworkStatusValidationError("Duplicate 'slot' response id");
      }
      slotResponse = item;
    } else {
      throw new SolanaNetworkStatusValidationError(`Unknown response id '${String(item.id)}'`);
    }
  }

  if (healthResponse === null || slotResponse === null) {
    throw new SolanaNetworkStatusValidationError(
      "Batch must contain responses for both 'health' and 'slot'"
    );
  }

  // Parse health response
  let health: "ok" | "behind";
  let slotsBehind: number | null = null;

  const hasHealthResult = "result" in healthResponse;
  const hasHealthError = "error" in healthResponse;

  if (hasHealthResult && hasHealthError) {
    throw new SolanaNetworkStatusValidationError(
      "Health response cannot have both result and error"
    );
  }

  if (hasHealthResult) {
    if (healthResponse.result !== "ok") {
      throw new SolanaNetworkStatusValidationError(
        `Unexpected health result value: ${String(healthResponse.result)}`
      );
    }
    health = "ok";
  } else if (hasHealthError) {
    const err = healthResponse.error;
    if (!isObject(err) || err.code !== -32005) {
      throw new SolanaNetworkStatusValidationError(
        "Health error code must be -32005 for node behind"
      );
    }
    health = "behind";
    const data = err.data;
    if (!isObject(data) || typeof data.numSlotsBehind !== "number") {
      throw new SolanaNetworkStatusValidationError(
        "Node behind error must contain numSlotsBehind in data"
      );
    }
    const numSlots = data.numSlotsBehind;
    if (!Number.isInteger(numSlots) || numSlots < 0) {
      throw new SolanaNetworkStatusValidationError("numSlotsBehind must be a non-negative integer");
    }
    slotsBehind = numSlots;
  } else {
    throw new SolanaNetworkStatusValidationError("Health response must contain result or error");
  }

  // Parse slot response
  let slot: number | null = null;
  let slotUnavailable = false;

  const hasSlotResult = "result" in slotResponse;
  const hasSlotError = "error" in slotResponse;

  if (hasSlotResult && hasSlotError) {
    throw new SolanaNetworkStatusValidationError("Slot response cannot have both result and error");
  }

  if (hasSlotResult) {
    const s = slotResponse.result;
    if (typeof s !== "number" || !Number.isInteger(s) || s < 0) {
      throw new SolanaNetworkStatusValidationError("Slot result must be a non-negative integer");
    }
    slot = s;
  } else if (hasSlotError) {
    slot = null;
    slotUnavailable = true;
  } else {
    throw new SolanaNetworkStatusValidationError("Slot response must contain result or error");
  }

  return {
    health,
    slot,
    slotsBehind,
    slotUnavailable
  };
}
