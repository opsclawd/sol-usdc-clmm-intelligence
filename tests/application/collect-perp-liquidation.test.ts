import { describe, expect, it } from "vitest";
import type { CollectionRunContext } from "../../src/contracts/collection-run.js";
import type {
  FundingRatePayloadV1,
  PerpCoverageRecordV1,
  PerpObservationKind
} from "../../src/contracts/perp-liquidation.js";
import type {
  PerpLiquidationSourceFact,
  PerpLiquidationSourceSnapshot
} from "../../src/ports/perp-liquidation-source.js";
import { FakePerpLiquidationSource } from "../fakes/fake-perp-liquidation-source.js";
import { FakeObservationRepo } from "../fakes/fake-observation-repo.js";
import { FakeNormalizedObservationRepo } from "../fakes/fake-normalized-observation-repo.js";
import { FakeFeatureRepo } from "../fakes/fake-feature-repo.js";
import { collectPerpLiquidation } from "../../src/application/collect-perp-liquidation.js";
import { derivePerpObservationKey } from "../../src/domain/perp-liquidation/index.js";
import { canonicalizePayload } from "../../src/domain/content-hash.js";

const VALID_CONTEXT: CollectionRunContext = Object.freeze({
  runId: "run-123",
  startedAtUnixMs: 1_700_000_000_000
});

const LOOKBACK_MS = 3_600_000;

function makeFundingRatePayload(overrides?: Partial<FundingRatePayloadV1>): FundingRatePayloadV1 {
  return {
    schemaVersion: 1,
    evidenceFamily: "perp_liquidation",
    pair: "SOL/USDC",
    venue: "binance-fapi",
    instrument: "SOLUSDC_PERP",
    sourceEventId: "fr-1",
    observedAtUnixMs: 1_699_999_900_000,
    kind: "funding_rate",
    fundingRate: "0.0001",
    fundingIntervalHours: 8,
    ...overrides
  };
}

function makeSnapshot(
  facts: PerpLiquidationSourceFact[] = [],
  coverageOverrides?: Record<PerpObservationKind, PerpCoverageRecordV1>
): PerpLiquidationSourceSnapshot {
  return {
    source: "binance-fapi",
    providerRunId: "run-001",
    asOfUnixMs: 1_700_000_000_000,
    coverage: coverageOverrides ?? {
      funding_rate: { kind: "funding_rate", status: "available" },
      open_interest: { kind: "open_interest", status: "available" },
      perp_basis: { kind: "perp_basis", status: "available" },
      liquidation_event: { kind: "liquidation_event", status: "available" },
      leverage_proxy: { kind: "leverage_proxy", status: "unavailable", diagnostic: "not_supported" }
    },
    facts
  };
}

