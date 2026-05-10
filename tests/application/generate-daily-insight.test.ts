import { describe, expect, it } from "vitest";
import { generateDailyInsight } from "../../src/application/generate-daily-insight.js";
import { FakeJsonStore, FakeClock } from "../fakes/index.js";

describe("generateDailyInsight", () => {
  it("reads snapshots, writes outputs/sol-usdc-daily-insight.json, returns the output", async () => {
    const jsonStore = new FakeJsonStore();
    jsonStore.seed("data/latest-price-snapshot.json", {
      pair: "SOL/USDC",
      timestamp: "2026-05-10T12:00:00.000Z",
      source: "jupiter-price-v3",
      priceUsd: 175.4,
      confidence: "high"
    });
    jsonStore.seed("data/latest-pool-snapshot.json", {
      pair: "SOL/USDC",
      timestamp: "2026-05-10T12:00:00.000Z",
      source: "fastify",
      spotPrice: 175.5,
      feeApr: 60
    });
    jsonStore.seed("data/latest-position-snapshot.json", {
      pair: "SOL/USDC",
      timestamp: "2026-05-10T12:00:00.000Z",
      source: "fastify",
      inRange: true,
      lowerPrice: 150,
      upperPrice: 200,
      spotPrice: 175.5,
      distanceToLowerPercent: 15,
      distanceToUpperPercent: 14
    });
    const clock = new FakeClock("2026-05-10T13:00:00.000Z");

    const result = await generateDailyInsight({ jsonStore, clock });

    expect(jsonStore.writes).toHaveLength(1);
    expect(jsonStore.writes[0]).toEqual({
      path: "outputs/sol-usdc-daily-insight.json",
      value: expect.objectContaining({
        timestamp: "2026-05-10T13:00:00.000Z",
        recommendedAction: "hold",
        dataQuality: "complete"
      })
    });
    expect(result.timestamp).toBe("2026-05-10T13:00:00.000Z");
    expect(result.recommendedAction).toBe("hold");
  });

  it("emits stale-quality output when no snapshots are present", async () => {
    const jsonStore = new FakeJsonStore();
    const clock = new FakeClock("2026-05-10T14:00:00.000Z");

    const result = await generateDailyInsight({ jsonStore, clock });

    expect(result.dataQuality).toBe("stale");
    expect(result.recommendedAction).toBe("pause_rebalances");
    expect(jsonStore.writes).toHaveLength(1);
  });
});
