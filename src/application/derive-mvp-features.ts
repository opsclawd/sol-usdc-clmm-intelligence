import type { Clock } from "../ports/clock.js";
import type { NormalizedObservationRepo } from "../ports/normalized-observation-repo.js";
import type {
  DerivedFeatureRepo,
  DerivedFeatureInsert,
  DerivedFeatureRow as PortDerivedFeatureRow
} from "../ports/feature-repo.js";
import type { NormalizedObservationRow } from "../contracts/index.js";
import type {
  FeatureKind,
  Confidence,
  SignalClass,
  EvidenceFamily
} from "../contracts/taxonomy.js";
import type { DerivedFeatureV1, FeatureStatus } from "../contracts/derived-feature.js";
import type { PositionStatePayloadV1 } from "../contracts/normalized-clmm-observation.js";
import type {
  OraclePricePayloadV1,
  ExecutableQuotePayloadV1
} from "../contracts/normalized-price-observation.js";
import type { PoolStatisticsPayloadV1 } from "../contracts/normalized-pool-statistics.js";
import {
  assembleDerivedFeature,
  type AssembleFeatureInput
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
import { canonicalHash } from "../domain/content-hash.js";

export interface DeriveMvpFeaturesRequest {
  readonly pair: "SOL/USDC";
  readonly poolId: string;
  readonly positionIds: readonly string[];
  readonly pipelineRunId: string;
  readonly codeVersion: string;
}

export interface DeriveMvpFeaturesDeps {
  readonly clock: Clock;
  readonly normalizedObservationRepo: NormalizedObservationRepo;
  readonly featureRepo: DerivedFeatureRepo;
}

export interface DeriveMvpFeaturesResult {
  readonly rows: readonly DerivedFeatureRow[];
  readonly counts: Readonly<Record<FeatureStatus, number>>;
  readonly warnings: readonly string[];
}

interface DerivedFeatureRow {
  id: number;
  featureKind: FeatureKind;
  signalClass: SignalClass;
  evidenceFamily: EvidenceFamily;
  value: number | null;
  structuredPayload: unknown;
  asOfUnixMs: number;
  confidence: Confidence;
  confidenceComposite: number | null;
  confidenceLevel: string | null;
  validUntilUnixMs: number | null;
  isStale: boolean;
  staleBehavior: string | null;
  provenance: unknown;
  payloadHash: string;
  receivedAtUnixMs: number;
  status: FeatureStatus;
  unit: "BPS" | "PPM";
  pair: string;
  calculatorVersion: string;
  selectionVersion: string;
  inputObservationIds: number[];
  rejectedObservationIds: number[];
  derivationKey: string;
  poolId: string | null;
  positionId: string | null;
}

const PAIR = "SOL/USDC" as const;
const WINDOW_SAFETY_MS = 300_000;

function parseClock(clock: Clock): number {
  return new Date(clock.now()).getTime();
}

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

async function computeUnavailableDerivationKey(
  featureKind: FeatureKind,
  poolId: string | null,
  positionId: string | null,
  calculatorVersion: string,
  codeVersion: string,
  reasons: readonly string[]
): Promise<string> {
  const identity = {
    schemaVersion: 1,
    featureKind,
    status: "UNAVAILABLE",
    poolId,
    positionId,
    calculatorVersion,
    selectionVersion: SELECTION_VERSION,
    codeVersion,
    inputObservationIds: [] as number[],
    rejectedObservationIds: [] as number[],
    reasons: [...reasons].sort()
  };
  return `dk-${await canonicalHash(identity)}`;
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
): Promise<{ derivationKey: string; payloadHash: string }> {
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

  const assembled = await assembleDerivedFeature({
    input,
    selectedRows,
    rejectedRows,
    evaluationAsOfUnixMs,
    runId,
    codeVersion
  });

  return {
    derivationKey: assembled.derivationKey,
    payloadHash: assembled.payloadHash
  };
}

async function checkExistingFeature(
  featureRepo: DerivedFeatureRepo,
  featureKind: FeatureKind,
  derivationKey: string
): Promise<PortDerivedFeatureRow | undefined> {
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
      codeVersion,
      runId
    },
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
    positionId
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
      codeVersion,
      runId
    },
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
    positionId
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
      codeVersion,
      runId
    },
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
    positionId
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

    const derivationKey = await computeUnavailableDerivationKey(
      "oracle_dex_divergence",
      null,
      null,
      MARKET_CALCULATOR_VERSIONS.oracle_dex_divergence,
      codeVersion,
      reasons
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
        codeVersion,
        runId
      },
      payloadHash: derivationKey.replace("dk-", ""),
      receivedAtUnixMs: evaluationAsOfUnixMs,
      status: "UNAVAILABLE",
      unit: "BPS",
      pair: PAIR,
      calculatorVersion: MARKET_CALCULATOR_VERSIONS.oracle_dex_divergence,
      selectionVersion: SELECTION_VERSION,
      inputObservationIds: [],
      rejectedObservationIds: rejectedRows.map((r) => r.id),
      derivationKey,
      poolId: null,
      positionId: null
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
      codeVersion,
      runId
    },
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
    positionId: null
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
    const derivationKey = await computeUnavailableDerivationKey(
      "oracle_confidence_width",
      null,
      null,
      MARKET_CALCULATOR_VERSIONS.oracle_confidence_width,
      codeVersion,
      reasons
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
        codeVersion,
        runId
      },
      payloadHash: derivationKey.replace("dk-", ""),
      receivedAtUnixMs: evaluationAsOfUnixMs,
      status: "UNAVAILABLE",
      unit: "BPS",
      pair: PAIR,
      calculatorVersion: MARKET_CALCULATOR_VERSIONS.oracle_confidence_width,
      selectionVersion: SELECTION_VERSION,
      inputObservationIds: [],
      rejectedObservationIds: rejectedRows.map((r) => r.id),
      derivationKey,
      poolId: null,
      positionId: null
    };
  }

  const oracle = oracleRow.payload as OraclePricePayloadV1;
  const calc = calculateOracleConfidenceWidth(oracle, evaluationAsOfUnixMs);
  const inputIds = [oracleRow.id];

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
    [],
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
      codeVersion,
      runId
    },
    payloadHash: cwKey.payloadHash,
    receivedAtUnixMs: evaluationAsOfUnixMs,
    status: calc.status,
    unit: "BPS",
    pair: PAIR,
    calculatorVersion: MARKET_CALCULATOR_VERSIONS.oracle_confidence_width,
    selectionVersion: SELECTION_VERSION,
    inputObservationIds: inputIds,
    rejectedObservationIds: [],
    derivationKey: cwKey.derivationKey,
    poolId: null,
    positionId: null
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
    const derivationKey = await computeUnavailableDerivationKey(
      "realized_volatility_1h",
      null,
      null,
      REALIZED_VOLATILITY_1H_VERSION,
      codeVersion,
      reasons
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
        codeVersion,
        runId
      },
      payloadHash: derivationKey.replace("dk-", ""),
      receivedAtUnixMs: evaluationAsOfUnixMs,
      status: "UNAVAILABLE",
      unit: "BPS",
      pair: PAIR,
      calculatorVersion: REALIZED_VOLATILITY_1H_VERSION,
      selectionVersion: SELECTION_VERSION,
      inputObservationIds: [],
      rejectedObservationIds: rejectedRows.map((r) => r.id),
      derivationKey,
      poolId: null,
      positionId: null
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
      codeVersion,
      runId
    },
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
    positionId: null
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
    const derivationKey = await computeUnavailableDerivationKey(
      "volume_liquidity_ratio_24h",
      poolId,
      null,
      MARKET_CALCULATOR_VERSIONS.volume_liquidity_ratio_24h,
      codeVersion,
      reasons
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
        codeVersion,
        runId
      },
      payloadHash: derivationKey.replace("dk-", ""),
      receivedAtUnixMs: evaluationAsOfUnixMs,
      status: "UNAVAILABLE",
      unit: "PPM",
      pair: PAIR,
      calculatorVersion: MARKET_CALCULATOR_VERSIONS.volume_liquidity_ratio_24h,
      selectionVersion: SELECTION_VERSION,
      inputObservationIds: [],
      rejectedObservationIds: rejectedRows.map((r) => r.id),
      derivationKey,
      poolId,
      positionId: null
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
    "PPM",
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
      codeVersion,
      runId
    },
    payloadHash: vrKey.payloadHash,
    receivedAtUnixMs: evaluationAsOfUnixMs,
    status: calc.status,
    unit: "PPM",
    pair: PAIR,
    calculatorVersion: MARKET_CALCULATOR_VERSIONS.volume_liquidity_ratio_24h,
    selectionVersion: SELECTION_VERSION,
    inputObservationIds: inputIds,
    rejectedObservationIds: rejectedIds,
    derivationKey: vrKey.derivationKey,
    poolId,
    positionId: null
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

  const rangeDerivationKey = await computeUnavailableDerivationKey(
    "range_location",
    poolId,
    positionId,
    RANGE_CALCULATOR_VERSIONS.range_location,
    codeVersion,
    reasons
  );

  const distLowerDerivationKey = await computeUnavailableDerivationKey(
    "distance_to_lower",
    poolId,
    positionId,
    RANGE_CALCULATOR_VERSIONS.distance_to_lower,
    codeVersion,
    reasons
  );

  const distUpperDerivationKey = await computeUnavailableDerivationKey(
    "distance_to_upper",
    poolId,
    positionId,
    RANGE_CALCULATOR_VERSIONS.distance_to_upper,
    codeVersion,
    reasons
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
        codeVersion,
        runId
      },
      payloadHash: rangeDerivationKey.replace("dk-", ""),
      receivedAtUnixMs: evaluationAsOfUnixMs,
      status: "UNAVAILABLE",
      unit: "PPM",
      pair: PAIR,
      calculatorVersion: RANGE_CALCULATOR_VERSIONS.range_location,
      selectionVersion: SELECTION_VERSION,
      inputObservationIds: [],
      rejectedObservationIds: [],
      derivationKey: rangeDerivationKey,
      poolId,
      positionId
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
        codeVersion,
        runId
      },
      payloadHash: distLowerDerivationKey.replace("dk-", ""),
      receivedAtUnixMs: evaluationAsOfUnixMs,
      status: "UNAVAILABLE",
      unit: "PPM",
      pair: PAIR,
      calculatorVersion: RANGE_CALCULATOR_VERSIONS.distance_to_lower,
      selectionVersion: SELECTION_VERSION,
      inputObservationIds: [],
      rejectedObservationIds: [],
      derivationKey: distLowerDerivationKey,
      poolId,
      positionId
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
        codeVersion,
        runId
      },
      payloadHash: distUpperDerivationKey.replace("dk-", ""),
      receivedAtUnixMs: evaluationAsOfUnixMs,
      status: "UNAVAILABLE",
      unit: "PPM",
      pair: PAIR,
      calculatorVersion: RANGE_CALCULATOR_VERSIONS.distance_to_upper,
      selectionVersion: SELECTION_VERSION,
      inputObservationIds: [],
      rejectedObservationIds: [],
      derivationKey: distUpperDerivationKey,
      poolId,
      positionId
    }
  ];
}

