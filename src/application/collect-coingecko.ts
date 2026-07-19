import type { HttpClient } from "../ports/http.js";
import type { JsonStore } from "../ports/json-store.js";
import type { EnvReader } from "../ports/env.js";
import type { Clock } from "../ports/clock.js";

export interface CollectCoingeckoDeps {
  http: HttpClient;
  jsonStore: JsonStore;
  env: EnvReader;
  clock: Clock;
}

export const COINGECKO_OUTPUT_PATH = "data/latest-coingecko-solana-raw.json";
const URL =
  "https://api.coingecko.com/api/v3/coins/solana?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false";

export async function collectCoingecko(deps: CollectCoingeckoDeps): Promise<void> {
  const { http, jsonStore, env, clock } = deps;
  const apiKey = env.getOptional("COINGECKO_API_KEY");
  const raw = apiKey
    ? await http.getJson<unknown>(URL, { headers: { "x-cg-demo-api-key": apiKey } })
    : await http.getJson<unknown>(URL);
  await jsonStore.writeJson(COINGECKO_OUTPUT_PATH, {
    timestamp: clock.now(),
    source: "coingecko",
    raw
  });
}
