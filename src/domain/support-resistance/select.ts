import type { NormalizedObservationRow } from "../../contracts/normalized-observation.js";
import type { SupportResistancePayloadV1 } from "../../contracts/support-resistance.js";

export interface SupportResistanceSelectionRequest {
  readonly evaluationTimeUnixMs: number;
  readonly candidates: readonly NormalizedObservationRow[];
  readonly maxItems: number;
  readonly currentPriceUsdcPerSol?: number;
}

export interface SelectedSupportResistance {
  readonly row: NormalizedObservationRow;
  readonly payload: SupportResistancePayloadV1;
}

type RankTuple = readonly [
  proximityBucket: number,
  proximityDistance: number,
  negativeConfidence: number,
  timeframeRank: number,
  negativeAsOf: number,
  payloadHash: string,
  rowId: number
];

const KNOWN_TIMEFRAME_RANKS: Record<string, number> = {
  "1h": 1,
  "4h": 2,
  "1d": 3,
  "1w": 4
};

function isSupportResistancePayload(payload: unknown): payload is SupportResistancePayloadV1 {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const p = payload as SupportResistancePayloadV1;
  if (
    p.kind !== "support_resistance_level" ||
    p.pair !== "SOL/USDC" ||
    (p.evidenceSide !== "SUPPORT" && p.evidenceSide !== "RESISTANCE") ||
    typeof p.timeframe !== "string" ||
    !Array.isArray(p.thesisCodes) ||
    typeof p.asOfUnixMs !== "number" ||
    !Number.isFinite(p.asOfUnixMs) ||
    typeof p.expiresAtUnixMs !== "number" ||
    !Number.isFinite(p.expiresAtUnixMs)
  ) {
    return false;
  }

  if (p.levelType === "point") {
    if (
      typeof p.levelUsdcPerSol !== "number" ||
      !Number.isFinite(p.levelUsdcPerSol) ||
      p.levelUsdcPerSol <= 0
    ) {
      return false;
    }
  } else if (p.levelType === "zone") {
    if (
      typeof p.zoneLowerUsdcPerSol !== "number" ||
      !Number.isFinite(p.zoneLowerUsdcPerSol) ||
      p.zoneLowerUsdcPerSol <= 0 ||
      typeof p.zoneUpperUsdcPerSol !== "number" ||
      !Number.isFinite(p.zoneUpperUsdcPerSol) ||
      p.zoneUpperUsdcPerSol <= 0 ||
      p.zoneLowerUsdcPerSol >= p.zoneUpperUsdcPerSol
    ) {
      return false;
    }
  } else {
    return false;
  }

  return true;
}

function isEligible(
  row: NormalizedObservationRow,
  evaluationTimeUnixMs: number
): row is NormalizedObservationRow & { payload: SupportResistancePayloadV1 } {
  if (
    row.source !== "technical-analysis-api" ||
    row.observationKind !== "support_resistance_level"
  ) {
    return false;
  }

  if (row.isStale) {
    return false;
  }

  if (!isSupportResistancePayload(row.payload)) {
    return false;
  }

  const payload = row.payload;

  if (payload.asOfUnixMs > evaluationTimeUnixMs) {
    return false;
  }

  if (payload.expiresAtUnixMs <= evaluationTimeUnixMs) {
    return false;
  }

  if (row.validUntilUnixMs !== null && row.validUntilUnixMs !== undefined) {
    if (row.validUntilUnixMs <= evaluationTimeUnixMs) {
      return false;
    }
    if (row.validUntilUnixMs !== payload.expiresAtUnixMs) {
      return false;
    }
  }

  return true;
}

function deriveEquivalenceKey(payload: SupportResistancePayloadV1): string {
  const sortedThesis = [...payload.thesisCodes].sort().join(",");
  const levelPart =
    payload.levelType === "point"
      ? `point:${payload.levelUsdcPerSol}`
      : `zone:${payload.zoneLowerUsdcPerSol}-${payload.zoneUpperUsdcPerSol}`;
  return `${payload.evidenceSide}::${payload.levelType}::${levelPart}::${payload.timeframe}::${sortedThesis}`;
}

