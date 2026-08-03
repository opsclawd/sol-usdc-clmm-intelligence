import type { NormalizedObservationRepo } from "../ports/normalized-observation-repo.js";
import type {
  DerivedFeatureRepo,
  DerivedFeatureInsert,
  DerivedFeatureRow
} from "../ports/feature-repo.js";
import type { NormalizedObservationRow } from "../contracts/index.js";
import type { FeatureKind, Confidence, Provenance } from "../contracts/taxonomy.js";
import type { DerivedFeatureV1, FeatureStatus } from "../contracts/derived-feature.js";
import type { PositionStatePayloadV1 } from "../contracts/normalized-clmm-observation.js";
import type {
  OraclePricePayloadV1,
  ExecutableQuotePayloadV1
} from "../contracts/normalized-price-observation.js";
import type { PoolStatisticsPayloadV1 } from "../contracts/normalized-pool-statistics.js";
import {
  assembleDerivedFeature,
  type AssembleFeatureInput,
  type AssembledFeature
} from "../domain/derived-feature/assemble.js";
import {
  selectLatestBySourceAndKind,
  selectVolatilityTimestamps,
  SELECTION_VERSION
} from "../domain/derived-feature/select.js";
import {
  calculateRangeLocation,
  calculateDistanceToLower,
  calculateDistanceToUpper,
  RANGE_CALCULATOR_VERSIONS
} from "../domain/derived-feature/range.js";
import {
  calculateOracleDexDivergence,
  calculateOracleConfidenceWidth,
  calculateVolumeLiquidityRatio24h,
  MARKET_CALCULATOR_VERSIONS
} from "../domain/derived-feature/market.js";
import {
  calculateRealizedVolatility1h,
  REALIZED_VOLATILITY_1H_VERSION,
  VOLATILITY_WINDOW_MS
} from "../domain/derived-feature/volatility.js";
import { parseDerivedFeatureV1 } from "../contracts/derived-feature.js";

export interface DeriveMvpFeaturesRequest {
  readonly pair: "SOL/USDC";
  readonly poolId: string;
  readonly positionIds: readonly string[];
  readonly pipelineRunId: string;
  readonly evaluationTimeUnixMs: number;
  readonly codeVersion: string;
}

export interface DeriveMvpFeaturesDeps {
  readonly normalizedObservationRepo: NormalizedObservationRepo;
  readonly featureRepo: DerivedFeatureRepo;
}

export interface DeriveMvpFeaturesResult {
  readonly rows: readonly DerivedFeatureRow[];
  readonly counts: Readonly<Record<FeatureStatus, number>>;
  readonly warnings: readonly string[];
}

const PAIR = "SOL/USDC" as const;
const WINDOW_SAFETY_MS = 300_000;

function buildDefaultConfidence(): Confidence {
  return {
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
  };
}

async function assembleAvailableFeature(
  featureKind: FeatureKind,
  status: FeatureStatus,
  value: number | null,
  unit: "BPS" | "PPM",
  poolId: string | null,
  positionId: string | null,
  asOfUnixMs: number,
  expiresAtUnixMs: number,
  confidence: Confidence,
  inputObservationIds: readonly number[],
  rejectedObservationIds: readonly number[],
  warnings: readonly string[],
  reasons: readonly string[],
  calculatorVersion: string,
  calculationMetadata: Readonly<Record<string, unknown>>,
  selectedRows: readonly NormalizedObservationRow[],
  rejectedRows: readonly NormalizedObservationRow[],
  evaluationAsOfUnixMs: number,
  runId: string,
  codeVersion: string
): Promise<AssembledFeature> {
  const input: AssembleFeatureInput = {
    featureKind,
    status,
    value,
    unit,
    pair: PAIR,
    poolId,
    positionId,
    asOfUnixMs,
    expiresAtUnixMs,
    confidence,
    freshness: {
      isStale: false,
      validUntilUnixMs: expiresAtUnixMs,
      derivedAt: asOfUnixMs,
      policyKind: featureKind,
      reasons: []
    },
    inputObservationIds,
    rejectedObservationIds,
    provenance: {
      sourceRefs: [],
      rawObservationRefs: [],
      derivedFromRefs: [],
      processRef: {
        collector: "deterministic-feature-derivation",
        jobName: "derive-mvp-features",
        pipelineRunId: null,
        codeVersion: null,
        modelVersion: null
      },
      codeVersion: calculatorVersion,
      runId: null
    },
    warnings,
    reasons,
    calculatorVersion,
    selectionVersion: SELECTION_VERSION,
    calculationMetadata
  };

  return assembleDerivedFeature({
    input,
    selectedRows,
    rejectedRows,
    evaluationAsOfUnixMs,
    runId,
    codeVersion
  });
}

