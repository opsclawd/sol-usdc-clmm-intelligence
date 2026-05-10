import { collectDefillama, type CollectDefillamaDeps } from "../application/collect-defillama.js";

export function defillamaJob(deps: CollectDefillamaDeps): () => Promise<void> {
  return () => collectDefillama(deps);
}
