import { describe, it, expect } from "vitest";
import { derivePerpLiquidationFeatures } from "../../../src/domain/perp-liquidation/derive.js";
import type { NormalizedObservationRow } from "../../../src/contracts/normalized-observation.js";
import type {
  PerpObservationPayloadV1,
  PerpCoverageRecordV1,
  OpenInterestPayloadV1,
  FundingRatePayloadV1
} from "../../../src/contracts/perp-liquidation.js";

function makeNormalizedRow(
  id: number,
  rawId: number,
  payload: PerpObservationPayloadV1,
  observedAtUnixMs: number,
  overrides: Partial<NormalizedObservationRow> = {}
): NormalizedObservationRow {
  return {
    id,
    rawObservationId: rawId,
    source: payload.venue,
    observationKind: payload.kind,
    signalClass: "contextual",
    evidenceFamily: "perp_liquidation",
    payload,
    payloadHash: `hash-${id}`,
    confidence: {
      components: {
        sourceReliability: 0.9,
        dataCompleteness: 1.0,
        derivationConfidence: 0.95,
        llmConfidence: null
      },
      compositeScore: 0.92,
      level: "high",
      weightingVersion: "v1",
      reasons: []
    },
    confidenceComposite: 0.92,
    confidenceLevel: "high",
    validUntilUnixMs: observedAtUnixMs + 3_600_000,
    isStale: false,
    staleBehavior: "degrade_confidence",
    provenance: {
      sourceRefs: [],
      rawObservationRefs: [
        {
          refType: "raw_observation",
          id: rawId,
          source: payload.venue,
          payloadHash: `raw-hash-${rawId}`
        }
      ],
      derivedFromRefs: [],
      processRef: {
        collector: "perp-collector",
        jobName: "collect-perp",
        pipelineRunId: "run-1",
        codeVersion: "1.0.0",
        modelVersion: null
      },
      codeVersion: "1.0.0",
      runId: "run-1"
    },
    receivedAtUnixMs: observedAtUnixMs + 10,
    ...overrides
  };
}

