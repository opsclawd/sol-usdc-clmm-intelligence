export interface PythHermesParsedPrice {
  readonly price: string;
  readonly confidence: string;
  readonly exponent: number;
  readonly status: "trading" | "halted" | "auction" | "unknown";
  readonly timestamp: number;
}

export interface PythHermesEnvelope {
  readonly binary: string;
  readonly parsed: readonly PythHermesParsedPrice[];
}

export interface PythHermesPriceUpdate {
  readonly id: string;
  readonly price: PythHermesParsedPrice;
  readonly slot: number;
}

export const SOL_USD_FEED_ID = "0xef0d8b6fda2ceba41da15d4095d2da0a20eb45e80c3700d8e0ea47d0f1be8d9d";

export function makePythHermesParsedPrice(
  overrides?: Partial<PythHermesParsedPrice>
): PythHermesParsedPrice {
  return {
    price: "175000000",
    confidence: "1500000",
    exponent: -8,
    status: "trading",
    timestamp: 1710000000,
    ...overrides
  };
}

export function makePythHermesEnvelope(
  overrides?: Partial<PythHermesEnvelope>
): PythHermesEnvelope {
  return {
    binary: "base64encodedbinarydata",
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
  readonly extraField: string;
  readonly nested: { readonly data: number };
} {
  return {
    binary: "base64encodedbinarydata",
    parsed: [makePythHermesPriceUpdate()],
    extraField: "should be retained",
    nested: { data: 42 }
  };
}