async function assembleUnavailableFeature(
  featureKind: FeatureKind,
  unit: "BPS" | "PPM",
  poolId: string | null,
  positionId: string | null,
  asOfUnixMs: number,
  confidence: Confidence,
  inputObservationIds: readonly number[],
  rejectedObservationIds: readonly number[],
  reasons: readonly string[],
  calculatorVersion: string,
  calculationMetadata: Readonly<Record<string, unknown>>,
  rejectedRows: readonly NormalizedObservationRow[],
  evaluationAsOfUnixMs: number,
  runId: string,
  codeVersion: string
): Promise<AssembledFeature> {
  const input: AssembleFeatureInput = {
    featureKind,
    status: "UNAVAILABLE",
    value: null,
    unit,
    pair: PAIR,
    poolId,
    positionId,
    asOfUnixMs,
    expiresAtUnixMs: asOfUnixMs,
    confidence,
    freshness: {
      isStale: false,
      validUntilUnixMs: asOfUnixMs,
      derivedAt: asOfUnixMs,
      policyKind: featureKind,
      reasons: []
    },
    inputObservationIds,
    rejectedObservationIds,
    provenance: {
      sourceRefs: [],
      rawObservationRefs: [],
      derivedFromRefs: [],
      processRef: {
        collector: "deterministic-feature-derivation",
        jobName: "derive-mvp-features",
        pipelineRunId: null,
        codeVersion: null,
        modelVersion: null
      },
      codeVersion: calculatorVersion,
      runId: null
    },
    warnings: [],
    reasons,
    calculatorVersion,
    selectionVersion: SELECTION_VERSION,
    calculationMetadata
  };

  return assembleDerivedFeature({
    input,
    selectedRows: [],
    rejectedRows,
    evaluationAsOfUnixMs,
    runId,
    codeVersion
  });
}

async function checkExistingFeature(
  featureRepo: DerivedFeatureRepo,
  featureKind: FeatureKind,
  derivationKey: string
): Promise<DerivedFeatureRow | undefined> {
  return featureRepo.findByDerivationKey(featureKind, derivationKey);
}

async function derivePositionFeatures(
  positionId: string,
  poolId: string,
  positionRow: NormalizedObservationRow,
  evaluationAsOfUnixMs: number,
  runId: string,
  codeVersion: string
): Promise<DerivedFeatureInsert[]> {
  const payload = positionRow.payload as PositionStatePayloadV1;
  const inputObservationIds = [positionRow.id];
  const results: DerivedFeatureInsert[] = [];

  const rangeCalc = calculateRangeLocation(payload);
  const rangeKey = await assembleAvailableFeature(
    "range_location",
    rangeCalc.status,
    rangeCalc.value,
    "PPM",
    poolId,
    positionId,
    evaluationAsOfUnixMs,
    evaluationAsOfUnixMs + 3_600_000,
    buildDefaultConfidence(),
    inputObservationIds,
    [],
    rangeCalc.warnings,
    rangeCalc.reasons,
    RANGE_CALCULATOR_VERSIONS.range_location,
    rangeCalc.metadata,
    [positionRow],
    [],
    evaluationAsOfUnixMs,
    runId,
    codeVersion
  );
  results.push({
    featureKind: "range_location",
    signalClass: "deterministic",
    evidenceFamily: "clmm_state",
    value: rangeCalc.value,
    structuredPayload: rangeCalc.metadata,
    asOfUnixMs: evaluationAsOfUnixMs,
    confidence: buildDefaultConfidence(),
    validUntilUnixMs: evaluationAsOfUnixMs + 3_600_000,
    isStale: false,
    staleBehavior: null,
    provenance: rangeKey.result.provenance as Provenance,
    payloadHash: rangeKey.payloadHash,
    receivedAtUnixMs: evaluationAsOfUnixMs,
    status: rangeCalc.status,
    unit: "PPM",
    pair: PAIR,
    calculatorVersion: RANGE_CALCULATOR_VERSIONS.range_location,
    selectionVersion: SELECTION_VERSION,
    inputObservationIds,
    rejectedObservationIds: [],
    derivationKey: rangeKey.derivationKey,
    poolId,
    positionId,
    warnings: rangeKey.result.warnings,
    reasons: rangeKey.result.reasons
  });

  const distLowerCalc = calculateDistanceToLower(payload);
  const distLowerKey = await assembleAvailableFeature(
    "distance_to_lower",
    distLowerCalc.status,
    distLowerCalc.value,
    "PPM",
    poolId,
    positionId,
    evaluationAsOfUnixMs,
    evaluationAsOfUnixMs + 3_600_000,
    buildDefaultConfidence(),
    inputObservationIds,
    [],
    distLowerCalc.warnings,
    distLowerCalc.reasons,
    RANGE_CALCULATOR_VERSIONS.distance_to_lower,
    distLowerCalc.metadata,
    [positionRow],
    [],
    evaluationAsOfUnixMs,
    runId,
    codeVersion
  );
  results.push({
    featureKind: "distance_to_lower",
    signalClass: "deterministic",
    evidenceFamily: "clmm_state",
    value: distLowerCalc.value,
    structuredPayload: distLowerCalc.metadata,
    asOfUnixMs: evaluationAsOfUnixMs,
    confidence: buildDefaultConfidence(),
    validUntilUnixMs: evaluationAsOfUnixMs + 3_600_000,
    isStale: false,
    staleBehavior: null,
    provenance: distLowerKey.result.provenance as Provenance,
    payloadHash: distLowerKey.payloadHash,
    receivedAtUnixMs: evaluationAsOfUnixMs,
    status: distLowerCalc.status,
    unit: "PPM",
    pair: PAIR,
    calculatorVersion: RANGE_CALCULATOR_VERSIONS.distance_to_lower,
    selectionVersion: SELECTION_VERSION,
    inputObservationIds,
    rejectedObservationIds: [],
    derivationKey: distLowerKey.derivationKey,
    poolId,
    positionId,
    warnings: distLowerKey.result.warnings,
    reasons: distLowerKey.result.reasons
  });

  const distUpperCalc = calculateDistanceToUpper(payload);
  const distUpperKey = await assembleAvailableFeature(
    "distance_to_upper",
    distUpperCalc.status,
    distUpperCalc.value,
    "PPM",
    poolId,
    positionId,
    evaluationAsOfUnixMs,
    evaluationAsOfUnixMs + 3_600_000,
    buildDefaultConfidence(),
    inputObservationIds,
    [],
    distUpperCalc.warnings,
    distUpperCalc.reasons,
    RANGE_CALCULATOR_VERSIONS.distance_to_upper,
    distUpperCalc.metadata,
    [positionRow],
    [],
    evaluationAsOfUnixMs,
    runId,
    codeVersion
  );
  results.push({
    featureKind: "distance_to_upper",
    signalClass: "deterministic",
    evidenceFamily: "clmm_state",
    value: distUpperCalc.value,
    structuredPayload: distUpperCalc.metadata,
    asOfUnixMs: evaluationAsOfUnixMs,
    confidence: buildDefaultConfidence(),
    validUntilUnixMs: evaluationAsOfUnixMs + 3_600_000,
    isStale: false,
    staleBehavior: null,
    provenance: distUpperKey.result.provenance as Provenance,
    payloadHash: distUpperKey.payloadHash,
    receivedAtUnixMs: evaluationAsOfUnixMs,
    status: distUpperCalc.status,
    unit: "PPM",
    pair: PAIR,
    calculatorVersion: RANGE_CALCULATOR_VERSIONS.distance_to_upper,
    selectionVersion: SELECTION_VERSION,
    inputObservationIds,
    rejectedObservationIds: [],
    derivationKey: distUpperKey.derivationKey,
    poolId,
    positionId,
    warnings: distUpperKey.result.warnings,
    reasons: distUpperKey.result.reasons
  });

  return results;
}

