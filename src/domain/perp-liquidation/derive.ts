import type {
  NormalizedObservationRow,
  DerivedFeatureV1,
  FeatureKind,
  PerpCoverageRecordV1,
  PerpObservationPayloadV1,
  FundingRatePayloadV1,
  OpenInterestPayloadV1,
  PerpBasisPayloadV1,
  LiquidationEventPayloadV1,
  Confidence,
  Provenance,
  DerivedFeatureInsert
} from "../../contracts/index.js";
import { assembleDerivedFeature, type FeatureCalculation } from "../derived-feature/assemble.js";
import {
  parseDecimal,
  add,
  subtract,
  multiply,
  divide,
  roundToSafeInteger,
  compare,
  type Rational
} from "../derived-feature/decimal.js";

export const PERP_CALCULATOR_VERSIONS = {
  oi_trend_4h: "oi-trend-4h/v1",
  funding_rate_annualized: "funding-rate-annualized/v1",
  liquidation_cluster_1h: "liquidation-cluster-1h/v1",
  basis_spread_bps: "basis-spread-bps/v1"
} as const;

export interface DerivePerpLiquidationFeaturesOptions {
  readonly candidates: readonly NormalizedObservationRow[];
  readonly coverage: readonly PerpCoverageRecordV1[];
  readonly evaluationAsOfUnixMs: number;
  readonly runId: string;
  readonly codeVersion: string;
  readonly calculatorVersion?: string;
  readonly selectionVersion?: string;
}

function makeUnavailable(reasons: readonly string[]): FeatureCalculation {
  return {
    status: "UNAVAILABLE",
    value: null,
    warnings: [],
    reasons: [...reasons],
    metadata: {}
  };
}

function toDerivedFeatureInsert(
  v1: DerivedFeatureV1,
  derivationKey: string,
  payloadHash: string,
  receivedAtUnixMs: number
): DerivedFeatureInsert {
  return {
    featureKind: v1.featureKind as FeatureKind,
    signalClass: "contextual",
    evidenceFamily: "perp_liquidation",
    value: v1.value,
    structuredPayload: v1,
    asOfUnixMs: v1.asOfUnixMs,
    confidence: v1.confidence as unknown as Confidence,
    confidenceComposite: v1.confidence.compositeScore,
    confidenceLevel: v1.confidence.level,
    validUntilUnixMs: v1.expiresAtUnixMs,
    isStale: v1.freshness.isStale,
    staleBehavior: "degrade_confidence",
    provenance: v1.provenance as unknown as Provenance,
    payloadHash,
    receivedAtUnixMs,
    status: v1.status,
    unit: v1.unit,
    pair: v1.pair,
    calculatorVersion: v1.calculatorVersion,
    selectionVersion: v1.selectionVersion,
    inputObservationIds: [...v1.inputObservationIds],
    rejectedObservationIds: [...v1.rejectedObservationIds],
    derivationKey,
    poolId: v1.poolId,
    positionId: v1.positionId,
    warnings: v1.warnings,
    reasons: v1.reasons
  };
}

export function calculateOiTrend4h(
  oiObs: readonly { row: NormalizedObservationRow; payload: OpenInterestPayloadV1 }[]
): FeatureCalculation {
  if (oiObs.length < 2) {
    return makeUnavailable(["fewer_than_two_oi_samples"]);
  }

  const earliest = oiObs[0]!;
  const latest = oiObs[oiObs.length - 1]!;
  const venue = latest.payload.venue;

  const earliestOiRat = parseDecimal(earliest.payload.openInterestUsdc);
  const latestOiRat = parseDecimal(latest.payload.openInterestUsdc);

  if (typeof earliestOiRat === "string" || typeof latestOiRat === "string") {
    return makeUnavailable(["invalid_oi_decimal"]);
  }

  if (compare(earliestOiRat, { numerator: 0n, denominator: 1n }) <= 0) {
    return makeUnavailable(["zero_or_negative_earliest_oi"]);
  }

  // oiTrendBps = roundHalfAwayFromZero(((latestOi - earliestOi) * 10_000) / abs(earliestOi))
  const diff = subtract(latestOiRat, earliestOiRat);
  const scaledDiff = multiply(diff, { numerator: 10_000n, denominator: 1n });
  const divResult = divide(scaledDiff, earliestOiRat);

  if (typeof divResult === "string") {
    return makeUnavailable(["numeric_failure"]);
  }

  const bps = roundToSafeInteger(divResult);
  if (typeof bps === "string") {
    return makeUnavailable(["numeric_overflow"]);
  }

  return {
    status: "AVAILABLE",
    value: bps,
    warnings: [],
    reasons: [],
    metadata: {
      venue,
      venues: [venue],
      earliestOiUsdc: earliest.payload.openInterestUsdc,
      latestOiUsdc: latest.payload.openInterestUsdc,
      earliestObservedAtUnixMs: earliest.payload.observedAtUnixMs,
      latestObservedAtUnixMs: latest.payload.observedAtUnixMs
    }
  };
}

