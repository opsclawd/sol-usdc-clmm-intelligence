import { describe, it, expect } from "vitest";
import { makeClmmBundle, makeFeeAmount } from "../../fixtures/clmm-bundle.js";
import { normalizeClmmBundle } from "../../../src/domain/clmm-bundle/normalize.js";

describe("normalizeClmmBundle", () => {
  describe("fact cardinality", () => {
    it("maps one pool and data-quality candidate plus one position and fee candidate per position and one trigger per alert", () => {
      const bundle = makeClmmBundle({
        positions: [
          {
            positionId: "position-001",
            triggerId: "trigger-001",
            hasActionableTrigger: true
          },
          {
            positionId: "position-002",
            triggerId: "trigger-002",
            hasActionableTrigger: true
          }
        ],
        alerts: [
          { triggerId: "trigger-001", positionId: "position-001" },
          { triggerId: "trigger-002", positionId: "position-002" }
        ]
      });

      const candidates = normalizeClmmBundle(bundle);

      const poolCandidates = candidates.filter((c) => c.kind === "pool_state");
      const dataQualityCandidates = candidates.filter((c) => c.kind === "data_quality");
      const positionCandidates = candidates.filter((c) => c.kind === "position_state");
      const feeCandidates = candidates.filter((c) => c.kind === "fee_metrics");
      const triggerCandidates = candidates.filter((c) => c.kind === "trigger_event");

      expect(poolCandidates).toHaveLength(1);
      expect(dataQualityCandidates).toHaveLength(1);
      expect(positionCandidates).toHaveLength(2);
      expect(feeCandidates).toHaveLength(2);
      expect(triggerCandidates).toHaveLength(2);
    });

    it("maps only pool_state and data_quality for empty bundle", () => {
      const bundle = makeClmmBundle({
        positions: [],
        alerts: []
      });

      const candidates = normalizeClmmBundle(bundle);
      const kinds = [...new Set(candidates.map((c) => c.kind))];

      expect(kinds).toHaveLength(2);
      expect(kinds).toContain("pool_state");
      expect(kinds).toContain("data_quality");
    });
  });

  describe("empty collection semantics", () => {
    it("maps an empty positions and alerts bundle to only pool_state and data_quality", () => {
      const bundle = makeClmmBundle({
        positions: [],
        alerts: []
      });

      const candidates = normalizeClmmBundle(bundle);

      expect(candidates).toHaveLength(2);
      expect(candidates[0]!.kind).toBe("pool_state");
      expect(candidates[1]!.kind).toBe("data_quality");
    });

    it("does not fabricate absence events for empty positions array", () => {
      const bundle = makeClmmBundle({
        positions: [],
        alerts: []
      });

      const candidates = normalizeClmmBundle(bundle);
      const positionCandidates = candidates.filter((c) => c.kind === "position_state");
      const feeCandidates = candidates.filter((c) => c.kind === "fee_metrics");

      expect(positionCandidates).toHaveLength(0);
      expect(feeCandidates).toHaveLength(0);
    });

    it("does not fabricate absence events for empty alerts array", () => {
      const bundle = makeClmmBundle({
        positions: [],
        alerts: []
      });

      const candidates = normalizeClmmBundle(bundle);
      const triggerCandidates = candidates.filter((c) => c.kind === "trigger_event");

      expect(triggerCandidates).toHaveLength(0);
    });
  });

  describe("absence preservation", () => {
    it("materializes unavailable optional values as null while retaining zero false empty arrays and decimal strings", () => {
      const bundle = makeClmmBundle({
        positions: [
          {
            unclaimedFeesUsd: null,
            unclaimedRewardsUsd: null,
            triggerId: undefined,
            breachDirection: undefined,
            unclaimedRewards: []
          }
        ],
        alerts: []
      });

      const candidates = normalizeClmmBundle(bundle);
      const positionCandidate = candidates.find((c) => c.kind === "position_state")!;
      const feeCandidate = candidates.find((c) => c.kind === "fee_metrics")!;

      expect(positionCandidate.unclaimedFeesUsd).toBeNull();
      expect(positionCandidate.unclaimedRewardsUsd).toBeNull();
      expect(positionCandidate.triggerId).toBeNull();
      expect(positionCandidate.breachDirection).toBeNull();

      expect(feeCandidate.unclaimedFeesUsd).toBeNull();
      expect(feeCandidate.unclaimedRewardsUsd).toBeNull();
    });

    it("retains zero values in fee amounts", () => {
      const bundle = makeClmmBundle({
        positions: [
          {
            unclaimedFees: {
              feeOwedA: makeFeeAmount({ raw: "0", decimals: 6 }),
              feeOwedB: makeFeeAmount({ raw: "0", decimals: 6 })
            }
          }
        ],
        alerts: []
      });

      const candidates = normalizeClmmBundle(bundle);
      const feeCandidate = candidates.find((c) => c.kind === "fee_metrics")!;

      expect(feeCandidate.feeOwedA.raw).toBe("0");
      expect(feeCandidate.feeOwedB.raw).toBe("0");
    });

    it("retains empty arrays in rewards", () => {
      const bundle = makeClmmBundle({
        positions: [
          {
            unclaimedRewards: []
          }
        ],
        alerts: []
      });

      const candidates = normalizeClmmBundle(bundle);
      const feeCandidate = candidates.find((c) => c.kind === "fee_metrics")!;

      expect(feeCandidate.unclaimedRewards).toEqual([]);
    });

    it("retains false hasActionableTrigger", () => {
      const bundle = makeClmmBundle({
        positions: [
          {
            hasActionableTrigger: false
          }
        ],
        alerts: []
      });

      const candidates = normalizeClmmBundle(bundle);
      const positionCandidate = candidates.find((c) => c.kind === "position_state")!;

      expect(positionCandidate.hasActionableTrigger).toBe(false);
    });
  });

  describe("stable entity identity", () => {
    it("includes stable poolId positionId or triggerId in every multi-entity payload", () => {
      const bundle = makeClmmBundle({
        positions: [
          {
            positionId: "position-001",
            poolId: "pool-solusdc-123",
            triggerId: "trigger-001",
            hasActionableTrigger: true
          }
        ],
        alerts: [{ triggerId: "trigger-001", positionId: "position-001" }]
      });

      const candidates = normalizeClmmBundle(bundle);

      const poolCandidate = candidates.find((c) => c.kind === "pool_state")!;
      expect(poolCandidate.poolId).toBe("pool-solusdc-123");

      const positionCandidate = candidates.find((c) => c.kind === "position_state")!;
      expect(positionCandidate.poolId).toBe("pool-solusdc-123");
      expect(positionCandidate.positionId).toBe("position-001");

      const feeCandidate = candidates.find((c) => c.kind === "fee_metrics")!;
      expect(feeCandidate.positionId).toBe("position-001");

      const triggerCandidate = candidates.find((c) => c.kind === "trigger_event")!;
      expect(triggerCandidate.positionId).toBe("position-001");
      expect(triggerCandidate.triggerId).toBe("trigger-001");
    });
  });

  describe("normalization scope boundary", () => {
    it("does not normalize srLevels or emit volume_metrics", () => {
      const bundle = makeClmmBundle({
        srLevels: {
          briefId: "brief-001",
          sourceRecordedAtIso: "2024-01-15T10:30:00.000Z",
          summary: "SOL/USDC resistance at 150.5",
          capturedAtUnixMs: 1705315800000,
          supports: [{ price: 140.0 }],
          resistances: [{ price: 150.5 }]
        }
      });

      const candidates = normalizeClmmBundle(bundle);
      const kinds = candidates.map((c) => c.kind);

      expect(kinds).not.toContain("sr_levels");
      expect(kinds).not.toContain("volume_metrics");
    });

    it("excludes srLevels even when present in bundle", () => {
      const bundle = makeClmmBundle({
        srLevels: {
          briefId: "brief-001",
          sourceRecordedAtIso: "2024-01-15T10:30:00.000Z",
          summary: "key resistance",
          capturedAtUnixMs: 1705315800000,
          supports: [{ price: 140.0 }],
          resistances: [{ price: 150.5 }]
        },
        positions: [],
        alerts: []
      });

      const candidates = normalizeClmmBundle(bundle);

      expect(candidates).toHaveLength(2);
      expect(candidates[0]!.kind).toBe("pool_state");
      expect(candidates[1]!.kind).toBe("data_quality");
    });
  });

  describe("output ordering", () => {
    it("produces candidates in deterministic order: pool, positions in input order with their fees, alerts in input order, then data quality", () => {
      const bundle = makeClmmBundle({
        positions: [{ positionId: "position-001" }, { positionId: "position-002" }],
        alerts: [{ triggerId: "trigger-001", positionId: "position-001" }]
      });

      const candidates = normalizeClmmBundle(bundle);

      expect(candidates[0]!.kind).toBe("pool_state");
      expect(candidates[1]!.kind).toBe("position_state");
      expect(candidates[1]!).toHaveProperty("positionId", "position-001");
      expect(candidates[2]!.kind).toBe("fee_metrics");
      expect(candidates[2]!).toHaveProperty("positionId", "position-001");
      expect(candidates[3]!.kind).toBe("position_state");
      expect(candidates[3]!).toHaveProperty("positionId", "position-002");
      expect(candidates[4]!.kind).toBe("fee_metrics");
      expect(candidates[4]!).toHaveProperty("positionId", "position-002");
      expect(candidates[5]!.kind).toBe("trigger_event");
      expect(candidates[5]!).toHaveProperty("triggerId", "trigger-001");
      expect(candidates[6]!.kind).toBe("data_quality");
    });
  });

  describe("complete payload structure", () => {
    it("pool_state candidate includes all required fields", () => {
      const bundle = makeClmmBundle();

      const candidates = normalizeClmmBundle(bundle);
      const poolCandidate = candidates.find((c) => c.kind === "pool_state")!;

      expect(poolCandidate).toMatchObject({
        kind: "pool_state",
        schemaVersion: 1,
        pair: "SOL/USDC",
        poolId: "pool-solusdc-123",
        observedAtUnixMs: 1705315800000
      });
      expect(poolCandidate).toHaveProperty("currentPrice");
      expect(poolCandidate).toHaveProperty("sqrtPrice");
      expect(poolCandidate).toHaveProperty("tickCurrentIndex");
      expect(poolCandidate).toHaveProperty("feeRate");
      expect(poolCandidate).toHaveProperty("poolLiquidity");
    });

    it("position_state candidate includes all required fields", () => {
      const bundle = makeClmmBundle({
        positions: [{ positionId: "position-001" }]
      });

      const candidates = normalizeClmmBundle(bundle);
      const positionCandidate = candidates.find((c) => c.kind === "position_state")!;

      expect(positionCandidate).toMatchObject({
        kind: "position_state",
        schemaVersion: 1,
        pair: "SOL/USDC",
        positionId: "position-001",
        poolId: "pool-solusdc-123",
        observedAtUnixMs: 1705315800000
      });
      expect(positionCandidate).toHaveProperty("rangeState");
      expect(positionCandidate).toHaveProperty("lowerTick");
      expect(positionCandidate).toHaveProperty("upperTick");
      expect(positionCandidate).toHaveProperty("currentTick");
      expect(positionCandidate).toHaveProperty("positionLiquidity");
      expect(positionCandidate).toHaveProperty("hasActionableTrigger");
    });

    it("fee_metrics candidate includes all required fields", () => {
      const bundle = makeClmmBundle({
        positions: [{ positionId: "position-001" }]
      });

      const candidates = normalizeClmmBundle(bundle);
      const feeCandidate = candidates.find((c) => c.kind === "fee_metrics")!;

      expect(feeCandidate).toMatchObject({
        kind: "fee_metrics",
        schemaVersion: 1,
        pair: "SOL/USDC",
        positionId: "position-001",
        observedAtUnixMs: 1705315800000
      });
      expect(feeCandidate).toHaveProperty("feeOwedA");
      expect(feeCandidate).toHaveProperty("feeOwedB");
      expect(feeCandidate).toHaveProperty("feeOwedA.raw");
      expect(feeCandidate).toHaveProperty("feeOwedB.raw");
    });

    it("trigger_event candidate includes all required fields", () => {
      const bundle = makeClmmBundle({
        positions: [
          { positionId: "position-001", triggerId: "trigger-001", hasActionableTrigger: true }
        ],
        alerts: [{ triggerId: "trigger-001", positionId: "position-001" }]
      });

      const candidates = normalizeClmmBundle(bundle);
      const triggerCandidate = candidates.find((c) => c.kind === "trigger_event")!;

      expect(triggerCandidate).toMatchObject({
        kind: "trigger_event",
        schemaVersion: 1,
        pair: "SOL/USDC",
        positionId: "position-001",
        triggerId: "trigger-001",
        observedAtUnixMs: 1705315800000
      });
      expect(triggerCandidate).toHaveProperty("breachDirection");
      expect(triggerCandidate).toHaveProperty("triggeredAt");
    });

    it("data_quality candidate includes all required fields", () => {
      const bundle = makeClmmBundle({
        dataQuality: { warnings: ["test warning"], isPartial: true, missingSources: ["source-1"] }
      });

      const candidates = normalizeClmmBundle(bundle);
      const dataQualityCandidate = candidates.find((c) => c.kind === "data_quality")!;

      expect(dataQualityCandidate).toMatchObject({
        kind: "data_quality",
        schemaVersion: 1,
        pair: "SOL/USDC",
        observedAtUnixMs: 1705315800000
      });
      expect(dataQualityCandidate).toHaveProperty("warnings");
      expect(dataQualityCandidate).toHaveProperty("isPartial");
      expect(dataQualityCandidate).toHaveProperty("missingSources");
    });
  });

  describe("defensive validation", () => {
    it("handles trigger referencing valid position", () => {
      const bundle = makeClmmBundle({
        positions: [
          { positionId: "position-001", triggerId: "trigger-001", hasActionableTrigger: true }
        ],
        alerts: [{ triggerId: "trigger-001", positionId: "position-001" }]
      });

      const candidates = normalizeClmmBundle(bundle);
      const triggerCandidate = candidates.find((c) => c.kind === "trigger_event")!;

      expect(triggerCandidate.positionId).toBe("position-001");
      expect(triggerCandidate.triggerId).toBe("trigger-001");
    });
  });
});
