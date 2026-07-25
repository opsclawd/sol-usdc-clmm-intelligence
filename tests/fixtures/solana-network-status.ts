export const HEALTHY_GET_HEALTH_RESPONSE = {
  jsonrpc: "2.0" as const,
  result: "ok",
  id: "health"
};

export const HEALTHY_GET_SLOT_RESPONSE = {
  jsonrpc: "2.0" as const,
  result: 250000000,
  id: "slot"
};

export const BEHIND_GET_HEALTH_RESPONSE = {
  jsonrpc: "2.0" as const,
  error: {
    code: -32005,
    message: "Node is behind by 12 slots",
    data: {
      numSlotsBehind: 12
    }
  },
  id: "health"
};

export const ERROR_GET_SLOT_RESPONSE = {
  jsonrpc: "2.0" as const,
  error: {
    code: -32603,
    message: "Internal error"
  },
  id: "slot"
};

export const ORDERED_HEALTHY_BATCH = [HEALTHY_GET_HEALTH_RESPONSE, HEALTHY_GET_SLOT_RESPONSE];

export const REVERSED_HEALTHY_BATCH = [HEALTHY_GET_SLOT_RESPONSE, HEALTHY_GET_HEALTH_RESPONSE];

export const BEHIND_HEALTH_BATCH = [BEHIND_GET_HEALTH_RESPONSE, HEALTHY_GET_SLOT_RESPONSE];

export const SLOT_ERROR_BATCH = [HEALTHY_GET_HEALTH_RESPONSE, ERROR_GET_SLOT_RESPONSE];

export const DUPLICATE_ID_BATCH = [HEALTHY_GET_HEALTH_RESPONSE, HEALTHY_GET_HEALTH_RESPONSE];

export const MISSING_ID_BATCH = [HEALTHY_GET_HEALTH_RESPONSE];

export const UNKNOWN_ID_BATCH = [
  HEALTHY_GET_HEALTH_RESPONSE,
  { jsonrpc: "2.0", result: "ok", id: "foo" }
];

export const WRONG_JSONRPC_BATCH = [
  { jsonrpc: "1.0", result: "ok", id: "health" },
  HEALTHY_GET_SLOT_RESPONSE
];

export const UNSAFE_NEGATIVE_SLOT_BATCH = [
  HEALTHY_GET_HEALTH_RESPONSE,
  { jsonrpc: "2.0", result: -5, id: "slot" }
];

export const UNSAFE_NEGATIVE_SLOTS_BEHIND_BATCH = [
  {
    jsonrpc: "2.0",
    error: {
      code: -32005,
      message: "Node is behind",
      data: { numSlotsBehind: -12 }
    },
    id: "health"
  },
  HEALTHY_GET_SLOT_RESPONSE
];

export const ARBITRARY_PROVIDER_FIELDS_BATCH = [
  {
    jsonrpc: "2.0",
    result: "ok",
    id: "health",
    extraField: "ignored",
    providerInfo: { name: "test-node" }
  },
  {
    jsonrpc: "2.0",
    result: 250000000,
    id: "slot",
    anotherExtra: 123
  }
];
