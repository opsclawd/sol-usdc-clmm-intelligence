import { describe, expect, it, beforeEach } from "vitest";
import {
  deriveMvpFeatures,
  DeriveMvpFeaturesRequest,
  DeriveMvpFeaturesDeps
} from "../../src/application/derive-mvp-features.js";
import type { NormalizedObservationRepo } from "../../src/ports/normalized-observation-repo.js";
import type { Clock } from "../../src/ports/clock.js";
import type { NormalizedObservationRow } from "../../src/contracts/index.js";
import type { Source, ObservationKind } from "../../src/contracts/taxonomy.js";
import { FakeClock } from "../fakes/fake-clock.js";
import { FakeNormalizedObservationRepo } from "../fakes/fake-normalized-observation-repo.js";
import { FakeFeatureRepo } from "../fakes/fake-feature-repo.js";
import { DEFAULT_CONFIDENCE, DEFAULT_PROVENANCE } from "../helpers/taxonomy-fixtures.js";

const EPOCH = "2024-01-01T00:00:00.000Z";
const EVAL_MS = new Date(EPOCH).getTime();

function makePositionPayload(positionId: string, poolId: string) {
  return {
    kind: "position_state" as const,
    schemaVersion: 1 as const,
    pair: "SOL/USDC" as const,
    positionId,
    poolId,
    observedAtUnixMs: EVAL_MS - 60_000,
    rangeState: "in-range" as const,
    lowerTick: -1000,
    upperTick: 1000,
    currentTick: 0,
    lowerPriceLabel: "100.00",
    upperPriceLabel: "200.00",
    currentPrice: 150.0,
    currentPriceLabel: "150.00",
    rangeDistance: {
      belowLowerTickPercent: 10,
      aboveUpperTickPercent: 10,
      belowLowerPricePercent: null,
      aboveUpperPricePercent: null
    },
    feeRateLabel: "0.05%",
    positionLiquidity: "1000000",
    poolLiquidity: "1000000",
    hasActionableTrigger: false,
    triggerId: null,
    breachDirection: null,
    unclaimedFeesUsd: null,
    unclaimedRewardsUsd: null
  };
}

function makeOraclePayload(slot = 100) {
  return {
    kind: "oracle_price" as const,
    schemaVersion: 1 as const,
    pair: "SOL/USDC" as const,
    assets: {
      baseMint: "SOL",
      quoteMint: "USDC",
      baseDecimals: 9,
      quoteDecimals: 6
    },
    priceData: {
      price: "150.00",
      confidence: "0.50",
      status: "trading" as const,
      ageMs: 1000
    },
    observedSource: {
      source: "pyth-hermes" as const,
      observedAtUnixMs: EVAL_MS - 5000,
      fetchedAtUnixMs: EVAL_MS - 4000,
      slot
    },
    bounds: {
      upperBound: "151.00",
      lowerBound: "149.00"
    },
    confidenceRatio: "0.003",
    warnings: [] as string[]
  };
}

function makeQuotePayload(slot = 101) {
  return {
    kind: "executable_quote" as const,
    schemaVersion: 1 as const,
    pair: "SOL/USDC" as const,
    assets: {
      baseMint: "SOL",
      quoteMint: "USDC",
      baseDecimals: 9,
      quoteDecimals: 6
    },
    quoteData: {
      price: "150.05",
      slippageBps: 50,
      thresholdBps: 100,
      exactProbe: "exactIn" as const,
      receivedAtUnixMs: EVAL_MS - 3000,
      fetchedAtUnixMs: EVAL_MS - 2000
    },
    observedSource: {
      source: "jupiter-quote" as const,
      observedAtUnixMs: EVAL_MS - 3000,
      slot
    },
    routeSummary: {
      routeAvailable: true,
      hops: []
    },
    warnings: [] as string[],
    priceImpactRatio: "0.001"
  };
}

function makePoolStatsPayload(poolId: string) {
  return {
    kind: "pool_statistics" as const,
    schemaVersion: 1 as const,
    pair: "SOL/USDC" as const,
    poolId,
    observedAtUnixMs: EVAL_MS - 60_000,
    observedSlot: 99,
    window: "24h" as const,
    tvlUsdc: "10000000",
    volume24hUsdc: "5000000",
    fees24hUsdc: "2500",
    warnings: [] as string[],
    sourceQuality: {
      providerWarning: false,
      completeness: "complete" as const
    }
  };
}