async function deriveOracleDivergence(
  oracleRow: NormalizedObservationRow | null,
  dexRow: NormalizedObservationRow | null,
  rejectedRows: NormalizedObservationRow[],
  evaluationAsOfUnixMs: number,
  runId: string,
  codeVersion: string
): Promise<DerivedFeatureInsert> {
  if (!oracleRow || !dexRow) {
    const reasons: string[] = [];
    if (!oracleRow) reasons.push("missing_oracle");
    if (!dexRow) reasons.push("missing_dex");

    const assembled = await assembleUnavailableFeature(
      "oracle_dex_divergence",
      "BPS",
      null,
      null,
      evaluationAsOfUnixMs,
      buildDefaultConfidence(),
      [],
      rejectedRows.map((r) => r.id),
      reasons,
      MARKET_CALCULATOR_VERSIONS.oracle_dex_divergence,
      { reasons },
      rejectedRows,
      evaluationAsOfUnixMs,
      runId,
      codeVersion
    );

    return {
      featureKind: "oracle_dex_divergence",
      signalClass: "deterministic",
      evidenceFamily: "clmm_state",
      value: null,
      structuredPayload: { reasons },
      asOfUnixMs: evaluationAsOfUnixMs,
      confidence: buildDefaultConfidence(),
      validUntilUnixMs: evaluationAsOfUnixMs,
      isStale: false,
      staleBehavior: null,
      provenance: assembled.result.provenance as Provenance,
      payloadHash: assembled.payloadHash,
      receivedAtUnixMs: evaluationAsOfUnixMs,
      status: "UNAVAILABLE",
      unit: "BPS",
      pair: PAIR,
      calculatorVersion: MARKET_CALCULATOR_VERSIONS.oracle_dex_divergence,
      selectionVersion: SELECTION_VERSION,
      inputObservationIds: [],
      rejectedObservationIds: rejectedRows.map((r) => r.id),
      derivationKey: assembled.derivationKey,
      poolId: null,
      positionId: null,
      warnings: [],
      reasons
    };
  }

  const oracle = oracleRow.payload as OraclePricePayloadV1;
  const dex = dexRow.payload as ExecutableQuotePayloadV1;
  const calc = calculateOracleDexDivergence(oracle, dex, evaluationAsOfUnixMs);
  const inputIds = [oracleRow.id, dexRow.id];
  const rejectedIds = rejectedRows.map((r) => r.id);

  const divKey = await assembleAvailableFeature(
    "oracle_dex_divergence",
    calc.status,
    calc.value,
    "BPS",
    null,
    null,
    evaluationAsOfUnixMs,
    evaluationAsOfUnixMs + 3_600_000,
    buildDefaultConfidence(),
    inputIds,
    rejectedIds,
    calc.warnings,
    calc.reasons,
    MARKET_CALCULATOR_VERSIONS.oracle_dex_divergence,
    calc.metadata,
    [oracleRow, dexRow],
    rejectedRows,
    evaluationAsOfUnixMs,
    runId,
    codeVersion
  );

  return {
    featureKind: "oracle_dex_divergence",
    signalClass: "deterministic",
    evidenceFamily: "clmm_state",
    value: calc.value,
    structuredPayload: calc.metadata,
    asOfUnixMs: evaluationAsOfUnixMs,
    confidence: buildDefaultConfidence(),
    validUntilUnixMs: evaluationAsOfUnixMs + 3_600_000,
    isStale: false,
    staleBehavior: null,
    provenance: divKey.result.provenance as Provenance,
    payloadHash: divKey.payloadHash,
    receivedAtUnixMs: evaluationAsOfUnixMs,
    status: calc.status,
    unit: "BPS",
    pair: PAIR,
    calculatorVersion: MARKET_CALCULATOR_VERSIONS.oracle_dex_divergence,
    selectionVersion: SELECTION_VERSION,
    inputObservationIds: inputIds,
    rejectedObservationIds: rejectedIds,
    derivationKey: divKey.derivationKey,
    poolId: null,
    positionId: null,
    warnings: divKey.result.warnings,
    reasons: divKey.result.reasons
  };
}