export async function deriveMvpFeatures(
  deps: DeriveMvpFeaturesDeps,
  request: DeriveMvpFeaturesRequest
): Promise<DeriveMvpFeaturesResult> {
  const { clock, normalizedObservationRepo, featureRepo } = deps;
  const { poolId, positionIds, pipelineRunId, codeVersion } = request;

  const evaluationAsOfUnixMs = parseClock(clock);

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

  const divergenceInsert = await deriveOracleDivergence(
    oracleRow,
    dexRow,
    [
      ...oracleSel.rejected.map(
        (r) => ({ ...oracleRow!, id: r.observationId }) as NormalizedObservationRow
      ),
      ...dexSel.rejected.map(
        (r) => ({ ...dexRow!, id: r.observationId }) as NormalizedObservationRow
      )
    ],
    evaluationAsOfUnixMs,
    pipelineRunId,
    codeVersion
  );
  allInserts.push(divergenceInsert);

  const confidenceWidthInsert = await deriveOracleConfidenceWidth(
    oracleRow,
    oracleSel.rejected.map(
      (r) => ({ ...oracleRow!, id: r.observationId }) as NormalizedObservationRow
    ),
    evaluationAsOfUnixMs,
    pipelineRunId,
    codeVersion
  );
  allInserts.push(confidenceWidthInsert);

  const volatilityInsert = await deriveRealizedVolatility(
    volatilitySel.selected,
    volatilitySel.rejected.map(
      (r) =>
        ({
          id: r.observationId,
          rawObservationId: r.observationId,
          source: "pyth-hermes" as const,
          observationKind: "oracle_price" as const,
          signalClass: "deterministic" as const,
          evidenceFamily: "clmm_state" as const,
          payload: {},
          payloadHash: "",
          confidence: buildDefaultConfidence(),
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
          receivedAtUnixMs: evaluationAsOfUnixMs
        }) as unknown as NormalizedObservationRow
    ),
    evaluationAsOfUnixMs,
    pipelineRunId,
    codeVersion
  );
  allInserts.push(volatilityInsert);

  const volumeRatioInsert = await deriveVolumeRatio(
    poolStatsRow,
    poolId,
    poolStatsSel.rejected.map(
      (r) => ({ ...poolStatsRow!, id: r.observationId }) as NormalizedObservationRow
    ),
    evaluationAsOfUnixMs,
    pipelineRunId,
    codeVersion
  );
  allInserts.push(volumeRatioInsert);

  const validatedInserts: DerivedFeatureInsert[] = [];
  for (const insert of allInserts) {
    try {
      const payloadReasons =
        (insert.structuredPayload as { reasons?: readonly string[] })?.reasons ?? [];
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
        warnings: [],
        reasons: [...payloadReasons].sort(),
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
