import { describe, it, expect } from "vitest";
import {
  makeClmmBundle,
  makeClmmBundleEnvelope,
  makeSrLevels,
  makeFeeAmount,
  makeRewardAmount
} from "../../fixtures/clmm-bundle.js";
import {
  acceptClmmBundleEnvelope,
  acceptClmmBundle,
  ClmmBundleValidationError
} from "../../../src/domain/clmm-bundle/validate.js";

describe("acceptClmmBundleEnvelope", () => {
  describe("complete bundle cardinality", () => {
    it("accepts a complete bundle with zero positions and alerts", () => {
      const bundle = makeClmmBundle({ positions: [], alerts: [] });
      const envelope = makeClmmBundleEnvelope(bundle);
      const result = acceptClmmBundleEnvelope(envelope);
      expect(result.bundle.positions).toHaveLength(0);
      expect(result.bundle.alerts).toHaveLength(0);
    });

    it("accepts a complete bundle with multiple positions and alerts", () => {
      const bundle = makeClmmBundle({
        positions: [{}, {}],
        alerts: [{}, {}]
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      const result = acceptClmmBundleEnvelope(envelope);
      expect(result.bundle.positions).toHaveLength(2);
      expect(result.bundle.alerts).toHaveLength(2);
    });
  });

  describe("finite normalized inputs", () => {
    it("rejects NaN in pool currentPrice", () => {
      const bundle = makeClmmBundle({
        pool: { currentPrice: NaN }
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      expect(() => acceptClmmBundleEnvelope(envelope)).toThrow();
    });

    it("rejects Infinity in pool currentPrice", () => {
      const bundle = makeClmmBundle({
        pool: { currentPrice: Infinity }
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      expect(() => acceptClmmBundleEnvelope(envelope)).toThrow();
    });

    it("rejects -Infinity in pool currentPrice", () => {
      const bundle = makeClmmBundle({
        pool: { currentPrice: -Infinity }
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      expect(() => acceptClmmBundleEnvelope(envelope)).toThrow();
    });

    it("rejects NaN in position currentPrice", () => {
      const bundle = makeClmmBundle({
        positions: [{ currentPrice: NaN }]
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      expect(() => acceptClmmBundleEnvelope(envelope)).toThrow();
    });

    it("rejects Infinity in position lowerTick", () => {
      const bundle = makeClmmBundle({
        positions: [{ lowerTick: Infinity }]
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      expect(() => acceptClmmBundleEnvelope(envelope)).toThrow();
    });

    it("rejects NaN in fee amount decimals", () => {
      const bundle = makeClmmBundle({
        positions: [
          {
            unclaimedFees: {
              feeOwedA: makeFeeAmount({ decimals: NaN }),
              feeOwedB: makeFeeAmount()
            }
          }
        ]
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      expect(() => acceptClmmBundleEnvelope(envelope)).toThrow();
    });

    it("rejects Infinity in reward amount decimals", () => {
      const bundle = makeClmmBundle({
        positions: [
          {
            unclaimedRewards: [makeRewardAmount({ decimals: Infinity })]
          }
        ]
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      expect(() => acceptClmmBundleEnvelope(envelope)).toThrow();
    });

    it("rejects NaN in srLevels price", () => {
      const bundle = makeClmmBundle({
        srLevels: makeSrLevels({
          supports: [{ price: NaN }]
        })
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      expect(() => acceptClmmBundleEnvelope(envelope)).toThrow();
    });

    it("rejects Infinity in srLevels capturedAtUnixMs", () => {
      const bundle = makeClmmBundle({
        srLevels: makeSrLevels({ capturedAtUnixMs: Infinity })
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      expect(() => acceptClmmBundleEnvelope(envelope)).toThrow();
    });

    it("rejects NaN in observedAtUnixMs", () => {
      const bundle = makeClmmBundle({ observedAtUnixMs: NaN });
      const envelope = makeClmmBundleEnvelope(bundle);
      expect(() => acceptClmmBundleEnvelope(envelope)).toThrow();
    });

    it("rejects Infinity in observedAtUnixMs", () => {
      const bundle = makeClmmBundle({ observedAtUnixMs: Infinity });
      const envelope = makeClmmBundleEnvelope(bundle);
      expect(() => acceptClmmBundleEnvelope(envelope)).toThrow();
    });
  });

  describe("cross-record consistency", () => {
    it("rejects mismatched pair in bundle vs pool", () => {
      const bundle = makeClmmBundle({
        pool: { pair: "ETH/USDC" as unknown as "SOL/USDC" }
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      expect(() => acceptClmmBundleEnvelope(envelope)).toThrow();
    });

    it("rejects mismatched source in bundle vs pool", () => {
      const bundle = makeClmmBundle({
        pool: { source: "raydium" as unknown as "orca" }
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      expect(() => acceptClmmBundleEnvelope(envelope)).toThrow();
    });

    it("rejects mismatched poolId in position vs pool", () => {
      const bundle = makeClmmBundle({
        positions: [{ poolId: "wrong-pool-id" }]
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      expect(() => acceptClmmBundleEnvelope(envelope)).toThrow(ClmmBundleValidationError);
    });

    it("rejects mismatched pair in position vs pool", () => {
      const bundle = makeClmmBundle({
        positions: [{ pair: "ETH/USDC" as unknown as "SOL/USDC" }]
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      expect(() => acceptClmmBundleEnvelope(envelope)).toThrow();
    });

    it("rejects mismatched source in position vs pool", () => {
      const bundle = makeClmmBundle({
        positions: [{ source: "raydium" as unknown as "orca" }]
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      expect(() => acceptClmmBundleEnvelope(envelope)).toThrow();
    });

    it("rejects alert referencing non-existent positionId", () => {
      const bundle = makeClmmBundle({
        positions: [],
        alerts: [{ positionId: "non-existent-position" }]
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      expect(() => acceptClmmBundleEnvelope(envelope)).toThrow(ClmmBundleValidationError);
    });

    it("rejects alert referencing positionId with mismatched poolId", () => {
      const bundle = makeClmmBundle({
        positions: [{ positionId: "position-001", poolId: "pool-A" }],
        alerts: [{ positionId: "position-001", triggerId: "trigger-001" }]
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      expect(() => acceptClmmBundleEnvelope(envelope)).toThrow(ClmmBundleValidationError);
    });
  });

  describe("optional value acceptance", () => {
    it("accepts null srLevels", () => {
      const bundle = makeClmmBundle({ srLevels: null });
      const envelope = makeClmmBundleEnvelope(bundle);
      const result = acceptClmmBundleEnvelope(envelope);
      expect(result.bundle.srLevels).toBeNull();
    });

    it("accepts undefined rangeDistance.belowLowerPricePercent", () => {
      const bundle = makeClmmBundle({
        positions: [
          {
            rangeDistance: {
              belowLowerTickPercent: -3.1,
              aboveUpperTickPercent: 3.97
            }
          }
        ]
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      const result = acceptClmmBundleEnvelope(envelope);
      expect(result.bundle.positions[0]!.rangeDistance.belowLowerPricePercent).toBe(3.1);
    });

    it("accepts null unclaimedFeesUsd", () => {
      const bundle = makeClmmBundle({
        positions: [{ unclaimedFeesUsd: null }]
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      const result = acceptClmmBundleEnvelope(envelope);
      expect(result.bundle.positions[0]!.unclaimedFeesUsd).toBeNull();
    });

    it("accepts null unclaimedRewardsUsd", () => {
      const bundle = makeClmmBundle({
        positions: [{ unclaimedRewardsUsd: null }]
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      const result = acceptClmmBundleEnvelope(envelope);
      expect(result.bundle.positions[0]!.unclaimedRewardsUsd).toBeNull();
    });

    it("accepts null feeAmount.decimals", () => {
      const bundle = makeClmmBundle({
        positions: [
          {
            unclaimedFees: {
              feeOwedA: makeFeeAmount({ decimals: null }),
              feeOwedB: makeFeeAmount()
            }
          }
        ]
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      const result = acceptClmmBundleEnvelope(envelope);
      expect(result.bundle.positions[0]!.unclaimedFees.feeOwedA.decimals).toBeNull();
    });

    it("accepts undefined triggerId on position", () => {
      const bundle = makeClmmBundle({
        positions: [{ hasActionableTrigger: false }]
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      const result = acceptClmmBundleEnvelope(envelope);
      expect(result.bundle.positions[0]!.hasActionableTrigger).toBe(false);
    });

    it("accepts undefined breachDirection on position", () => {
      const bundle = makeClmmBundle({
        positions: [{}]
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      const result = acceptClmmBundleEnvelope(envelope);
      expect(result.bundle.positions[0]!.breachDirection).toBeUndefined();
    });

    it("accepts null srLevels.sourceRecordedAtIso", () => {
      const bundle = makeClmmBundle({
        srLevels: makeSrLevels({ sourceRecordedAtIso: null })
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      const result = acceptClmmBundleEnvelope(envelope);
      expect(result.bundle.srLevels?.sourceRecordedAtIso).toBeNull();
    });

    it("accepts null srLevels.summary", () => {
      const bundle = makeClmmBundle({
        srLevels: makeSrLevels({ summary: null })
      });
      const envelope = makeClmmBundleEnvelope(bundle);
      const result = acceptClmmBundleEnvelope(envelope);
      expect(result.bundle.srLevels?.summary).toBeNull();
    });
  });

  describe("envelope structure", () => {
    it("rejects missing bundle property", () => {
      expect(() => acceptClmmBundleEnvelope({ status: "ok" })).toThrow();
    });

    it("rejects non-object response", () => {
      expect(() => acceptClmmBundleEnvelope(null)).toThrow();
      expect(() => acceptClmmBundleEnvelope("string")).toThrow();
      expect(() => acceptClmmBundleEnvelope(123)).toThrow();
    });
  });
});

describe("acceptClmmBundle", () => {
  describe("complete bundle cardinality", () => {
    it("accepts a complete bundle with zero positions and alerts", () => {
      const bundle = makeClmmBundle({ positions: [], alerts: [] });
      const result = acceptClmmBundle(bundle);
      expect(result.positions).toHaveLength(0);
      expect(result.alerts).toHaveLength(0);
    });

    it("accepts a complete bundle with multiple positions and alerts", () => {
      const bundle = makeClmmBundle({
        positions: [{}, {}],
        alerts: [{}, {}]
      });
      const result = acceptClmmBundle(bundle);
      expect(result.positions).toHaveLength(2);
      expect(result.alerts).toHaveLength(2);
    });
  });

  describe("finite normalized inputs", () => {
    it("rejects NaN in pool currentPrice", () => {
      const bundle = makeClmmBundle({
        pool: { currentPrice: NaN }
      });
      expect(() => acceptClmmBundle(bundle)).toThrow();
    });

    it("rejects Infinity in pool currentPrice", () => {
      const bundle = makeClmmBundle({
        pool: { currentPrice: Infinity }
      });
      expect(() => acceptClmmBundle(bundle)).toThrow();
    });

    it("rejects NaN in position currentPrice", () => {
      const bundle = makeClmmBundle({
        positions: [{ currentPrice: NaN }]
      });
      expect(() => acceptClmmBundle(bundle)).toThrow();
    });

    it("rejects NaN in observedAtUnixMs", () => {
      const bundle = makeClmmBundle({ observedAtUnixMs: NaN });
      expect(() => acceptClmmBundle(bundle)).toThrow();
    });
  });

  describe("cross-record consistency", () => {
    it("rejects mismatched pair in position vs pool", () => {
      const bundle = makeClmmBundle({
        positions: [{ pair: "ETH/USDC" as unknown as "SOL/USDC" }]
      });
      expect(() => acceptClmmBundle(bundle)).toThrow();
    });

    it("rejects alert referencing non-existent positionId", () => {
      const bundle = makeClmmBundle({
        positions: [],
        alerts: [{ positionId: "non-existent" }]
      });
      expect(() => acceptClmmBundle(bundle)).toThrow(ClmmBundleValidationError);
    });
  });

  describe("optional value acceptance", () => {
    it("accepts null srLevels", () => {
      const bundle = makeClmmBundle({ srLevels: null });
      const result = acceptClmmBundle(bundle);
      expect(result.srLevels).toBeNull();
    });

    it("accepts null unclaimedFeesUsd", () => {
      const bundle = makeClmmBundle({
        positions: [{ unclaimedFeesUsd: null }]
      });
      const result = acceptClmmBundle(bundle);
      expect(result.positions[0]!.unclaimedFeesUsd).toBeNull();
    });
  });
});
