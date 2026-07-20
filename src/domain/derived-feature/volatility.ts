import { parseDecimal, type Rational } from "./decimal.js";
import type { FeatureCalculation } from "./assemble.js";

export const REALIZED_VOLATILITY_1H_VERSION = "realized-volatility-1h/v1";
export const VOLATILITY_WINDOW_MS = 3_600_000;
export const VOLATILITY_MIN_SAMPLES = 10;
export const VOLATILITY_MIN_SPAN_MS = 2_700_000;
export const VOLATILITY_MAX_GAP_MS = 600_000;

export interface PriceObservation {
  readonly id: number;
  readonly slot: number;
  readonly observedAtUnixMs: number;
  readonly price: string;
}

type VolatilityResult = FeatureCalculation & {
  readonly metadata: Readonly<Record<string, unknown>>;
};

function makeUnavailable(
  reasons: readonly string[],
  metadata: Record<string, unknown> = {}
): VolatilityResult {
  return {
    status: "UNAVAILABLE",
    value: null,
    warnings: [],
    reasons: [...reasons],
    metadata
  };
}

function validatePositiveDecimal(value: string): { parsed: Rational } | { error: string } {
  const parsed = parseDecimal(value);
  if (typeof parsed === "string") {
    return { error: parsed };
  }
  if (parsed.numerator <= 0n) {
    return { error: "nonpositive_price" };
  }
  return { parsed };
}

function toFiniteNumber(rational: Rational): number {
  return Number(rational.numerator) / Number(rational.denominator);
}

export function calculateRealizedVolatility1h(
  observations: PriceObservation[],
  anchor: number
): VolatilityResult {
  if (observations.length === 0) {
    return makeUnavailable(["no_observations"]);
  }

  const windowStart = anchor - VOLATILITY_WINDOW_MS;

  const inWindow = observations.filter(
    (o) => o.observedAtUnixMs >= windowStart && o.observedAtUnixMs <= anchor
  );

  if (inWindow.length === 0) {
    return makeUnavailable(["no_observations_in_window"]);
  }

  const byTimestamp = new Map<number, PriceObservation[]>();
  for (const obs of inWindow) {
    const existing = byTimestamp.get(obs.observedAtUnixMs);
    if (existing) {
      existing.push(obs);
    } else {
      byTimestamp.set(obs.observedAtUnixMs, [obs]);
    }
  }

  const deduplicated: PriceObservation[] = [];
  const discardedDuplicateIds: number[] = [];

  for (const [, obsGroup] of byTimestamp) {
    obsGroup.sort((a, b) => {
      if (a.slot !== b.slot) return b.slot - a.slot;
      return b.id - a.id;
    });
    deduplicated.push(obsGroup[0]!);
    for (let i = 1; i < obsGroup.length; i++) {
      discardedDuplicateIds.push(obsGroup[i]!.id);
    }
  }

  deduplicated.sort((a, b) => a.observedAtUnixMs - b.observedAtUnixMs);

  if (deduplicated.length < VOLATILITY_MIN_SAMPLES) {
    return makeUnavailable(["insufficient_coverage"], {
      insufficientReason: "fewer_than_10_samples",
      sampleCount: deduplicated.length
    });
  }

  const firstTimestamp = deduplicated[0]!.observedAtUnixMs;
  const lastTimestamp = deduplicated[deduplicated.length - 1]!.observedAtUnixMs;
  const spanMs = lastTimestamp - firstTimestamp;

  if (spanMs < VOLATILITY_MIN_SPAN_MS) {
    return makeUnavailable(["insufficient_coverage"], {
      insufficientReason: "span_less_than_45_minutes",
      spanMs
    });
  }

  const validatedPrices: { price: number; timestamp: number }[] = [];
  for (const obs of deduplicated) {
    const validation = validatePositiveDecimal(obs.price);
    if ("error" in validation) {
      return makeUnavailable(["invalid_price"], { invalidPriceId: obs.id });
    }
    const finitePrice = toFiniteNumber(validation.parsed);
    if (!Number.isFinite(finitePrice)) {
      return makeUnavailable(["invalid_price"], { invalidPriceId: obs.id });
    }
    validatedPrices.push({ price: finitePrice, timestamp: obs.observedAtUnixMs });
  }

  let maxGapMs = 0;
  for (let i = 1; i < validatedPrices.length; i++) {
    const gap = validatedPrices[i]!.timestamp - validatedPrices[i - 1]!.timestamp;
    if (gap > maxGapMs) {
      maxGapMs = gap;
    }
  }

  if (maxGapMs > VOLATILITY_MAX_GAP_MS) {
    return makeUnavailable(["excessive_gap"], { maxGapMs, maxAllowedGapMs: VOLATILITY_MAX_GAP_MS });
  }

  let sumSquaredLogReturns = 0;
  for (let i = 1; i < validatedPrices.length; i++) {
    const prevPrice = validatedPrices[i - 1]!.price;
    const currPrice = validatedPrices[i]!.price;
    if (prevPrice <= 0 || currPrice <= 0) {
      return makeUnavailable(["invalid_price"]);
    }
    const logReturn = Math.log(currPrice / prevPrice);
    if (!Number.isFinite(logReturn)) {
      return makeUnavailable(["invalid_price"]);
    }
    sumSquaredLogReturns += logReturn ** 2;
  }

  const volatility = Math.sqrt(sumSquaredLogReturns);
  const scaledVolatility = volatility * 10_000;
  const roundedVolatility = Math.round(scaledVolatility);

  return {
    status: "AVAILABLE",
    value: roundedVolatility,
    warnings: [],
    reasons: [],
    metadata: {
      unit: "BPS" as const,
      sampleCount: validatedPrices.length,
      firstTimestampMs: firstTimestamp,
      lastTimestampMs: lastTimestamp,
      maxGapMs,
      discardedDuplicateIds: [...discardedDuplicateIds].sort((a, b) => a - b)
    }
  };
}
