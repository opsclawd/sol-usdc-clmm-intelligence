import type {
  PythHermesEnvelope,
  PythHermesPriceUpdate,
  PythHermesParsedPrice
} from "../../src/domain/price-observation/pyth.js";

export { PythHermesEnvelope, PythHermesPriceUpdate, PythHermesParsedPrice };

export const SOL_USD_FEED_ID = "0xef0d8b6fda2ceba41da15d4095d2da0a20eb45e80c3700d8e0ea47d0f1be8d9d";

export function makePythHermesParsedPrice(
  overrides?: Partial<PythHermesParsedPrice>
): PythHermesParsedPrice {
  return {
    price: "175000000",
    conf: "1500000",
    expo: -8,
    publish_time: 1710000000,
    ...overrides
  };
}

export function makePythHermesEnvelope(
  overrides?: Partial<PythHermesEnvelope>
): PythHermesEnvelope {
  return {
    binary: { encoding: "hex", data: ["504e41550100"] },
    parsed: [makePythHermesPriceUpdate()],
    ...overrides
  };
}

export function makePythHermesPriceUpdate(
  overrides?: Partial<PythHermesPriceUpdate>
): PythHermesPriceUpdate {
  return {
    id: SOL_USD_FEED_ID,
    price: makePythHermesParsedPrice(),
    slot: 123456789,
    ...overrides
  };
}

export function makePythHermesEnvelopeWithExtraFields(): PythHermesEnvelope & {
  extraField: string;
  nested: { data: number };
} {
  return {
    binary: { encoding: "hex", data: ["504e41550100"] },
    parsed: [makePythHermesPriceUpdate()],
    extraField: "should be retained",
    nested: { data: 42 }
  };
}