async function deriveOracleConfidenceWidth(
  oracleRow: NormalizedObservationRow | null,
  rejectedRows: NormalizedObservationRow[],
  evaluationAsOfUnixMs: number,
  runId: string,
  codeVersion: string
): Promise<DerivedFeatureInsert> {
  if (!oracleRow) {
    const reasons = ["missing_oracle"];

    const assembled = await assembleUnavailableFeature(
      "oracle_confidence_width",
      "BPS",
      null,
      null,
      evaluationAsOfUnixMs,
      buildDefaultConfidence(),
      [],
      rejectedRows.map((r) => r.id),
      reasons,
      MARKET_CALCULATOR_VERSIONS.oracle_confidence_width,
      { reasons },
      rejectedRows,
      evaluationAsOfUnixMs,
      runId,
      codeVersion
    );

    return {
      featureKind: "oracle_confidence_width",
      signalClass: "deterministic",
      evidenceFamily: "clmm_state",
      value: null,
      structuredPayload: { reasons },
      asOfUnixMs: evaluationAsOfUnixMs,
      confidence: buildDefaultConfidence(),
      validUntilUnixMs: evaluationAsOfUnixMs,
      isStale: false,
      staleBehavior: null,
      provenance: assembled.result.provenance as Provenance,
      payloadHash: assembled.payloadHash,
      receivedAtUnixMs: evaluationAsOfUnixMs,
      status: "UNAVAILABLE",
      unit: "BPS",
      pair: PAIR,
      calculatorVersion: MARKET_CALCULATOR_VERSIONS.oracle_confidence_width,
      selectionVersion: SELECTION_VERSION,
      inputObservationIds: [],
      rejectedObservationIds: rejectedRows.map((r) => r.id),
      derivationKey: assembled.derivationKey,
      poolId: null,
      positionId: null,
      warnings: [],
      reasons
    };
  }

  const oracle = oracleRow.payload as OraclePricePayloadV1;
  const calc = calculateOracleConfidenceWidth(oracle, evaluationAsOfUnixMs);
  const inputIds = [oracleRow.id];

  const rejectedIds = rejectedRows.map((r) => r.id);

  const cwKey = await assembleAvailableFeature(
    "oracle_confidence_width",
    calc.status,
    calc.value,
    "BPS",
    null,
    null,
    evaluationAsOfUnixMs,
    evaluationAsOfUnixMs + 3_600_000,
    buildDefaultConfidence(),
    inputIds,
    rejectedIds,
    calc.warnings,
    calc.reasons,
    MARKET_CALCULATOR_VERSIONS.oracle_confidence_width,
    calc.metadata,
    [oracleRow],
    rejectedRows,
    evaluationAsOfUnixMs,
    runId,
    codeVersion
  );

  return {
    featureKind: "oracle_confidence_width",
    signalClass: "deterministic",
    evidenceFamily: "clmm_state",
    value: calc.value,
    structuredPayload: calc.metadata,
    asOfUnixMs: evaluationAsOfUnixMs,
    confidence: buildDefaultConfidence(),
    validUntilUnixMs: evaluationAsOfUnixMs + 3_600_000,
    isStale: false,
    staleBehavior: null,
    provenance: cwKey.result.provenance as Provenance,
    payloadHash: cwKey.payloadHash,
    receivedAtUnixMs: evaluationAsOfUnixMs,
    status: calc.status,
    unit: "BPS",
    pair: PAIR,
    calculatorVersion: MARKET_CALCULATOR_VERSIONS.oracle_confidence_width,
    selectionVersion: SELECTION_VERSION,
    inputObservationIds: inputIds,
    rejectedObservationIds: rejectedIds,
    derivationKey: cwKey.derivationKey,
    poolId: null,
    positionId: null,
    warnings: cwKey.result.warnings,
    reasons: cwKey.result.reasons
  };
}