function computeProximity(
  payload: SupportResistancePayloadV1,
  currentPriceUsdcPerSol?: number
): { bucket: number; distance: number } {
  const hasValidPrice =
    currentPriceUsdcPerSol !== undefined &&
    typeof currentPriceUsdcPerSol === "number" &&
    Number.isFinite(currentPriceUsdcPerSol) &&
    currentPriceUsdcPerSol > 0;

  if (!hasValidPrice) {
    return { bucket: 1, distance: 0 };
  }

  const price = currentPriceUsdcPerSol;
  if (payload.levelType === "point") {
    return { bucket: 0, distance: Math.abs(payload.levelUsdcPerSol - price) };
  }

  const lower = payload.zoneLowerUsdcPerSol;
  const upper = payload.zoneUpperUsdcPerSol;
  if (price >= lower && price <= upper) {
    return { bucket: 0, distance: 0 };
  } else if (price < lower) {
    return { bucket: 0, distance: lower - price };
  } else {
    return { bucket: 0, distance: price - upper };
  }
}

function compareRankTuples(a: RankTuple, b: RankTuple): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  if (a[2] !== b[2]) return a[2] - b[2];
  if (a[3] !== b[3]) return a[3] - b[3];
  if (a[4] !== b[4]) return a[4] - b[4];
  const hashCmp = a[5].localeCompare(b[5]);
  if (hashCmp !== 0) return hashCmp;
  return a[6] - b[6];
}

export function selectSupportResistanceClaims(
  request: SupportResistanceSelectionRequest
): readonly SelectedSupportResistance[] {
  const { evaluationTimeUnixMs, candidates, maxItems, currentPriceUsdcPerSol } = request;

  const eligible: Array<{
    row: NormalizedObservationRow;
    payload: SupportResistancePayloadV1;
  }> = [];

  for (const row of candidates) {
    if (isEligible(row, evaluationTimeUnixMs)) {
      eligible.push({ row, payload: row.payload });
    }
  }

  if (eligible.length === 0) {
    return [];
  }

  // Map timeframes to ranks: known 1h..1w -> 1..4, unknown lexically sorted -> 5+
  const unknownTimeframesSet = new Set<string>();
  for (const item of eligible) {
    if (!(item.payload.timeframe in KNOWN_TIMEFRAME_RANKS)) {
      unknownTimeframesSet.add(item.payload.timeframe);
    }
  }
  const sortedUnknownTimeframes = [...unknownTimeframesSet].sort();
  const unknownTimeframeRanks = new Map<string, number>();
  sortedUnknownTimeframes.forEach((tf, idx) => {
    unknownTimeframeRanks.set(tf, 5 + idx);
  });

  const rankedItems = eligible.map((item) => {
    const proximity = computeProximity(item.payload, currentPriceUsdcPerSol);
    const confidenceVal = item.row.confidenceComposite ?? item.row.confidence?.compositeScore ?? 0;
    const negativeConfidence = -confidenceVal;

    const timeframeRank =
      KNOWN_TIMEFRAME_RANKS[item.payload.timeframe] ??
      unknownTimeframeRanks.get(item.payload.timeframe) ??
      99;

    const negativeAsOf = -item.payload.asOfUnixMs;

    const rankTuple: RankTuple = [
      proximity.bucket,
      proximity.distance,
      negativeConfidence,
      timeframeRank,
      negativeAsOf,
      item.row.payloadHash,
      item.row.id
    ];

    const equivalenceKey = deriveEquivalenceKey(item.payload);

    return {
      item,
      rankTuple,
      equivalenceKey
    };
  });

  rankedItems.sort((a, b) => compareRankTuples(a.rankTuple, b.rankTuple));

  const selected: SelectedSupportResistance[] = [];
  const seenEquivalenceKeys = new Set<string>();

  for (const ranked of rankedItems) {
    if (!seenEquivalenceKeys.has(ranked.equivalenceKey)) {
      seenEquivalenceKeys.add(ranked.equivalenceKey);
      selected.push(ranked.item);
    }
  }

  const clampedMaxItems = Math.max(0, Math.min(16, Math.floor(maxItems)));
  return selected.slice(0, clampedMaxItems);
}
