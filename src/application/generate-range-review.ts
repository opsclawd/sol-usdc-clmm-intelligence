import type { JsonStore } from "../ports/json-store.js";
import type { Clock } from "../ports/clock.js";
import type { PoolSnapshot, PositionSnapshot, PriceSnapshot } from "../contracts/snapshots.js";
import type { RangeReview } from "../contracts/outputs.js";
import { makeRangeReviewDecision } from "../domain/range-review-decision.js";

export interface GenerateRangeReviewDeps {
  jsonStore: JsonStore;
  clock: Clock;
}

export const RANGE_REVIEW_OUTPUT_PATH = "outputs/sol-usdc-rebalance-recommendation.json";

export async function generateRangeReview(deps: GenerateRangeReviewDeps): Promise<RangeReview> {
  const { jsonStore, clock } = deps;
  const [price, pool, position] = await Promise.all([
    jsonStore.readJson<PriceSnapshot>("data/latest-price-snapshot.json"),
    jsonStore.readJson<PoolSnapshot>("data/latest-pool-snapshot.json"),
    jsonStore.readJson<PositionSnapshot>("data/latest-position-snapshot.json")
  ]);

  const decision = makeRangeReviewDecision({
    ...(price != null ? { price } : {}),
    ...(pool != null ? { pool } : {}),
    ...(position != null ? { position } : {})
  });
  const output: RangeReview = { ...decision, timestamp: clock.now() };
  await jsonStore.writeJson(RANGE_REVIEW_OUTPUT_PATH, output);
  return output;
}
