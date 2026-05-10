import type { HttpClient } from "../ports/http.js";
import type { JsonStore } from "../ports/json-store.js";
import type { Clock } from "../ports/clock.js";

export interface CollectDefillamaDeps {
  http: HttpClient;
  jsonStore: JsonStore;
  clock: Clock;
}

export const DEFILLAMA_OUTPUT_PATH = "data/latest-defillama-solana-raw.json";

export async function collectDefillama(deps: CollectDefillamaDeps): Promise<void> {
  const { http, jsonStore, clock } = deps;
  const raw = await http.getJson<unknown>("https://api.llama.fi/v2/chains");
  await jsonStore.writeJson(DEFILLAMA_OUTPUT_PATH, {
    timestamp: clock.now(),
    source: "defillama",
    raw
  });
}