async function deriveRealizedVolatility(
  priceRows: readonly NormalizedObservationRow[],
  rejectedRows: NormalizedObservationRow[],
  evaluationAsOfUnixMs: number,
  runId: string,
  codeVersion: string
): Promise<DerivedFeatureInsert> {
  if (priceRows.length === 0) {
    const reasons = ["no_price_observations"];

    const assembled = await assembleUnavailableFeature(
      "realized_volatility_1h",
      "BPS",
      null,
      null,
      evaluationAsOfUnixMs,
      buildDefaultConfidence(),
      [],
      rejectedRows.map((r) => r.id),
      reasons,
      REALIZED_VOLATILITY_1H_VERSION,
      { reasons },
      rejectedRows,
      evaluationAsOfUnixMs,
      runId,
      codeVersion
    );

    return {
      featureKind: "realized_volatility_1h",
      signalClass: "deterministic",
      evidenceFamily: "clmm_state",
      value: null,
      structuredPayload: { reasons },
      asOfUnixMs: evaluationAsOfUnixMs,
      confidence: buildDefaultConfidence(),
      validUntilUnixMs: evaluationAsOfUnixMs,
      isStale: false,
      staleBehavior: null,
      provenance: assembled.result.provenance as Provenance,
      payloadHash: assembled.payloadHash,
      receivedAtUnixMs: evaluationAsOfUnixMs,
      status: "UNAVAILABLE",
      unit: "BPS",
      pair: PAIR,
      calculatorVersion: REALIZED_VOLATILITY_1H_VERSION,
      selectionVersion: SELECTION_VERSION,
      inputObservationIds: [],
      rejectedObservationIds: rejectedRows.map((r) => r.id),
      derivationKey: assembled.derivationKey,
      poolId: null,
      positionId: null,
      warnings: [],
      reasons
    };
  }

  const observations = priceRows.map((r) => {
    const p = r.payload as {
      observedSource?: { slot?: number; observedAtUnixMs?: number };
      priceData?: { price?: string };
    };
    return {
      id: r.id,
      slot: p?.observedSource?.slot ?? 0,
      observedAtUnixMs: p?.observedSource?.observedAtUnixMs ?? r.receivedAtUnixMs,
      price: (p as { priceData: { price: string } })?.priceData?.price ?? "0",
      receivedAtUnixMs: r.receivedAtUnixMs
    };
  });

  const calc = calculateRealizedVolatility1h(observations, evaluationAsOfUnixMs);
  const inputIds = priceRows.map((r) => r.id);
  const rejectedIds = rejectedRows.map((r) => r.id);

  const volKey = await assembleAvailableFeature(
    "realized_volatility_1h",
    calc.status,
    calc.value,
    "BPS",
    null,
    null,
    evaluationAsOfUnixMs,
    evaluationAsOfUnixMs + 3_600_000,
    buildDefaultConfidence(),
    inputIds,
    rejectedIds,
    calc.warnings,
    calc.reasons,
    REALIZED_VOLATILITY_1H_VERSION,
    calc.metadata,
    priceRows,
    rejectedRows,
    evaluationAsOfUnixMs,
    runId,
    codeVersion
  );

  return {
    featureKind: "realized_volatility_1h",
    signalClass: "deterministic",
    evidenceFamily: "clmm_state",
    value: calc.value,
    structuredPayload: calc.metadata,
    asOfUnixMs: evaluationAsOfUnixMs,
    confidence: buildDefaultConfidence(),
    validUntilUnixMs: evaluationAsOfUnixMs + 3_600_000,
    isStale: false,
    staleBehavior: null,
    provenance: volKey.result.provenance as Provenance,
    payloadHash: volKey.payloadHash,
    receivedAtUnixMs: evaluationAsOfUnixMs,
    status: calc.status,
    unit: "BPS",
    pair: PAIR,
    calculatorVersion: REALIZED_VOLATILITY_1H_VERSION,
    selectionVersion: SELECTION_VERSION,
    inputObservationIds: inputIds,
    rejectedObservationIds: rejectedIds,
    derivationKey: volKey.derivationKey,
    poolId: null,
    positionId: null,
    warnings: volKey.result.warnings,
    reasons: volKey.result.reasons
  };
}