export function calculateAnnualizedFundingBps(payload: FundingRatePayloadV1): FeatureCalculation {
  const rateRat = parseDecimal(payload.fundingRate);
  if (typeof rateRat === "string") {
    return makeUnavailable(["invalid_funding_rate_decimal"]);
  }

  if (payload.fundingIntervalHours <= 0) {
    return makeUnavailable(["invalid_funding_interval"]);
  }

  // annualizedFundingBps = roundHalfAwayFromZero(fundingRate * (24 / fundingIntervalHours) * 365 * 10_000)
  const intervalRat: Rational = {
    numerator: BigInt(payload.fundingIntervalHours),
    denominator: 1n
  };
  const periodsPerDay = divide({ numerator: 24n, denominator: 1n }, intervalRat);
  if (typeof periodsPerDay === "string") {
    return makeUnavailable(["numeric_failure"]);
  }

  const periodsPerYear = multiply(periodsPerDay, { numerator: 365n, denominator: 1n });
  const scaledRate = multiply(rateRat, periodsPerYear);
  const bpsRat = multiply(scaledRate, { numerator: 10_000n, denominator: 1n });

  const bps = roundToSafeInteger(bpsRat);
  if (typeof bps === "string") {
    return makeUnavailable(["numeric_overflow"]);
  }

  return {
    status: "AVAILABLE",
    value: bps,
    warnings: [],
    reasons: [],
    metadata: {
      venue: payload.venue,
      venues: [payload.venue],
      fundingRate: payload.fundingRate,
      fundingIntervalHours: payload.fundingIntervalHours
    }
  };
}

export function calculateBasisSpreadBps(payload: PerpBasisPayloadV1): FeatureCalculation {
  const perpRat = parseDecimal(payload.perpPriceUsdc);
  const spotRat = parseDecimal(payload.spotPriceUsdc);

  if (typeof perpRat === "string" || typeof spotRat === "string") {
    return makeUnavailable(["invalid_price_decimal"]);
  }

  if (compare(spotRat, { numerator: 0n, denominator: 1n }) <= 0) {
    return makeUnavailable(["zero_or_negative_spot_price"]);
  }

  // basisSpreadBps = roundHalfAwayFromZero(((perpPrice - spotPrice) * 10_000) / spotPrice)
  const diff = subtract(perpRat, spotRat);
  const scaledDiff = multiply(diff, { numerator: 10_000n, denominator: 1n });
  const divResult = divide(scaledDiff, spotRat);

  if (typeof divResult === "string") {
    return makeUnavailable(["numeric_failure"]);
  }

  const bps = roundToSafeInteger(divResult);
  if (typeof bps === "string") {
    return makeUnavailable(["numeric_overflow"]);
  }

  return {
    status: "AVAILABLE",
    value: bps,
    warnings: [],
    reasons: [],
    metadata: {
      venue: payload.venue,
      venues: [payload.venue],
      perpPriceUsdc: payload.perpPriceUsdc,
      spotPriceUsdc: payload.spotPriceUsdc
    }
  };
}