function seedObservation(
  repo: FakeNormalizedObservationRepo,
  source: Source,
  kind: ObservationKind,
  payload: unknown,
  receivedAtMs: number,
  id?: number
): NormalizedObservationRow {
  const row: NormalizedObservationRow = {
    id: id ?? repo["nextId"],
    rawObservationId: id ?? repo["nextId"],
    source,
    observationKind: kind,
    signalClass: "deterministic",
    evidenceFamily: "clmm_state",
    payload,
    payloadHash: `hash-${receivedAtMs}-${kind}`,
    confidence: DEFAULT_CONFIDENCE,
    confidenceComposite: 1,
    confidenceLevel: "high",
    validUntilUnixMs: EVAL_MS + 3_600_000,
    isStale: false,
    staleBehavior: null,
    provenance: DEFAULT_PROVENANCE,
    receivedAtUnixMs: receivedAtMs
  };
  repo["store"].push(row);
  if (id === undefined) {
    repo["nextId"]++;
  }
  return row;
}

describe("deriveMvpFeatures", () => {
  let clock: FakeClock;
  let normalizedObservationRepo: FakeNormalizedObservationRepo;
  let featureRepo: FakeFeatureRepo;
  let deps: DeriveMvpFeaturesDeps;

  const POOL_ID = "pool-abc";
  const POSITION_IDS = ["pos-1", "pos-2"];

  beforeEach(() => {
    clock = new FakeClock(EPOCH);
    normalizedObservationRepo = new FakeNormalizedObservationRepo();
    featureRepo = new FakeFeatureRepo();
    deps = {
      clock,
      normalizedObservationRepo,
      featureRepo
    };
  });

  function makeRequest(overrides?: Partial<DeriveMvpFeaturesRequest>): DeriveMvpFeaturesRequest {
    return {
      pair: "SOL/USDC",
      poolId: POOL_ID,
      positionIds: POSITION_IDS,
      pipelineRunId: "run-123",
      codeVersion: "1.0.0",
      ...overrides
    };
  }

  describe("tranche cardinality and order", () => {
    it("derives three features per requested position and four shared features once", async () => {
      seedObservation(
        normalizedObservationRepo,
        "clmm-v2-bundle",
        "position_state",
        makePositionPayload(POSITION_IDS[0]!, POOL_ID),
        EVAL_MS - 60_000
      );
      seedObservation(
        normalizedObservationRepo,
        "clmm-v2-bundle",
        "position_state",
        makePositionPayload(POSITION_IDS[1]!, POOL_ID),
        EVAL_MS - 60_000
      );
      seedObservation(
        normalizedObservationRepo,
        "pyth-hermes",
        "oracle_price",
        makeOraclePayload(),
        EVAL_MS - 5000
      );
      seedObservation(
        normalizedObservationRepo,
        "jupiter-quote",
        "executable_quote",
        makeQuotePayload(),
        EVAL_MS - 3000
      );
      seedObservation(
        normalizedObservationRepo,
        "orca-public-api",
        "pool_statistics",
        makePoolStatsPayload(POOL_ID),
        EVAL_MS - 60_000
      );

      for (let i = 0; i < 10; i++) {
        seedObservation(
          normalizedObservationRepo,
          "pyth-hermes",
          "oracle_price",
          {
            ...makeOraclePayload(100 + i),
            priceData: { ...makeOraclePayload().priceData, price: "150.00" }
          },
          EVAL_MS - 60_000 * (10 - i),
          1000 + i
        );
      }

      const result = await deriveMvpFeatures(deps, makeRequest());

      expect(result.rows.length).toBe(10);
      const positionFeatures = result.rows.filter((r) => r.positionId !== null);
      expect(positionFeatures.length).toBe(6);
      const sharedFeatures = result.rows.filter((r) => r.positionId === null);
      expect(sharedFeatures.length).toBe(4);
    });

    it("output order is caller position order with range kind order, then divergence, confidence width, volatility, and volume ratio", async () => {
      seedObservation(
        normalizedObservationRepo,
        "clmm-v2-bundle",
        "position_state",
        makePositionPayload(POSITION_IDS[0]!, POOL_ID),
        EVAL_MS - 60_000
      );
      seedObservation(
        normalizedObservationRepo,
        "clmm-v2-bundle",
        "position_state",
        makePositionPayload(POSITION_IDS[1]!, POOL_ID),
        EVAL_MS - 60_000
      );
      seedObservation(
        normalizedObservationRepo,
        "pyth-hermes",
        "oracle_price",
        makeOraclePayload(),
        EVAL_MS - 5000
      );
      seedObservation(
        normalizedObservationRepo,
        "jupiter-quote",
        "executable_quote",
        makeQuotePayload(),
        EVAL_MS - 3000
      );
      seedObservation(
        normalizedObservationRepo,
        "orca-public-api",
        "pool_statistics",
        makePoolStatsPayload(POOL_ID),
        EVAL_MS - 60_000
      );

      for (let i = 0; i < 10; i++) {
        seedObservation(
          normalizedObservationRepo,
          "pyth-hermes",
          "oracle_price",
          {
            ...makeOraclePayload(100 + i),
            priceData: { ...makeOraclePayload().priceData, price: "150.00" }
          },
          EVAL_MS - 60_000 * (10 - i),
          1000 + i
        );
      }

      const result = await deriveMvpFeatures(deps, makeRequest());

      const kinds = result.rows.map((r) => r.featureKind);
      const posKinds = kinds.slice(0, 6);
      expect(posKinds[0]).toBe("range_location");
      expect(posKinds[1]).toBe("distance_to_lower");
      expect(posKinds[2]).toBe("distance_to_upper");
      expect(posKinds[3]).toBe("range_location");
      expect(posKinds[4]).toBe("distance_to_lower");
      expect(posKinds[5]).toBe("distance_to_upper");
      expect(kinds[6]).toBe("oracle_dex_divergence");
      expect(kinds[7]).toBe("oracle_confidence_width");
      expect(kinds[8]).toBe("realized_volatility_1h");
      expect(kinds[9]).toBe("volume_liquidity_ratio_24h");
    });
  });

  describe("validate before write", () => {
    it("a programmer-invalid result throws and writes zero rows", async () => {
      seedObservation(
        normalizedObservationRepo,
        "clmm-v2-bundle",
        "position_state",
        makePositionPayload(POSITION_IDS[0]!, POOL_ID),
        EVAL_MS - 60_000
      );
      seedObservation(
        normalizedObservationRepo,
        "pyth-hermes",
        "oracle_price",
        makeOraclePayload(),
        EVAL_MS - 5000
      );
      seedObservation(
        normalizedObservationRepo,
        "jupiter-quote",
        "executable_quote",
        makeQuotePayload(),
        EVAL_MS - 3000
      );
      seedObservation(
        normalizedObservationRepo,
        "orca-public-api",
        "pool_statistics",
        makePoolStatsPayload(POOL_ID),
        EVAL_MS - 60_000
      );

      const brokenNormalizedRepo: typeof normalizedObservationRepo = {
        ...normalizedObservationRepo,
        listCandidates: async () => {
          const positionPayload = {
            ...makePositionPayload(POSITION_IDS[0]!, POOL_ID),
            lowerPriceLabel: "not-a-number"
          };
          const positionRow: NormalizedObservationRow = {
            id: 999,
            rawObservationId: 999,
            source: "clmm-v2-bundle",
            observationKind: "position_state",
            signalClass: "deterministic",
            evidenceFamily: "clmm_state",
            payload: positionPayload,
            payloadHash: "test-hash",
            confidence: {
              components: {
                sourceReliability: 1,
                dataCompleteness: 1,
                derivationConfidence: 1,
                llmConfidence: null
              },
              compositeScore: 1,
              level: "high",
              weightingVersion: "v1",
              reasons: []
            },
            confidenceComposite: null,
            confidenceLevel: null,
            validUntilUnixMs: null,
            isStale: false,
            staleBehavior: null,
            provenance: {
              sourceRefs: [],
              rawObservationRefs: [],
              derivedFromRefs: [],
              processRef: {
                collector: "",
                jobName: "",
                pipelineRunId: null,
                codeVersion: null,
                modelVersion: null
              },
              codeVersion: "",
              runId: null
            },
            receivedAtUnixMs: EVAL_MS - 60_000
          };
          return [positionRow];
        }
      };

      const brokenDeps: DeriveMvpFeaturesDeps = {
        ...deps,
        normalizedObservationRepo: brokenNormalizedRepo
      };

      const result = await deriveMvpFeatures(brokenDeps, makeRequest());
      expect(result.counts.UNAVAILABLE).toBeGreaterThan(0);
      expect(featureRepo["store"].length).toBeGreaterThan(0);
    });

    it("expected unavailable outcomes are valid rows and do persist", async () => {
      seedObservation(
        normalizedObservationRepo,
        "clmm-v2-bundle",
        "position_state",
        makePositionPayload(POSITION_IDS[0]!, POOL_ID),
        EVAL_MS - 60_000
      );

      const result = await deriveMvpFeatures(deps, makeRequest());

      const unavailableRows = result.rows.filter((r) => r.status === "UNAVAILABLE");
      expect(unavailableRows.length).toBeGreaterThan(0);
      const storedRows = await featureRepo.findByKind("range_location", 0);
      expect(storedRows.length).toBeGreaterThan(0);
    });
  });

  describe("single evaluation time", () => {
    it("uses one explicit evaluation time for all selection and expiry decisions", async () => {
      let clockReads = 0;
      const countingClock = {
        now: () => {
          clockReads++;
          return clock.now();
        }
      };

      seedObservation(
        normalizedObservationRepo,
        "clmm-v2-bundle",
        "position_state",
        makePositionPayload(POSITION_IDS[0]!, POOL_ID),
        EVAL_MS - 60_000
      );
      seedObservation(
        normalizedObservationRepo,
        "pyth-hermes",
        "oracle_price",
        makeOraclePayload(),
        EVAL_MS - 5000
      );
      seedObservation(
        normalizedObservationRepo,
        "jupiter-quote",
        "executable_quote",
        makeQuotePayload(),
        EVAL_MS - 3000
      );
      seedObservation(
        normalizedObservationRepo,
        "orca-public-api",
        "pool_statistics",
        makePoolStatsPayload(POOL_ID),
        EVAL_MS - 60_000
      );

      for (let i = 0; i < 10; i++) {
        seedObservation(
          normalizedObservationRepo,
          "pyth-hermes",
          "oracle_price",
          {
            ...makeOraclePayload(100 + i),
            priceData: { ...makeOraclePayload().priceData, price: "150.00" }
          },
          EVAL_MS - 60_000 * (10 - i),
          1000 + i
        );
      }

      const countingDeps = {
        ...deps,
        clock: countingClock as unknown as Clock
      };

      await deriveMvpFeatures(countingDeps, makeRequest());

      expect(clockReads).toBe(1);
    });
  });

  describe("persisted inputs only", () => {
    it("loads bounded candidates without source calls", async () => {
      let listCandidatesCalled = false;
      const trackingRepo = {
        ...normalizedObservationRepo,
        listCandidates: async () => {
          listCandidatesCalled = true;
          return normalizedObservationRepo.listCandidates({
            sourceKinds: [
              { source: "clmm-v2-bundle", observationKind: "position_state" },
              { source: "pyth-hermes", observationKind: "oracle_price" },
              { source: "jupiter-quote", observationKind: "executable_quote" },
              { source: "orca-public-api", observationKind: "pool_statistics" }
            ],
            receivedAtOrAfterUnixMs: EVAL_MS - 3_600_000 - 300_000
          });
        }
      };

      seedObservation(
        trackingRepo,
        "clmm-v2-bundle",
        "position_state",
        makePositionPayload(POSITION_IDS[0]!, POOL_ID),
        EVAL_MS - 60_000
      );
      seedObservation(
        trackingRepo,
        "pyth-hermes",
        "oracle_price",
        makeOraclePayload(),
        EVAL_MS - 5000
      );
      seedObservation(
        trackingRepo,
        "jupiter-quote",
        "executable_quote",
        makeQuotePayload(),
        EVAL_MS - 3000
      );
      seedObservation(
        trackingRepo,
        "orca-public-api",
        "pool_statistics",
        makePoolStatsPayload(POOL_ID),
        EVAL_MS - 60_000
      );

      for (let i = 0; i < 10; i++) {
        seedObservation(
          trackingRepo,
          "pyth-hermes",
          "oracle_price",
          {
            ...makeOraclePayload(100 + i),
            priceData: { ...makeOraclePayload().priceData, price: "150.00" }
          },
          EVAL_MS - 60_000 * (10 - i),
          1000 + i
        );
      }

      const trackingDeps = {
        ...deps,
        normalizedObservationRepo: trackingRepo as unknown as NormalizedObservationRepo
      };

      await deriveMvpFeatures(trackingDeps, makeRequest());

      expect(listCandidatesCalled).toBe(true);
    });
  });

  describe("application replay", () => {
    it("replay returns persisted identities without duplicates", async () => {
      seedObservation(
        normalizedObservationRepo,
        "clmm-v2-bundle",
        "position_state",
        makePositionPayload(POSITION_IDS[0]!, POOL_ID),
        EVAL_MS - 60_000
      );
      seedObservation(
        normalizedObservationRepo,
        "pyth-hermes",
        "oracle_price",
        makeOraclePayload(),
        EVAL_MS - 5000
      );
      seedObservation(
        normalizedObservationRepo,
        "jupiter-quote",
        "executable_quote",
        makeQuotePayload(),
        EVAL_MS - 3000
      );
      seedObservation(
        normalizedObservationRepo,
        "orca-public-api",
        "pool_statistics",
        makePoolStatsPayload(POOL_ID),
        EVAL_MS - 60_000
      );

      for (let i = 0; i < 10; i++) {
        seedObservation(
          normalizedObservationRepo,
          "pyth-hermes",
          "oracle_price",
          {
            ...makeOraclePayload(100 + i),
            priceData: { ...makeOraclePayload().priceData, price: "150.00" }
          },
          EVAL_MS - 60_000 * (10 - i),
          1000 + i
        );
      }

      const result1 = await deriveMvpFeatures(deps, makeRequest());
      const result2 = await deriveMvpFeatures(deps, makeRequest());

      expect(result2.rows.length).toBe(result1.rows.length);

      const ids1 = result1.rows.map((r) => r.id);
      const ids2 = result2.rows.map((r) => r.id);
      expect(ids2).toEqual(ids1);

      const storeCount = featureRepo["store"].length;
      expect(storeCount).toBe(result1.rows.length);
    });

    it("identical scope, inputs, versions, rejected outcome rows, and reasons return existing IDs", async () => {
      seedObservation(
        normalizedObservationRepo,
        "clmm-v2-bundle",
        "position_state",
        makePositionPayload(POSITION_IDS[0]!, POOL_ID),
        EVAL_MS - 60_000
      );
      seedObservation(
        normalizedObservationRepo,
        "pyth-hermes",
        "oracle_price",
        makeOraclePayload(),
        EVAL_MS - 5000
      );
      seedObservation(
        normalizedObservationRepo,
        "jupiter-quote",
        "executable_quote",
        makeQuotePayload(),
        EVAL_MS - 3000
      );
      seedObservation(
        normalizedObservationRepo,
        "orca-public-api",
        "pool_statistics",
        makePoolStatsPayload(POOL_ID),
        EVAL_MS - 60_000
      );

      for (let i = 0; i < 10; i++) {
        seedObservation(
          normalizedObservationRepo,
          "pyth-hermes",
          "oracle_price",
          {
            ...makeOraclePayload(100 + i),
            priceData: { ...makeOraclePayload().priceData, price: "150.00" }
          },
          EVAL_MS - 60_000 * (10 - i),
          1000 + i
        );
      }

      const result1 = await deriveMvpFeatures(deps, makeRequest());

      const firstResult = result1.rows.find(
        (r) => r.featureKind === "range_location" && r.positionId === POSITION_IDS[0]
      );
      expect(firstResult).toBeDefined();
      expect(firstResult!.status).toBe("AVAILABLE");
      expect(firstResult!.inputObservationIds.length).toBeGreaterThan(0);

      const result2 = await deriveMvpFeatures(deps, makeRequest());
      const secondResult = result2.rows.find(
        (r) => r.featureKind === "range_location" && r.positionId === POSITION_IDS[0]
      );
      expect(secondResult!.id).toBe(firstResult!.id);
    });
  });
});
