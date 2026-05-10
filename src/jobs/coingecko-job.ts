import { collectCoingecko, type CollectCoingeckoDeps } from "../application/collect-coingecko.js";

export function coingeckoJob(deps: CollectCoingeckoDeps): () => Promise<void> {
  return () => collectCoingecko(deps);
}