describe("perp-liquidation derive", () => {
  const asOf = 1_700_000_000_000;
  const runId = "test-run";
  const codeVersion = "1.0.0";
  const calculatorVersion = "perp-stress/v1";
  const selectionVersion = "perp-select/v1";

  const allAvailableCoverage: PerpCoverageRecordV1[] = [
    { kind: "open_interest", status: "available" },
    { kind: "funding_rate", status: "available" },
    { kind: "perp_basis", status: "available" },
    { kind: "liquidation_event", status: "available" }
  ];

  it("derives positive BPS for rising OI and negative BPS for falling OI", async () => {
    // Rising OI: earliest = 1000, latest = 1100 => +1000 BPS
    const oi1 = makeNormalizedRow(
      1,
      101,
      {
        schemaVersion: 1,
        evidenceFamily: "perp_liquidation",
        pair: "SOL/USDC",
        venue: "binance-fapi",
        instrument: "SOLUSDC_PERP",
        sourceEventId: "oi-1",
        observedAtUnixMs: asOf - 4 * 3_600_000,
        kind: "open_interest",
        openInterestBase: "100",
        openInterestUsdc: "1000",
        sampleWindowSeconds: 300
      },
      asOf - 4 * 3_600_000
    );

    const oi2 = makeNormalizedRow(
      2,
      102,
      {
        schemaVersion: 1,
        evidenceFamily: "perp_liquidation",
        pair: "SOL/USDC",
        venue: "binance-fapi",
        instrument: "SOLUSDC_PERP",
        sourceEventId: "oi-2",
        observedAtUnixMs: asOf,
        kind: "open_interest",
        openInterestBase: "110",
        openInterestUsdc: "1100",
        sampleWindowSeconds: 300
      },
      asOf
    );

    const results = await derivePerpLiquidationFeatures({
      candidates: [oi1, oi2],
      coverage: allAvailableCoverage,
      evaluationAsOfUnixMs: asOf,
      runId,
      codeVersion,
      calculatorVersion,
      selectionVersion
    });

    const oiFeature = results.find((r) => r.featureKind === "oi_trend_4h");
    expect(oiFeature).toBeDefined();
    expect(oiFeature?.status).toBe("AVAILABLE");
    expect(oiFeature?.value).toBe(1000); // (1100 - 1000)*10000 / 1000

    // Falling OI: earliest = 1000, latest = 900 => -1000 BPS
    const oi3 = makeNormalizedRow(
      3,
      103,
      {
        ...(oi2.payload as OpenInterestPayloadV1),
        sourceEventId: "oi-3",
        openInterestUsdc: "900",
        observedAtUnixMs: asOf
      },
      asOf
    );

    const resultsFalling = await derivePerpLiquidationFeatures({
      candidates: [oi1, oi3],
      coverage: allAvailableCoverage,
      evaluationAsOfUnixMs: asOf,
      runId,
      codeVersion,
      calculatorVersion,
      selectionVersion
    });

    const oiFeatureFalling = resultsFalling.find((r) => r.featureKind === "oi_trend_4h");
    expect(oiFeatureFalling?.status).toBe("AVAILABLE");
    expect(oiFeatureFalling?.value).toBe(-1000);
  });

  it("preserves positive and negative funding rates through normalization and annualization", async () => {
    // fundingRate = 0.0001 (0.01%), interval = 8h => (24/8)*365 * 0.0001 * 10000 = 1095 BPS
    const fundingPos = makeNormalizedRow(
      10,
      110,
      {
        schemaVersion: 1,
        evidenceFamily: "perp_liquidation",
        pair: "SOL/USDC",
        venue: "binance-fapi",
        instrument: "SOLUSDC_PERP",
        sourceEventId: "fr-1",
        observedAtUnixMs: asOf,
        kind: "funding_rate",
        fundingRate: "0.0001",
        fundingIntervalHours: 8
      },
      asOf
    );

    const resPos = await derivePerpLiquidationFeatures({
      candidates: [fundingPos],
      coverage: allAvailableCoverage,
      evaluationAsOfUnixMs: asOf,
      runId,
      codeVersion,
      calculatorVersion,
      selectionVersion
    });

    const frFeaturePos = resPos.find((r) => r.featureKind === "funding_rate_annualized");
    expect(frFeaturePos?.status).toBe("AVAILABLE");
    expect(frFeaturePos?.value).toBe(1095);

    // Negative funding: -0.0001 => -1095 BPS
    const fundingNeg = makeNormalizedRow(
      11,
      111,
      {
        ...(fundingPos.payload as FundingRatePayloadV1),
        sourceEventId: "fr-2",
        fundingRate: "-0.0001"
      },
      asOf
    );

    const resNeg = await derivePerpLiquidationFeatures({
      candidates: [fundingNeg],
      coverage: allAvailableCoverage,
      evaluationAsOfUnixMs: asOf,
      runId,
      codeVersion,
      calculatorVersion,
      selectionVersion
    });

    const frFeatureNeg = resNeg.find((r) => r.featureKind === "funding_rate_annualized");
    expect(frFeatureNeg?.status).toBe("AVAILABLE");
    expect(frFeatureNeg?.value).toBe(-1095);
  });

  it("marks OI trend unavailable when fewer than two usable samples exist", async () => {
    const oi1 = makeNormalizedRow(
      1,
      101,
      {
        schemaVersion: 1,
        evidenceFamily: "perp_liquidation",
        pair: "SOL/USDC",
        venue: "binance-fapi",
        instrument: "SOLUSDC_PERP",
        sourceEventId: "oi-1",
        observedAtUnixMs: asOf,
        kind: "open_interest",
        openInterestBase: "100",
        openInterestUsdc: "1000",
        sampleWindowSeconds: 300
      },
      asOf
    );

    const results = await derivePerpLiquidationFeatures({
      candidates: [oi1],
      coverage: allAvailableCoverage,
      evaluationAsOfUnixMs: asOf,
      runId,
      codeVersion,
      calculatorVersion,
      selectionVersion
    });

    const oiFeature = results.find((r) => r.featureKind === "oi_trend_4h");
    expect(oiFeature?.status).toBe("UNAVAILABLE");
    expect(oiFeature?.value).toBeNull();
  });

  it("marks liquidation cluster unavailable when no same-venue positive OI denominator exists", async () => {
    // Liquidation on drift-api, but latest OI is on binance-fapi
    const liqDrift = makeNormalizedRow(
      20,
      120,
      {
        schemaVersion: 1,
        evidenceFamily: "perp_liquidation",
        pair: "SOL/USDC",
        venue: "drift-api",
        instrument: "SOL-PERP",
        sourceEventId: "liq-1",
        observedAtUnixMs: asOf - 1800_000,
        kind: "liquidation_event",
        side: "long",
        amountBase: "10",
        notionalUsdc: "1500"
      },
      asOf - 1800_000
    );

    const oiBinance = makeNormalizedRow(
      21,
      121,
      {
        schemaVersion: 1,
        evidenceFamily: "perp_liquidation",
        pair: "SOL/USDC",
        venue: "binance-fapi",
        instrument: "SOLUSDC_PERP",
        sourceEventId: "oi-binance",
        observedAtUnixMs: asOf,
        kind: "open_interest",
        openInterestBase: "100",
        openInterestUsdc: "100000",
        sampleWindowSeconds: 300
      },
      asOf
    );

    const results = await derivePerpLiquidationFeatures({
      candidates: [liqDrift, oiBinance],
      coverage: allAvailableCoverage,
      evaluationAsOfUnixMs: asOf,
      runId,
      codeVersion,
      calculatorVersion,
      selectionVersion
    });

    const liqFeature = results.find(
      (r) =>
        r.featureKind === "liquidation_cluster_1h" &&
        (r.structuredPayload as { calculationMetadata?: { venue?: string } }).calculationMetadata
          ?.venue === "drift-api"
    );
    expect(liqFeature?.status).toBe("UNAVAILABLE");
    expect(liqFeature?.value).toBeNull();
  });

  it("does not interpret unavailable liquidation coverage as a zero liquidation cluster", async () => {
    const unavailableCoverage: PerpCoverageRecordV1[] = [
      { kind: "open_interest", status: "available" },
      { kind: "funding_rate", status: "available" },
      { kind: "perp_basis", status: "available" },
      { kind: "liquidation_event", status: "unavailable", diagnostic: "Feed down" }
    ];

    const oiRow = makeNormalizedRow(
      1,
      101,
      {
        schemaVersion: 1,
        evidenceFamily: "perp_liquidation",
        pair: "SOL/USDC",
        venue: "binance-fapi",
        instrument: "SOLUSDC_PERP",
        sourceEventId: "oi-1",
        observedAtUnixMs: asOf,
        kind: "open_interest",
        openInterestBase: "100",
        openInterestUsdc: "100000",
        sampleWindowSeconds: 300
      },
      asOf
    );

    const results = await derivePerpLiquidationFeatures({
      candidates: [oiRow],
      coverage: unavailableCoverage,
      evaluationAsOfUnixMs: asOf,
      runId,
      codeVersion,
      calculatorVersion,
      selectionVersion
    });

    const liqFeature = results.find((r) => r.featureKind === "liquidation_cluster_1h");
    expect(liqFeature?.status).toBe("UNAVAILABLE");
    expect(liqFeature?.value).toBeNull();
    expect(liqFeature?.reasons).toContain("coverage_unavailable");
  });

  it("links every available feature to its selected normalized and raw observation ids", async () => {
    const basisRow = makeNormalizedRow(
      30,
      130,
      {
        schemaVersion: 1,
        evidenceFamily: "perp_liquidation",
        pair: "SOL/USDC",
        venue: "binance-fapi",
        instrument: "SOLUSDC_PERP",
        sourceEventId: "basis-1",
        observedAtUnixMs: asOf,
        kind: "perp_basis",
        perpPriceUsdc: "151.50",
        spotPriceUsdc: "150.00"
      },
      asOf
    );

    const results = await derivePerpLiquidationFeatures({
      candidates: [basisRow],
      coverage: allAvailableCoverage,
      evaluationAsOfUnixMs: asOf,
      runId,
      codeVersion,
      calculatorVersion,
      selectionVersion
    });

    const basisFeature = results.find((r) => r.featureKind === "basis_spread_bps");
    expect(basisFeature?.status).toBe("AVAILABLE");
    expect(basisFeature?.value).toBe(100); // (151.50 - 150.00)*10000 / 150.00 = 100 BPS
    expect(basisFeature?.inputObservationIds).toEqual([30]);
    expect(basisFeature?.provenance.rawObservationRefs.map((r) => r.id)).toEqual([130]);
  });

  it("handles zero OI baseline by marking OI trend unavailable", async () => {
    const oiZero = makeNormalizedRow(
      1,
      101,
      {
        schemaVersion: 1,
        evidenceFamily: "perp_liquidation",
        pair: "SOL/USDC",
        venue: "binance-fapi",
        instrument: "SOLUSDC_PERP",
        sourceEventId: "oi-0",
        observedAtUnixMs: asOf - 4 * 3_600_000,
        kind: "open_interest",
        openInterestBase: "0",
        openInterestUsdc: "0",
        sampleWindowSeconds: 300
      },
      asOf - 4 * 3_600_000
    );

    const oiLatest = makeNormalizedRow(
      2,
      102,
      {
        schemaVersion: 1,
        evidenceFamily: "perp_liquidation",
        pair: "SOL/USDC",
        venue: "binance-fapi",
        instrument: "SOLUSDC_PERP",
        sourceEventId: "oi-2",
        observedAtUnixMs: asOf,
        kind: "open_interest",
        openInterestBase: "100",
        openInterestUsdc: "1000",
        sampleWindowSeconds: 300
      },
      asOf
    );

    const results = await derivePerpLiquidationFeatures({
      candidates: [oiZero, oiLatest],
      coverage: allAvailableCoverage,
      evaluationAsOfUnixMs: asOf,
      runId,
      codeVersion,
      calculatorVersion,
      selectionVersion
    });

    const oiFeature = results.find((r) => r.featureKind === "oi_trend_4h");
    expect(oiFeature?.status).toBe("UNAVAILABLE");
    expect(oiFeature?.reasons).toContain("zero_or_negative_earliest_oi");
  });

  it("calculates positive and negative basis spread in BPS correctly", async () => {
    // Positive basis: perp = 151.5, spot = 150.0 => +100 BPS
    const basisPos = makeNormalizedRow(
      40,
      140,
      {
        schemaVersion: 1,
        evidenceFamily: "perp_liquidation",
        pair: "SOL/USDC",
        venue: "binance-fapi",
        instrument: "SOLUSDC_PERP",
        sourceEventId: "basis-pos",
        observedAtUnixMs: asOf,
        kind: "perp_basis",
        perpPriceUsdc: "151.50",
        spotPriceUsdc: "150.00"
      },
      asOf
    );

    // Negative basis: perp = 148.5, spot = 150.0 => -100 BPS
    const basisNeg = makeNormalizedRow(
      41,
      141,
      {
        schemaVersion: 1,
        evidenceFamily: "perp_liquidation",
        pair: "SOL/USDC",
        venue: "drift-api",
        instrument: "SOL-PERP",
        sourceEventId: "basis-neg",
        observedAtUnixMs: asOf,
        kind: "perp_basis",
        perpPriceUsdc: "148.50",
        spotPriceUsdc: "150.00"
      },
      asOf
    );

    const results = await derivePerpLiquidationFeatures({
      candidates: [basisPos, basisNeg],
      coverage: allAvailableCoverage,
      evaluationAsOfUnixMs: asOf,
      runId,
      codeVersion,
      calculatorVersion,
      selectionVersion
    });

    const posFeature = results.find(
      (r) =>
        r.featureKind === "basis_spread_bps" &&
        (r.structuredPayload as { calculationMetadata?: { venue?: string } }).calculationMetadata
          ?.venue === "binance-fapi"
    );
    expect(posFeature?.status).toBe("AVAILABLE");
    expect(posFeature?.value).toBe(100);

    const negFeature = results.find(
      (r) =>
        r.featureKind === "basis_spread_bps" &&
        (r.structuredPayload as { calculationMetadata?: { venue?: string } }).calculationMetadata
          ?.venue === "drift-api"
    );
    expect(negFeature?.status).toBe("AVAILABLE");
    expect(negFeature?.value).toBe(-100);
  });

  it("aggregates mixed long and short liquidations in 1h liquidation cluster", async () => {
    const oi = makeNormalizedRow(
      50,
      150,
      {
        schemaVersion: 1,
        evidenceFamily: "perp_liquidation",
        pair: "SOL/USDC",
        venue: "binance-fapi",
        instrument: "SOLUSDC_PERP",
        sourceEventId: "oi-50",
        observedAtUnixMs: asOf,
        kind: "open_interest",
        openInterestBase: "1000",
        openInterestUsdc: "100000",
        sampleWindowSeconds: 300
      },
      asOf
    );

    const liqLong = makeNormalizedRow(
      51,
      151,
      {
        schemaVersion: 1,
        evidenceFamily: "perp_liquidation",
        pair: "SOL/USDC",
        venue: "binance-fapi",
        instrument: "SOLUSDC_PERP",
        sourceEventId: "liq-long",
        observedAtUnixMs: asOf - 1800_000,
        kind: "liquidation_event",
        side: "long",
        amountBase: "10",
        notionalUsdc: "3000"
      },
      asOf - 1800_000
    );

    const liqShort = makeNormalizedRow(
      52,
      152,
      {
        schemaVersion: 1,
        evidenceFamily: "perp_liquidation",
        pair: "SOL/USDC",
        venue: "binance-fapi",
        instrument: "SOLUSDC_PERP",
        sourceEventId: "liq-short",
        observedAtUnixMs: asOf - 900_000,
        kind: "liquidation_event",
        side: "short",
        amountBase: "5",
        notionalUsdc: "2000"
      },
      asOf - 900_000
    );

    const results = await derivePerpLiquidationFeatures({
      candidates: [oi, liqLong, liqShort],
      coverage: allAvailableCoverage,
      evaluationAsOfUnixMs: asOf,
      runId,
      codeVersion,
      calculatorVersion,
      selectionVersion
    });

    const liqFeature = results.find((r) => r.featureKind === "liquidation_cluster_1h");
    expect(liqFeature?.status).toBe("AVAILABLE");
    // total notional = 3000 + 2000 = 5000 USDC. OI = 100,000 USDC. (5000 * 10000) / 100,000 = 500 BPS
    expect(liqFeature?.value).toBe(500);
  });

  it("handles stale inputs by degrading feature status to PARTIAL and adding stale warning", async () => {
    const basisStale = makeNormalizedRow(
      60,
      160,
      {
        schemaVersion: 1,
        evidenceFamily: "perp_liquidation",
        pair: "SOL/USDC",
        venue: "binance-fapi",
        instrument: "SOLUSDC_PERP",
        sourceEventId: "basis-stale",
        observedAtUnixMs: asOf,
        kind: "perp_basis",
        perpPriceUsdc: "151.50",
        spotPriceUsdc: "150.00"
      },
      asOf,
      { isStale: true }
    );

    const results = await derivePerpLiquidationFeatures({
      candidates: [basisStale],
      coverage: allAvailableCoverage,
      evaluationAsOfUnixMs: asOf,
      runId,
      codeVersion,
      calculatorVersion,
      selectionVersion
    });

    const basisFeature = results.find((r) => r.featureKind === "basis_spread_bps");
    expect(basisFeature?.status).toBe("PARTIAL");
    expect(basisFeature?.warnings).toContain("stale_input_degraded");
  });

  it("deduplicates candidate observations with duplicate IDs", async () => {
    const basisRow1 = makeNormalizedRow(
      70,
      170,
      {
        schemaVersion: 1,
        evidenceFamily: "perp_liquidation",
        pair: "SOL/USDC",
        venue: "binance-fapi",
        instrument: "SOLUSDC_PERP",
        sourceEventId: "basis-dup",
        observedAtUnixMs: asOf,
        kind: "perp_basis",
        perpPriceUsdc: "151.50",
        spotPriceUsdc: "150.00"
      },
      asOf
    );

    // Duplicate candidate row with identical ID 70
    const basisRow2 = { ...basisRow1 };

    const results = await derivePerpLiquidationFeatures({
      candidates: [basisRow1, basisRow2],
      coverage: allAvailableCoverage,
      evaluationAsOfUnixMs: asOf,
      runId,
      codeVersion,
      calculatorVersion,
      selectionVersion
    });

    const basisFeature = results.find((r) => r.featureKind === "basis_spread_bps");
    expect(basisFeature?.status).toBe("AVAILABLE");
    expect(basisFeature?.inputObservationIds).toEqual([70]);
  });

  it("enforces cross-venue isolation across multiple venues", async () => {
    const binanceFunding = makeNormalizedRow(
      80,
      180,
      {
        schemaVersion: 1,
        evidenceFamily: "perp_liquidation",
        pair: "SOL/USDC",
        venue: "binance-fapi",
        instrument: "SOLUSDC_PERP",
        sourceEventId: "fr-b",
        observedAtUnixMs: asOf,
        kind: "funding_rate",
        fundingRate: "0.0001",
        fundingIntervalHours: 8
      },
      asOf
    );

    const driftFunding = makeNormalizedRow(
      81,
      181,
      {
        schemaVersion: 1,
        evidenceFamily: "perp_liquidation",
        pair: "SOL/USDC",
        venue: "drift-api",
        instrument: "SOL-PERP",
        sourceEventId: "fr-d",
        observedAtUnixMs: asOf,
        kind: "funding_rate",
        fundingRate: "0.0002",
        fundingIntervalHours: 1
      },
      asOf
    );

    const results = await derivePerpLiquidationFeatures({
      candidates: [binanceFunding, driftFunding],
      coverage: allAvailableCoverage,
      evaluationAsOfUnixMs: asOf,
      runId,
      codeVersion,
      calculatorVersion,
      selectionVersion
    });

    const fundingFeatures = results.filter((r) => r.featureKind === "funding_rate_annualized");
    expect(fundingFeatures).toHaveLength(2);

    const bFeature = fundingFeatures.find(
      (r) =>
        (r.structuredPayload as { calculationMetadata?: { venue?: string } }).calculationMetadata
          ?.venue === "binance-fapi"
    );
    const dFeature = fundingFeatures.find(
      (r) =>
        (r.structuredPayload as { calculationMetadata?: { venue?: string } }).calculationMetadata
          ?.venue === "drift-api"
    );

    expect(bFeature?.status).toBe("AVAILABLE");
    expect(bFeature?.value).toBe(1095);

    // drift: 0.0002 * 24 * 365 * 10000 = 17520 BPS
    expect(dFeature?.status).toBe("AVAILABLE");
    expect(dFeature?.value).toBe(17520);
  });

  it("rejects intermediate OI candidates when calculating OI trend", async () => {
    const oi1 = makeNormalizedRow(
      90,
      190,
      {
        schemaVersion: 1,
        evidenceFamily: "perp_liquidation",
        pair: "SOL/USDC",
        venue: "binance-fapi",
        instrument: "SOLUSDC_PERP",
        sourceEventId: "oi-earliest",
        observedAtUnixMs: asOf - 4 * 3_600_000,
        kind: "open_interest",
        openInterestBase: "100",
        openInterestUsdc: "1000",
        sampleWindowSeconds: 300
      },
      asOf - 4 * 3_600_000
    );

    const oiMid = makeNormalizedRow(
      91,
      191,
      {
        schemaVersion: 1,
        evidenceFamily: "perp_liquidation",
        pair: "SOL/USDC",
        venue: "binance-fapi",
        instrument: "SOLUSDC_PERP",
        sourceEventId: "oi-mid",
        observedAtUnixMs: asOf - 2 * 3_600_000,
        kind: "open_interest",
        openInterestBase: "105",
        openInterestUsdc: "1050",
        sampleWindowSeconds: 300
      },
      asOf - 2 * 3_600_000
    );

    const oi3 = makeNormalizedRow(
      92,
      192,
      {
        schemaVersion: 1,
        evidenceFamily: "perp_liquidation",
        pair: "SOL/USDC",
        venue: "binance-fapi",
        instrument: "SOLUSDC_PERP",
        sourceEventId: "oi-latest",
        observedAtUnixMs: asOf,
        kind: "open_interest",
        openInterestBase: "110",
        openInterestUsdc: "1100",
        sampleWindowSeconds: 300
      },
      asOf
    );

    const results = await derivePerpLiquidationFeatures({
      candidates: [oi1, oiMid, oi3],
      coverage: allAvailableCoverage,
      evaluationAsOfUnixMs: asOf,
      runId,
      codeVersion,
      calculatorVersion,
      selectionVersion
    });

    const oiFeature = results.find((r) => r.featureKind === "oi_trend_4h");
    expect(oiFeature?.status).toBe("AVAILABLE");
    expect(oiFeature?.inputObservationIds).toEqual([90, 92]);
    expect(oiFeature?.rejectedObservationIds).toEqual([91]);
  });

  it("handles fractional funding intervals without throwing RangeError", async () => {
    const fundingFractional = makeNormalizedRow(
      100,
      200,
      {
        schemaVersion: 1,
        evidenceFamily: "perp_liquidation",
        pair: "SOL/USDC",
        venue: "drift-api",
        instrument: "SOL-PERP",
        sourceEventId: "fr-frac",
        observedAtUnixMs: asOf,
        kind: "funding_rate",
        fundingRate: "0.0001",
        fundingIntervalHours: 0.5
      },
      asOf
    );

    const results = await derivePerpLiquidationFeatures({
      candidates: [fundingFractional],
      coverage: allAvailableCoverage,
      evaluationAsOfUnixMs: asOf,
      runId,
      codeVersion,
      calculatorVersion,
      selectionVersion
    });

    const frFeature = results.find((r) => r.featureKind === "funding_rate_annualized");
    expect(frFeature?.status).toBe("AVAILABLE");
    // fundingRate = 0.0001, fundingIntervalHours = 0.5
    // periodsPerDay = 24 / 0.5 = 48
    // periodsPerYear = 48 * 365 = 17520
    // BPS = 0.0001 * 17520 * 10000 = 17520
    expect(frFeature?.value).toBe(17520);
  });
});
