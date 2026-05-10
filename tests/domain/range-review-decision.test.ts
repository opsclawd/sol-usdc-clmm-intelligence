import { describe, expect, it } from "vitest";
import { makeRangeReviewDecision } from "../../src/domain/range-review-decision.js";
import type {
  PoolSnapshot,
  PositionSnapshot,
  PriceSnapshot
} from "../../src/contracts/snapshots.js";

const price: PriceSnapshot = {
  pair: "SOL/USDC",
  timestamp: "2026-05-10T12:00:00.000Z",
  source: "jupiter-price-v3",
  priceUsd: 175.4
};
const pool: PoolSnapshot = {
  pair: "SOL/USDC",
  timestamp: "2026-05-10T12:00:00.000Z",
  source: "fastify",
  spotPrice: 175.5,
  feeApr: 60
};
const position: PositionSnapshot = {
  pair: "SOL/USDC",
  timestamp: "2026-05-10T12:00:00.000Z",
  source: "fastify",
  inRange: true,
  lowerPrice: 150,
  upperPrice: 200,
  spotPrice: 175.5,
  distanceToLowerPercent: 15,
  distanceToUpperPercent: 14
};

describe("makeRangeReviewDecision", () => {
  it("returns hold / no rebalance / unchanged range when complete and healthy", () => {
    const out = makeRangeReviewDecision({ price, pool, position });
    expect(out.recommendedAction).toBe("hold");
    expect(out.shouldRebalance).toBe(false);
    expect(out.dataQuality).toBe("complete");
    expect(out.confidence).toBe("medium");
    expect(out.recommendedRange).toEqual({ type: "unchanged", widthBias: "unchanged" });
    expect(out.requiresHumanApproval).toBe(false);
    expect(out.executionPermittedByAgent).toBe(false);
  });

  it("returns exit_range with shouldRebalance true when out of range", () => {
    const out = makeRangeReviewDecision({
      price,
      pool,
      position: { ...position, inRange: false }
    });
    expect(out.recommendedAction).toBe("exit_range");
    expect(out.shouldRebalance).toBe(true);
    expect(out.recommendedRange).toEqual({
      type: "backend_must_calculate_exact_ticks",
      widthBias: "unchanged"
    });
    expect(out.confidence).toBe("high");
    expect(out.requiresHumanApproval).toBe(true);
  });

  it("returns widen_range with widthBias wider when near edge", () => {
    const out = makeRangeReviewDecision({
      price,
      pool,
      position: { ...position, distanceToLowerPercent: 2.5 }
    });
    expect(out.recommendedAction).toBe("widen_range");
    expect(out.shouldRebalance).toBe(true);
    expect(out.recommendedRange.widthBias).toBe("wider");
  });

  it("returns pause_rebalances and shouldRebalance false when stale", () => {
    const out = makeRangeReviewDecision({});
    expect(out.recommendedAction).toBe("pause_rebalances");
    expect(out.shouldRebalance).toBe(false);
    expect(out.riskLevel).toBe("critical");
    expect(out.dataQuality).toBe("stale");
    expect(out.recommendedRange.widthBias).toBe("wider");
    expect(out.recommendedRange.type).toBe("unchanged");
  });
});