export function calculateLiquidationClusterBps(
  liquidations: readonly { row: NormalizedObservationRow; payload: LiquidationEventPayloadV1 }[],
  latestOi: { row: NormalizedObservationRow; payload: OpenInterestPayloadV1 } | undefined,
  fallbackVenue?: string
): FeatureCalculation {
  const venue = latestOi?.payload.venue ?? fallbackVenue ?? liquidations[0]?.payload.venue;
  if (!latestOi) {
    return {
      status: "UNAVAILABLE",
      value: null,
      warnings: [],
      reasons: ["no_same_venue_oi_denominator"],
      metadata: venue ? { venue, venues: [venue] } : {}
    };
  }

  const oiVenue = latestOi.payload.venue;
  const sameVenueLiqs = liquidations.filter((l) => l.payload.venue === oiVenue);

  const oiUsdcRat = parseDecimal(latestOi.payload.openInterestUsdc);
  if (
    typeof oiUsdcRat === "string" ||
    compare(oiUsdcRat, { numerator: 0n, denominator: 1n }) <= 0
  ) {
    return makeUnavailable(["no_same_venue_positive_oi_denominator"]);
  }

  // Deduplicate liquidation events by sourceEventId or ID
  const seenIds = new Set<string>();
  let sumNotionalRat: Rational = { numerator: 0n, denominator: 1n };

  for (const liq of sameVenueLiqs) {
    const eventId = liq.payload.sourceEventId ?? `id-${liq.row.id}`;
    if (seenIds.has(eventId)) continue;
    seenIds.add(eventId);

    const notionalRat = parseDecimal(liq.payload.notionalUsdc);
    if (typeof notionalRat === "string") continue;
    if (compare(notionalRat, { numerator: 0n, denominator: 1n }) <= 0) continue;

    sumNotionalRat = add(sumNotionalRat, notionalRat);
  }

  // liquidationClusterBps = roundHalfAwayFromZero((sumLiquidationNotional1h * 10_000) / latestSameVenueOiNotional)
  const scaledNotional = multiply(sumNotionalRat, { numerator: 10_000n, denominator: 1n });
  const divResult = divide(scaledNotional, oiUsdcRat);

  if (typeof divResult === "string") {
    return makeUnavailable(["numeric_failure"]);
  }

  const bps = roundToSafeInteger(divResult);
  if (typeof bps === "string") {
    return makeUnavailable(["numeric_overflow"]);
  }

  return {
    status: "AVAILABLE",
    value: bps,
    warnings: [],
    reasons: [],
    metadata: {
      venue: oiVenue,
      venues: [oiVenue],
      liquidationCount: seenIds.size,
      denominatorOiUsdc: latestOi.payload.openInterestUsdc
    }
  };
}

