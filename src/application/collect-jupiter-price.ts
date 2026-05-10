import type { HttpClient } from "../ports/http.js";
import type { JsonStore } from "../ports/json-store.js";
import type { EnvReader } from "../ports/env.js";
import type { Clock } from "../ports/clock.js";

export interface CollectJupiterPriceDeps {
  http: HttpClient;
  jsonStore: JsonStore;
  env: EnvReader;
  clock: Clock;
}

interface JupiterPriceResponse {
  [mint: string]: {
    usdPrice?: number;
    blockId?: number;
    decimals?: number;
    priceChange24h?: number;
  };
}

export const PRICE_SNAPSHOT_PATH = "data/latest-price-snapshot.json";
const DEFAULT_SOL_MINT = "So11111111111111111111111111111111111111112";

export async function collectJupiterPrice(deps: CollectJupiterPriceDeps): Promise<void> {
  const { http, jsonStore, env, clock } = deps;
  const solMint = env.get("SOL_MINT", DEFAULT_SOL_MINT);
  const url = `https://lite-api.jup.ag/price/v3?ids=${encodeURIComponent(solMint)}`;
  const response = await http.getJson<JupiterPriceResponse>(url);
  const row = response[solMint];

  if (!row?.usdPrice) {
    throw new Error("Jupiter response did not include usdPrice for SOL");
  }

  await jsonStore.writeJson(PRICE_SNAPSHOT_PATH, {
    pair: "SOL/USDC",
    timestamp: clock.now(),
    source: "jupiter-price-v3",
    priceUsd: row.usdPrice,
    confidence: "high",
    raw: row
  });
}
