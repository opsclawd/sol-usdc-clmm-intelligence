import {
  collectJupiterPrice,
  type CollectJupiterPriceDeps
} from "../application/collect-jupiter-price.js";

export function jupiterPriceJob(deps: CollectJupiterPriceDeps): () => Promise<void> {
  return () => collectJupiterPrice(deps);
}