export async function derivePerpLiquidationFeatures(
  options: DerivePerpLiquidationFeaturesOptions
): Promise<DerivedFeatureInsert[]> {
  const {
    candidates,
    coverage,
    evaluationAsOfUnixMs,
    runId,
    codeVersion,
    calculatorVersion = PERP_CALCULATOR_VERSIONS.oi_trend_4h,
    selectionVersion = "perp-select/v1"
  } = options;

  // Deduplicate candidates by ID if duplicate IDs are present
  const uniqueCandidatesMap = new Map<number, NormalizedObservationRow>();
  for (const candidate of candidates) {
    if (!uniqueCandidatesMap.has(candidate.id)) {
      uniqueCandidatesMap.set(candidate.id, candidate);
    }
  }
  const uniqueCandidates = Array.from(uniqueCandidatesMap.values());

  // Filter candidates within windows and sort by observedAtUnixMs, then ID
  const sortedCandidates = [...uniqueCandidates].sort((a, b) => {
    const pA = a.payload as PerpObservationPayloadV1;
    const pB = b.payload as PerpObservationPayloadV1;
    if (pA.observedAtUnixMs !== pB.observedAtUnixMs) {
      return pA.observedAtUnixMs - pB.observedAtUnixMs;
    }
    return a.id - b.id;
  });

  const fourHourStart = evaluationAsOfUnixMs - 4 * 3_600_000;
  const oneHourStart = evaluationAsOfUnixMs - 3_600_000;

  const validCandidates = sortedCandidates.filter((r) => {
    const p = r.payload as PerpObservationPayloadV1;
    return p.observedAtUnixMs >= fourHourStart && p.observedAtUnixMs <= evaluationAsOfUnixMs;
  });

  // Group candidates by venue
  const candidatesByVenue = new Map<
    string,
    {
      oi: { row: NormalizedObservationRow; payload: OpenInterestPayloadV1 }[];
      funding: { row: NormalizedObservationRow; payload: FundingRatePayloadV1 }[];
      basis: { row: NormalizedObservationRow; payload: PerpBasisPayloadV1 }[];
      liq: { row: NormalizedObservationRow; payload: LiquidationEventPayloadV1 }[];
    }
  >();

  function getVenueContainer(venue: string) {
    let container = candidatesByVenue.get(venue);
    if (!container) {
      container = { oi: [], funding: [], basis: [], liq: [] };
      candidatesByVenue.set(venue, container);
    }
    return container;
  }

  for (const row of validCandidates) {
    const p = row.payload as PerpObservationPayloadV1;
    const container = getVenueContainer(p.venue);
    if (p.kind === "open_interest") {
      container.oi.push({ row, payload: p });
    } else if (p.kind === "funding_rate") {
      container.funding.push({ row, payload: p });
    } else if (p.kind === "perp_basis") {
      container.basis.push({ row, payload: p });
    } else if (p.kind === "liquidation_event") {
      if (p.observedAtUnixMs >= oneHourStart) {
        container.liq.push({ row, payload: p });
      }
    }
  }

  // Coverage status helper
  const getCoverage = (kind: string): PerpCoverageRecordV1 | undefined =>
    coverage.find((c) => c.kind === kind);

  const results: DerivedFeatureInsert[] = [];

  // Helper to assemble and push feature
  async function assembleAndPush(
    featureKind: FeatureKind,
    calcResult: FeatureCalculation,
    selectedRows: NormalizedObservationRow[],
    rejectedRows: NormalizedObservationRow[],
    coverageRecord?: PerpCoverageRecordV1
  ) {
    let finalStatus = calcResult.status;
    const finalReasons = [...calcResult.reasons];
    const finalWarnings = [...calcResult.warnings];

    if (coverageRecord && coverageRecord.status !== "available") {
      finalStatus = "UNAVAILABLE";
      finalReasons.push("coverage_unavailable");
      if (coverageRecord.diagnostic) {
        finalReasons.push(coverageRecord.diagnostic);
      }
    }

    const value = finalStatus === "UNAVAILABLE" ? null : calcResult.value;
    const inputObservationIds = finalStatus === "UNAVAILABLE" ? [] : selectedRows.map((r) => r.id);
    const rejectedIds = rejectedRows.map((r) => r.id);

    // Stale check
    let isStale = false;
    if (finalStatus !== "UNAVAILABLE") {
      for (const r of selectedRows) {
        if (r.isStale) {
          isStale = true;
          break;
        }
      }
      if (isStale) {
        finalStatus = "PARTIAL";
        finalWarnings.push("stale_input_degraded");
      }
    }

    const baseConfidence =
      selectedRows.length > 0
        ? selectedRows[0]!.confidence
        : {
            components: {
              sourceReliability: 0.8,
              dataCompleteness: 1.0,
              derivationConfidence: 0.9,
              llmConfidence: null
            },
            compositeScore: 0.85,
            level: "medium" as const,
            weightingVersion: "v1",
            reasons: []
          };

    const assembled = await assembleDerivedFeature({
      input: {
        featureKind,
        status: finalStatus,
        value,
        unit: "BPS",
        pair: "SOL/USDC",
        poolId: null,
        positionId: null,
        asOfUnixMs: evaluationAsOfUnixMs,
        expiresAtUnixMs: evaluationAsOfUnixMs + 3_600_000,
        confidence: baseConfidence,
        freshness: {
          isStale,
          validUntilUnixMs: evaluationAsOfUnixMs + 3_600_000,
          derivedAt: evaluationAsOfUnixMs,
          policyKind: featureKind,
          reasons: isStale ? ["stale_input_degraded"] : []
        },
        inputObservationIds,
        rejectedObservationIds: rejectedIds,
        provenance: {
          sourceRefs: [],
          rawObservationRefs: [],
          derivedFromRefs: [],
          processRef: {
            collector: "deterministic-feature-derivation",
            jobName: "derive-perp-features",
            pipelineRunId: runId,
            codeVersion,
            modelVersion: null
          },
          codeVersion,
          runId
        },
        warnings: finalWarnings,
        reasons: finalReasons,
        calculatorVersion,
        selectionVersion,
        calculationMetadata: calcResult.metadata
      },
      selectedRows: finalStatus === "UNAVAILABLE" ? [] : selectedRows,
      rejectedRows,
      evaluationAsOfUnixMs,
      runId,
      codeVersion
    });

    results.push(
      toDerivedFeatureInsert(
        assembled.result,
        assembled.derivationKey,
        assembled.payloadHash,
        evaluationAsOfUnixMs
      )
    );
  }

  // Determine list of venues to evaluate from candidates, or default to binance-fapi if none present
  const venuesToEvaluate =
    candidatesByVenue.size > 0 ? Array.from(candidatesByVenue.keys()).sort() : ["binance-fapi"];

  const oiCoverage = getCoverage("open_interest");
  const fundingCoverage = getCoverage("funding_rate");
  const basisCoverage = getCoverage("perp_basis");
  const liqCoverage = getCoverage("liquidation_event");

  for (const venue of venuesToEvaluate) {
    const venueCandidates = candidatesByVenue.get(venue) ?? {
      oi: [],
      funding: [],
      basis: [],
      liq: []
    };

    // 1. OI Trend 4h per venue
    const oiObs = venueCandidates.oi;
    let selectedOiRows: NormalizedObservationRow[] = [];
    let rejectedOiRows: NormalizedObservationRow[] = [];
    if (oiObs.length >= 2) {
      const earliest = oiObs[0]!;
      const latest = oiObs[oiObs.length - 1]!;
      selectedOiRows = [earliest.row, latest.row];
      rejectedOiRows = oiObs.slice(1, -1).map((c) => c.row);
    } else {
      selectedOiRows = oiObs.map((c) => c.row);
      rejectedOiRows = [];
    }
    const calcOi = calculateOiTrend4h(oiObs);
    await assembleAndPush("oi_trend_4h", calcOi, selectedOiRows, rejectedOiRows, oiCoverage);

    // 2. Annualized Funding per venue
    const fundingObs = venueCandidates.funding;
    const latestFunding = fundingObs[fundingObs.length - 1];
    const selectedFundingRows = latestFunding ? [latestFunding.row] : [];
    const rejectedFundingRows = fundingObs.slice(0, -1).map((c) => c.row);
    const calcFunding = latestFunding
      ? calculateAnnualizedFundingBps(latestFunding.payload)
      : makeUnavailable(["no_funding_rate_observations"]);
    await assembleAndPush(
      "funding_rate_annualized",
      calcFunding,
      selectedFundingRows,
      rejectedFundingRows,
      fundingCoverage
    );

    // 3. Basis Spread Bps per venue
    const basisObs = venueCandidates.basis;
    const latestBasis = basisObs[basisObs.length - 1];
    const selectedBasisRows = latestBasis ? [latestBasis.row] : [];
    const rejectedBasisRows = basisObs.slice(0, -1).map((c) => c.row);
    const calcBasis = latestBasis
      ? calculateBasisSpreadBps(latestBasis.payload)
      : makeUnavailable(["no_perp_basis_observations"]);
    await assembleAndPush(
      "basis_spread_bps",
      calcBasis,
      selectedBasisRows,
      rejectedBasisRows,
      basisCoverage
    );

    // 4. Liquidation Cluster 1h per venue
    const sameVenueOi = oiObs[oiObs.length - 1];
    const sameVenueLiqCandidates = venueCandidates.liq;
    const calcLiq = calculateLiquidationClusterBps(sameVenueLiqCandidates, sameVenueOi, venue);

    const selectedLiqRows: NormalizedObservationRow[] = [];
    if (calcLiq.status !== "UNAVAILABLE") {
      for (const c of sameVenueLiqCandidates) {
        selectedLiqRows.push(c.row);
      }
      if (sameVenueOi && !selectedLiqRows.some((r) => r.id === sameVenueOi.row.id)) {
        selectedLiqRows.push(sameVenueOi.row);
      }
    }

    await assembleAndPush("liquidation_cluster_1h", calcLiq, selectedLiqRows, [], liqCoverage);
  }

  return results;
}