describe("collectPerpLiquidation application use case", () => {
  it("transitions a new fact from absent to raw pending to normalized and raw parsed before feature insertion", async () => {
    const source = new FakePerpLiquidationSource();
    const rawRepo = new FakeObservationRepo();
    const normalizedRepo = new FakeNormalizedObservationRepo();
    const featureRepo = new FakeFeatureRepo();

    const frPayload = makeFundingRatePayload();
    source.setSnapshot(
      "binance-fapi",
      makeSnapshot([{ venue: "binance-fapi", kind: "funding_rate", payload: frPayload }])
    );

    const result = await collectPerpLiquidation(
      {
        source,
        rawObservationRepo: rawRepo,
        normalizedObservationRepo: normalizedRepo,
        derivedFeatureRepo: featureRepo
      },
      VALID_CONTEXT,
      { venue: "binance-fapi", lookbackMs: LOOKBACK_MS }
    );

    expect(result.status).toBe("accepted");
    expect(result.rawCount).toBe(1);
    expect(result.normalizedCount).toBe(1);
    expect(result.featureCount).toBeGreaterThan(0);

    const rawRows = await rawRepo.findBySource("binance-fapi", 0);
    expect(rawRows).toHaveLength(1);
    expect(rawRows[0]!.parseStatus).toBe("parsed");

    const normRows = await normalizedRepo.findBySource("binance-fapi", "funding_rate", 0);
    expect(normRows).toHaveLength(1);

    // Feature repo check
    const features = await featureRepo.findByKind("funding_rate_annualized", 0);
    expect(features).toHaveLength(1);
  });

  it("transitions an identical fact from parsed to replayed without duplicate normalized or feature rows", async () => {
    const source = new FakePerpLiquidationSource();
    const rawRepo = new FakeObservationRepo();
    const normalizedRepo = new FakeNormalizedObservationRepo();
    const featureRepo = new FakeFeatureRepo();

    const frPayload = makeFundingRatePayload();
    const snapshot = makeSnapshot([
      { venue: "binance-fapi", kind: "funding_rate", payload: frPayload }
    ]);
    source.setSnapshot("binance-fapi", snapshot);

    const res1 = await collectPerpLiquidation(
      {
        source,
        rawObservationRepo: rawRepo,
        normalizedObservationRepo: normalizedRepo,
        derivedFeatureRepo: featureRepo
      },
      VALID_CONTEXT,
      { venue: "binance-fapi", lookbackMs: LOOKBACK_MS }
    );
    expect(res1.status).toBe("accepted");

    const res2 = await collectPerpLiquidation(
      {
        source,
        rawObservationRepo: rawRepo,
        normalizedObservationRepo: normalizedRepo,
        derivedFeatureRepo: featureRepo
      },
      VALID_CONTEXT,
      { venue: "binance-fapi", lookbackMs: LOOKBACK_MS }
    );

    expect(res2.status).toBe("identical_replay");
    expect(res2.rawCount).toBe(1);
    expect(normalizedRepo.count).toBe(1);
  });

  it("transitions the same identity with a changed payload to conflict while preserving the immutable row", async () => {
    const source = new FakePerpLiquidationSource();
    const rawRepo = new FakeObservationRepo();
    const normalizedRepo = new FakeNormalizedObservationRepo();
    const featureRepo = new FakeFeatureRepo();

    const fr1 = makeFundingRatePayload({ fundingRate: "0.0001" });
    source.setSnapshot(
      "binance-fapi",
      makeSnapshot([{ venue: "binance-fapi", kind: "funding_rate", payload: fr1 }])
    );

    await collectPerpLiquidation(
      {
        source,
        rawObservationRepo: rawRepo,
        normalizedObservationRepo: normalizedRepo,
        derivedFeatureRepo: featureRepo
      },
      VALID_CONTEXT,
      { venue: "binance-fapi", lookbackMs: LOOKBACK_MS }
    );

    const fr2 = makeFundingRatePayload({ fundingRate: "0.0009" }); // same sourceEventId & observedAt => same identity, different payload
    source.setSnapshot(
      "binance-fapi",
      makeSnapshot([{ venue: "binance-fapi", kind: "funding_rate", payload: fr2 }])
    );

    const res2 = await collectPerpLiquidation(
      {
        source,
        rawObservationRepo: rawRepo,
        normalizedObservationRepo: normalizedRepo,
        derivedFeatureRepo: featureRepo
      },
      VALID_CONTEXT,
      { venue: "binance-fapi", lookbackMs: LOOKBACK_MS }
    );

    expect(res2.status).toBe("failed");
    const rawRows = await rawRepo.findBySource("binance-fapi", 0);
    expect(rawRows[0]!.payloadCanonical).toContain("0.0001");
  });

  it("recovers a stuck raw pending row by completing normalization and marking raw parsed on subsequent runs", async () => {
    const source = new FakePerpLiquidationSource();
    const rawRepo = new FakeObservationRepo();
    const normalizedRepo = new FakeNormalizedObservationRepo();
    const featureRepo = new FakeFeatureRepo();

    const frPayload = makeFundingRatePayload();
    const snapshot = makeSnapshot([
      { venue: "binance-fapi", kind: "funding_rate", payload: frPayload }
    ]);
    source.setSnapshot("binance-fapi", snapshot);

    const sourceObservationKey = await derivePerpObservationKey(frPayload, snapshot.providerRunId);
    const { payloadCanonical, payloadHash } = await canonicalizePayload(frPayload);

    // Pre-insert raw row with parseStatus 'pending'
    await rawRepo.insertOrClassify({
      source: "binance-fapi",
      sourceObservationKey,
      observedAtUnixMs: frPayload.observedAtUnixMs,
      fetchedAtUnixMs: 1_700_000_000_000,
      payloadHash,
      payloadCanonical,
      parseStatus: "pending",
      receivedAtUnixMs: 1_700_000_000_000
    });

    // Run collection
    const result = await collectPerpLiquidation(
      {
        source,
        rawObservationRepo: rawRepo,
        normalizedObservationRepo: normalizedRepo,
        derivedFeatureRepo: featureRepo
      },
      VALID_CONTEXT,
      { venue: "binance-fapi", lookbackMs: LOOKBACK_MS }
    );

    expect(result.status).toBe("accepted");
    expect(result.rawCount).toBe(1);
    expect(result.normalizedCount).toBe(1);

    const rawRows = await rawRepo.findBySource("binance-fapi", 0);
    expect(rawRows).toHaveLength(1);
    expect(rawRows[0]!.parseStatus).toBe("parsed");

    const normRows = await normalizedRepo.findBySource("binance-fapi", "funding_rate", 0);
    expect(normRows).toHaveLength(1);
  });

  it("persists stale observations and PARTIAL features with stale_input_degraded", async () => {
    const source = new FakePerpLiquidationSource();
    const rawRepo = new FakeObservationRepo();
    const normalizedRepo = new FakeNormalizedObservationRepo();
    const featureRepo = new FakeFeatureRepo();

    // Very old observation => stale
    const oldObservedAt = 1_700_000_000_000 - 365 * 24 * 3600 * 1000;
    const frPayload = makeFundingRatePayload({ observedAtUnixMs: oldObservedAt });
    source.setSnapshot(
      "binance-fapi",
      makeSnapshot([{ venue: "binance-fapi", kind: "funding_rate", payload: frPayload }])
    );

    const result = await collectPerpLiquidation(
      {
        source,
        rawObservationRepo: rawRepo,
        normalizedObservationRepo: normalizedRepo,
        derivedFeatureRepo: featureRepo
      },
      VALID_CONTEXT,
      { venue: "binance-fapi", lookbackMs: 365 * 24 * 3600 * 1000 }
    );

    expect(result.status).toBe("degraded");
  });

  it("returns degraded coverage without zero-valued evidence when a metric is unavailable", async () => {
    const source = new FakePerpLiquidationSource();
    const rawRepo = new FakeObservationRepo();
    const normalizedRepo = new FakeNormalizedObservationRepo();
    const featureRepo = new FakeFeatureRepo();

    source.setSnapshot(
      "binance-fapi",
      makeSnapshot([], {
        funding_rate: {
          kind: "funding_rate",
          status: "unavailable",
          diagnostic: "source API error"
        },
        open_interest: { kind: "open_interest", status: "available" },
        perp_basis: { kind: "perp_basis", status: "available" },
        liquidation_event: { kind: "liquidation_event", status: "available" },
        leverage_proxy: {
          kind: "leverage_proxy",
          status: "unavailable",
          diagnostic: "not_supported"
        }
      })
    );

    const result = await collectPerpLiquidation(
      {
        source,
        rawObservationRepo: rawRepo,
        normalizedObservationRepo: normalizedRepo,
        derivedFeatureRepo: featureRepo
      },
      VALID_CONTEXT,
      { venue: "binance-fapi", lookbackMs: LOOKBACK_MS }
    );

    expect(result.status).toBe("degraded");
    expect(result.coverage.funding_rate.status).toBe("unavailable");
  });

  it("continues processing valid facts after one malformed fact", async () => {
    const source = new FakePerpLiquidationSource();
    const rawRepo = new FakeObservationRepo();
    const normalizedRepo = new FakeNormalizedObservationRepo();
    const featureRepo = new FakeFeatureRepo();

    const malformedFact: PerpLiquidationSourceFact = {
      venue: "binance-fapi",
      kind: "funding_rate",
      payload: { invalid: true } as unknown as FundingRatePayloadV1
    };
    const validFact: PerpLiquidationSourceFact = {
      venue: "binance-fapi",
      kind: "funding_rate",
      payload: makeFundingRatePayload()
    };

    source.setSnapshot("binance-fapi", makeSnapshot([malformedFact, validFact]));

    const result = await collectPerpLiquidation(
      {
        source,
        rawObservationRepo: rawRepo,
        normalizedObservationRepo: normalizedRepo,
        derivedFeatureRepo: featureRepo
      },
      VALID_CONTEXT,
      { venue: "binance-fapi", lookbackMs: LOOKBACK_MS }
    );

    expect(result.status).toBe("partial");
    expect(result.rawCount).toBe(1);
    expect(result.normalizedCount).toBe(1);
  });
});