async function deriveVolumeRatio(
  poolStatsRow: NormalizedObservationRow | null,
  poolId: string,
  rejectedRows: NormalizedObservationRow[],
  evaluationAsOfUnixMs: number,
  runId: string,
  codeVersion: string
): Promise<DerivedFeatureInsert> {
  if (!poolStatsRow) {
    const reasons = ["missing_pool_stats"];

    const assembled = await assembleUnavailableFeature(
      "volume_liquidity_ratio_24h",
      "BPS",
      poolId,
      null,
      evaluationAsOfUnixMs,
      buildDefaultConfidence(),
      [],
      rejectedRows.map((r) => r.id),
      reasons,
      MARKET_CALCULATOR_VERSIONS.volume_liquidity_ratio_24h,
      { reasons },
      rejectedRows,
      evaluationAsOfUnixMs,
      runId,
      codeVersion
    );

    return {
      featureKind: "volume_liquidity_ratio_24h",
      signalClass: "deterministic",
      evidenceFamily: "clmm_state",
      value: null,
      structuredPayload: { reasons },
      asOfUnixMs: evaluationAsOfUnixMs,
      confidence: buildDefaultConfidence(),
      validUntilUnixMs: evaluationAsOfUnixMs,
      isStale: false,
      staleBehavior: null,
      provenance: assembled.result.provenance as Provenance,
      payloadHash: assembled.payloadHash,
      receivedAtUnixMs: evaluationAsOfUnixMs,
      status: "UNAVAILABLE",
      unit: "BPS",
      pair: PAIR,
      calculatorVersion: MARKET_CALCULATOR_VERSIONS.volume_liquidity_ratio_24h,
      selectionVersion: SELECTION_VERSION,
      inputObservationIds: [],
      rejectedObservationIds: rejectedRows.map((r) => r.id),
      derivationKey: assembled.derivationKey,
      poolId,
      positionId: null,
      warnings: [],
      reasons
    };
  }

  const pool = poolStatsRow.payload as PoolStatisticsPayloadV1;
  const calc = calculateVolumeLiquidityRatio24h(pool);
  const inputIds = [poolStatsRow.id];
  const rejectedIds = rejectedRows.map((r) => r.id);

  const vrKey = await assembleAvailableFeature(
    "volume_liquidity_ratio_24h",
    calc.status,
    calc.value,
    "BPS",
    poolId,
    null,
    evaluationAsOfUnixMs,
    evaluationAsOfUnixMs + 3_600_000,
    buildDefaultConfidence(),
    inputIds,
    rejectedIds,
    calc.warnings,
    calc.reasons,
    MARKET_CALCULATOR_VERSIONS.volume_liquidity_ratio_24h,
    calc.metadata,
    [poolStatsRow],
    rejectedRows,
    evaluationAsOfUnixMs,
    runId,
    codeVersion
  );

  return {
    featureKind: "volume_liquidity_ratio_24h",
    signalClass: "deterministic",
    evidenceFamily: "clmm_state",
    value: calc.value,
    structuredPayload: calc.metadata,
    asOfUnixMs: evaluationAsOfUnixMs,
    confidence: buildDefaultConfidence(),
    validUntilUnixMs: evaluationAsOfUnixMs + 3_600_000,
    isStale: false,
    staleBehavior: null,
    provenance: vrKey.result.provenance as Provenance,
    payloadHash: vrKey.payloadHash,
    receivedAtUnixMs: evaluationAsOfUnixMs,
    status: calc.status,
    unit: "BPS",
    pair: PAIR,
    calculatorVersion: MARKET_CALCULATOR_VERSIONS.volume_liquidity_ratio_24h,
    selectionVersion: SELECTION_VERSION,
    inputObservationIds: inputIds,
    rejectedObservationIds: rejectedIds,
    derivationKey: vrKey.derivationKey,
    poolId,
    positionId: null,
    warnings: vrKey.result.warnings,
    reasons: vrKey.result.reasons
  };
}

async function deriveUnavailablePositionFeatures(
  positionId: string,
  poolId: string,
  evaluationAsOfUnixMs: number,
  runId: string,
  codeVersion: string
): Promise<DerivedFeatureInsert[]> {
  const reasons = ["position_not_found"];
  const emptyRows: NormalizedObservationRow[] = [];

  const rangeAssembled = await assembleUnavailableFeature(
    "range_location",
    "PPM",
    poolId,
    positionId,
    evaluationAsOfUnixMs,
    buildDefaultConfidence(),
    [],
    [],
    reasons,
    RANGE_CALCULATOR_VERSIONS.range_location,
    { reasons },
    emptyRows,
    evaluationAsOfUnixMs,
    runId,
    codeVersion
  );

  const distLowerAssembled = await assembleUnavailableFeature(
    "distance_to_lower",
    "PPM",
    poolId,
    positionId,
    evaluationAsOfUnixMs,
    buildDefaultConfidence(),
    [],
    [],
    reasons,
    RANGE_CALCULATOR_VERSIONS.distance_to_lower,
    { reasons },
    emptyRows,
    evaluationAsOfUnixMs,
    runId,
    codeVersion
  );

  const distUpperAssembled = await assembleUnavailableFeature(
    "distance_to_upper",
    "PPM",
    poolId,
    positionId,
    evaluationAsOfUnixMs,
    buildDefaultConfidence(),
    [],
    [],
    reasons,
    RANGE_CALCULATOR_VERSIONS.distance_to_upper,
    { reasons },
    emptyRows,
    evaluationAsOfUnixMs,
    runId,
    codeVersion
  );

  return [
    {
      featureKind: "range_location",
      signalClass: "deterministic",
      evidenceFamily: "clmm_state",
      value: null,
      structuredPayload: { reasons },
      asOfUnixMs: evaluationAsOfUnixMs,
      confidence: buildDefaultConfidence(),
      validUntilUnixMs: evaluationAsOfUnixMs,
      isStale: false,
      staleBehavior: null,
      provenance: rangeAssembled.result.provenance as Provenance,
      payloadHash: rangeAssembled.payloadHash,
      receivedAtUnixMs: evaluationAsOfUnixMs,
      status: "UNAVAILABLE",
      unit: "PPM",
      pair: PAIR,
      calculatorVersion: RANGE_CALCULATOR_VERSIONS.range_location,
      selectionVersion: SELECTION_VERSION,
      inputObservationIds: [],
      rejectedObservationIds: [],
      derivationKey: rangeAssembled.derivationKey,
      poolId,
      positionId,
      warnings: [],
      reasons: ["position_not_found"]
    },
    {
      featureKind: "distance_to_lower",
      signalClass: "deterministic",
      evidenceFamily: "clmm_state",
      value: null,
      structuredPayload: { reasons },
      asOfUnixMs: evaluationAsOfUnixMs,
      confidence: buildDefaultConfidence(),
      validUntilUnixMs: evaluationAsOfUnixMs,
      isStale: false,
      staleBehavior: null,
      provenance: distLowerAssembled.result.provenance as Provenance,
      payloadHash: distLowerAssembled.payloadHash,
      receivedAtUnixMs: evaluationAsOfUnixMs,
      status: "UNAVAILABLE",
      unit: "PPM",
      pair: PAIR,
      calculatorVersion: RANGE_CALCULATOR_VERSIONS.distance_to_lower,
      selectionVersion: SELECTION_VERSION,
      inputObservationIds: [],
      rejectedObservationIds: [],
      derivationKey: distLowerAssembled.derivationKey,
      poolId,
      positionId,
      warnings: [],
      reasons: ["position_not_found"]
    },
    {
      featureKind: "distance_to_upper",
      signalClass: "deterministic",
      evidenceFamily: "clmm_state",
      value: null,
      structuredPayload: { reasons },
      asOfUnixMs: evaluationAsOfUnixMs,
      confidence: buildDefaultConfidence(),
      validUntilUnixMs: evaluationAsOfUnixMs,
      isStale: false,
      staleBehavior: null,
      provenance: distUpperAssembled.result.provenance as Provenance,
      payloadHash: distUpperAssembled.payloadHash,
      receivedAtUnixMs: evaluationAsOfUnixMs,
      status: "UNAVAILABLE",
      unit: "PPM",
      pair: PAIR,
      calculatorVersion: RANGE_CALCULATOR_VERSIONS.distance_to_upper,
      selectionVersion: SELECTION_VERSION,
      inputObservationIds: [],
      rejectedObservationIds: [],
      derivationKey: distUpperAssembled.derivationKey,
      poolId,
      positionId,
      warnings: [],
      reasons: ["position_not_found"]
    }
  ];
}

export async function deriveMvpFeatures(
  deps: DeriveMvpFeaturesDeps,
  request: DeriveMvpFeaturesRequest
): Promise<DeriveMvpFeaturesResult> {
  if (
    typeof request.evaluationTimeUnixMs !== "number" ||
    !Number.isFinite(request.evaluationTimeUnixMs) ||
    !Number.isInteger(request.evaluationTimeUnixMs) ||
    request.evaluationTimeUnixMs < 0
  ) {
    throw new Error(`Invalid evaluationTimeUnixMs: ${request.evaluationTimeUnixMs}`);
  }

  const { normalizedObservationRepo, featureRepo } = deps;
  const { poolId, positionIds, pipelineRunId, codeVersion, evaluationTimeUnixMs } = request;

  const evaluationAsOfUnixMs = evaluationTimeUnixMs;

  const windowStart = evaluationAsOfUnixMs - VOLATILITY_WINDOW_MS - WINDOW_SAFETY_MS;

  const candidates = await normalizedObservationRepo.listCandidates({
    sourceKinds: [
      { source: "clmm-v2-bundle", observationKind: "position_state" },
      { source: "pyth-hermes", observationKind: "oracle_price" },
      { source: "jupiter-quote", observationKind: "executable_quote" },
      { source: "orca-public-api", observationKind: "pool_statistics" }
    ],
    receivedAtOrAfterUnixMs: windowStart
  });

  // Full candidate rows keyed by their own normalized observation id. CandidateRejection
  // (returned by selectLatestBySourceAndKind/selectVolatilityTimestamps) only carries
  // {observationId, source, payloadHash} — it does not carry the rejected row's real
  // rawObservationId or provenance. Rejected-candidate placeholder rows built below must
  // look the real row up here rather than fabricating rawObservationId/provenance, or
  // buildLineage (src/domain/derived-feature/assemble.ts) silently persists a synthetic
  // "raw-hash-<id>" placeholder as if it were a real raw observation hash.
  const candidatesById = new Map<number, NormalizedObservationRow>();
  for (const row of candidates) {
    candidatesById.set(row.id, row);
  }

  const positionRowsById = new Map<string, NormalizedObservationRow>();
  for (const row of candidates) {
    if (row.observationKind === "position_state" && row.source === "clmm-v2-bundle") {
      const payload = row.payload as { positionId?: string };
      if (payload.positionId && positionIds.includes(payload.positionId)) {
        positionRowsById.set(payload.positionId, row);
      }
    }
  }

  const oracleCandidates = candidates.filter(
    (r) => r.observationKind === "oracle_price" && r.source === "pyth-hermes"
  );
  const dexCandidates = candidates.filter(
    (r) => r.observationKind === "executable_quote" && r.source === "jupiter-quote"
  );
  const poolStatsCandidates = candidates.filter(
    (r) => r.observationKind === "pool_statistics" && r.source === "orca-public-api"
  );

  const oracleSel = selectLatestBySourceAndKind(oracleCandidates, evaluationAsOfUnixMs);
  const dexSel = selectLatestBySourceAndKind(dexCandidates, evaluationAsOfUnixMs);
  const poolStatsSel = selectLatestBySourceAndKind(poolStatsCandidates, evaluationAsOfUnixMs);

  const oracleRow = oracleSel.selected[0] ?? null;
  const dexRow = dexSel.selected[0] ?? null;
  const poolStatsRow = poolStatsSel.selected[0] ?? null;

  const volatilityCandidates = candidates.filter(
    (r) => r.observationKind === "oracle_price" && r.source === "pyth-hermes"
  );
  const volatilitySel = selectVolatilityTimestamps(
    volatilityCandidates,
    evaluationAsOfUnixMs,
    VOLATILITY_WINDOW_MS
  );

  const allInserts: DerivedFeatureInsert[] = [];

  for (const positionId of positionIds) {
    const positionRow = positionRowsById.get(positionId) ?? null;
    if (positionRow) {
      const posFeatures = await derivePositionFeatures(
        positionId,
        poolId,
        positionRow,
        evaluationAsOfUnixMs,
        pipelineRunId,
        codeVersion
      );
      allInserts.push(...posFeatures);
    } else {
      const unavailableFeatures = await deriveUnavailablePositionFeatures(
        positionId,
        poolId,
        evaluationAsOfUnixMs,
        pipelineRunId,
        codeVersion
      );
      allInserts.push(...unavailableFeatures);
    }
  }

  // Rejected candidates only carry {observationId, source, payloadHash} — resolve back to
  // the full original row (real rawObservationId + real provenance) rather than fabricating
  // one, so buildLineage's raw-observation refs are never a synthetic "raw-hash-<id>"
  // placeholder standing in for real lineage data.
  function resolveRejectedRow(r: { observationId: number }): NormalizedObservationRow {
    const original = candidatesById.get(r.observationId);
    if (!original) {
      throw new Error(`Rejected candidate ${r.observationId} not found in original candidate set`);
    }
    return original;
  }

  const divergenceInsert = await deriveOracleDivergence(
    oracleRow,
    dexRow,
    [...oracleSel.rejected.map(resolveRejectedRow), ...dexSel.rejected.map(resolveRejectedRow)],
    evaluationAsOfUnixMs,
    pipelineRunId,
    codeVersion
  );
  allInserts.push(divergenceInsert);

  const confidenceWidthInsert = await deriveOracleConfidenceWidth(
    oracleRow,
    oracleSel.rejected.map(resolveRejectedRow),
    evaluationAsOfUnixMs,
    pipelineRunId,
    codeVersion
  );
  allInserts.push(confidenceWidthInsert);

  const volatilityInsert = await deriveRealizedVolatility(
    volatilitySel.selected,
    volatilitySel.rejected.map(resolveRejectedRow),
    evaluationAsOfUnixMs,
    pipelineRunId,
    codeVersion
  );
  allInserts.push(volatilityInsert);

  const volumeRatioInsert = await deriveVolumeRatio(
    poolStatsRow,
    poolId,
    poolStatsSel.rejected.map(resolveRejectedRow),
    evaluationAsOfUnixMs,
    pipelineRunId,
    codeVersion
  );
  allInserts.push(volumeRatioInsert);

  const validatedInserts: DerivedFeatureInsert[] = [];
  for (const insert of allInserts) {
    try {
      const confidence = insert.confidence ?? buildDefaultConfidence();
      const expiresAt =
        insert.validUntilUnixMs != null ? insert.validUntilUnixMs : evaluationAsOfUnixMs;
      const asDerivedFeatureV1: DerivedFeatureV1 = {
        schemaVersion: 1,
        featureKind: insert.featureKind,
        status: insert.status,
        value: insert.value ?? null,
        unit: insert.unit,
        pair: PAIR,
        poolId: insert.poolId ?? null,
        positionId: insert.positionId ?? null,
        asOfUnixMs: insert.asOfUnixMs,
        expiresAtUnixMs: expiresAt,
        confidence: {
          components: { ...confidence.components },
          compositeScore: confidence.compositeScore,
          level: confidence.level,
          weightingVersion: confidence.weightingVersion,
          reasons: [...confidence.reasons]
        },
        freshness: {
          isStale: insert.isStale ?? false,
          validUntilUnixMs: expiresAt,
          derivedAt: insert.asOfUnixMs,
          policyKind: insert.featureKind,
          reasons: []
        },
        inputObservationIds: (insert.inputObservationIds ?? []).slice().sort((a, b) => a - b),
        rejectedObservationIds: (insert.rejectedObservationIds ?? []).slice().sort((a, b) => a - b),
        provenance: insert.provenance as DerivedFeatureV1["provenance"],
        warnings: (insert.warnings ?? []).slice(),
        reasons: (insert.reasons ?? []).slice().sort((a, b) => a.localeCompare(b)),
        calculatorVersion: insert.calculatorVersion ?? "1.0.0",
        selectionVersion: insert.selectionVersion ?? SELECTION_VERSION,
        calculationMetadata: insert.structuredPayload as Record<string, unknown>
      };
      parseDerivedFeatureV1(asDerivedFeatureV1);
      validatedInserts.push(insert);
    } catch (err) {
      throw new Error(`Validation failed for feature ${insert.featureKind}: ${err}`);
    }
  }

  const existingRows: DerivedFeatureRow[] = [];
  const newInserts: DerivedFeatureInsert[] = [];

  for (const insert of validatedInserts) {
    const existing = await checkExistingFeature(
      featureRepo,
      insert.featureKind,
      insert.derivationKey
    );
    if (existing) {
      existingRows.push(existing);
    } else {
      newInserts.push(insert);
    }
  }

  let insertedRows: DerivedFeatureRow[] = [];
  if (newInserts.length > 0) {
    insertedRows = await featureRepo.insertMany(newInserts);
  }

  const allRows = [...existingRows, ...insertedRows];

  const counts: Record<FeatureStatus, number> = {
    AVAILABLE: 0,
    PARTIAL: 0,
    UNAVAILABLE: 0
  };
  for (const row of allRows) {
    counts[row.status]++;
  }

  return {
    rows: allRows,
    counts,
    warnings: []
  };
}
