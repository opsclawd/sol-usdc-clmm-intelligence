import type { Source, ObservationKind, NormalizedObservationRow } from "../../contracts/index.js";

export const SELECTION_VERSION = "mvp-feature-selection/v1";

export interface CandidateRejection {
  readonly observationId: number;
  readonly reason: string;
}

export interface Selection<T> {
  readonly selected: readonly T[];
  readonly rejected: readonly CandidateRejection[];
}

export interface SourceKindFilter {
  readonly source: Source;
  readonly observationKind: ObservationKind;
}

export function selectLatestBySourceAndKind(
  candidates: readonly NormalizedObservationRow[],
  evaluationAsOfUnixMs: number,
  options?: {
    readonly allowedSources?: readonly SourceKindFilter[];
  }
): Selection<NormalizedObservationRow> {
  if (candidates.length === 0) {
    return { selected: [], rejected: [] };
  }

  const allowedSources = options?.allowedSources;
  const allowedSourceSet = allowedSources
    ? new Set(allowedSources.map(({ source, observationKind }) => `${source}:${observationKind}`))
    : null;

  const wrongSourceRejections: CandidateRejection[] = [];
  const validCandidates: NormalizedObservationRow[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.source}:${candidate.observationKind}`;
    if (allowedSourceSet !== null && !allowedSourceSet.has(key)) {
      wrongSourceRejections.push({
        observationId: candidate.id,
        reason: `wrong_source_kind: expected one of ${allowedSources!.map((s) => `${s.source}:${s.observationKind}`).join(", ")}, got ${key}`
      });
    } else {
      validCandidates.push(candidate);
    }
  }

  wrongSourceRejections.sort((a, b) => a.observationId - b.observationId);

  const expiredRejections: CandidateRejection[] = [];
  const notExpiredCandidates: NormalizedObservationRow[] = [];

  for (const candidate of validCandidates) {
    if (candidate.validUntilUnixMs !== null && candidate.validUntilUnixMs <= evaluationAsOfUnixMs) {
      expiredRejections.push({
        observationId: candidate.id,
        reason: `expired: validUntil=${candidate.validUntilUnixMs} <= evaluationAsOf=${evaluationAsOfUnixMs}`
      });
    } else {
      notExpiredCandidates.push(candidate);
    }
  }

  expiredRejections.sort((a, b) => a.observationId - b.observationId);

  if (notExpiredCandidates.length === 0) {
    return {
      selected: [],
      rejected: [...wrongSourceRejections, ...expiredRejections]
    };
  }

  notExpiredCandidates.sort((a, b) => {
    const payloadA = a.payload as VolatilityPayload;
    const payloadB = b.payload as VolatilityPayload;
    const slotA = payloadA?.observedSource?.slot ?? 0;
    const slotB = payloadB?.observedSource?.slot ?? 0;
    if (slotA !== slotB) {
      return slotB - slotA;
    }
    const semanticTimeA = payloadA?.observedSource?.observedAtUnixMs ?? 0;
    const semanticTimeB = payloadB?.observedSource?.observedAtUnixMs ?? 0;
    if (semanticTimeA !== semanticTimeB) {
      return semanticTimeB - semanticTimeA;
    }
    if (a.receivedAtUnixMs !== b.receivedAtUnixMs) {
      return b.receivedAtUnixMs - a.receivedAtUnixMs;
    }
    return a.id - b.id;
  });

  return {
    selected: [notExpiredCandidates[0]!],
    rejected: [...wrongSourceRejections, ...expiredRejections]
  };
}

interface VolatilityPayload {
  observedSource?: {
    slot?: number;
    observedAtUnixMs?: number;
  };
}

export function selectVolatilityTimestamps(
  candidates: readonly NormalizedObservationRow[],
  evaluationAsOfUnixMs: number,
  windowMs: number
): Selection<NormalizedObservationRow> {
  if (candidates.length === 0) {
    return { selected: [], rejected: [] };
  }

  const windowStart = evaluationAsOfUnixMs - windowMs;
  const anchorThreshold = evaluationAsOfUnixMs - 300000;

  const outsideWindowRejections: CandidateRejection[] = [];
  const anchorExpiredRejections: CandidateRejection[] = [];
  const windowCandidates: NormalizedObservationRow[] = [];

  for (const candidate of candidates) {
    if (
      candidate.receivedAtUnixMs < windowStart ||
      candidate.receivedAtUnixMs > evaluationAsOfUnixMs
    ) {
      outsideWindowRejections.push({
        observationId: candidate.id,
        reason: `outside_window: receivedAt=${candidate.receivedAtUnixMs} not in [${windowStart}, ${evaluationAsOfUnixMs}]`
      });
      continue;
    }
    windowCandidates.push(candidate);
  }

  if (windowCandidates.length === 0) {
    const allRejections = [...outsideWindowRejections];
    allRejections.sort((a, b) => a.observationId - b.observationId);
    return { selected: [], rejected: allRejections };
  }

  // Only candidates within the anchor threshold need to be fresh (they are
  // eligible to serve as the "latest" observation). Older, historical
  // samples in the window are retained regardless of expiry.
  const eligibleCandidates: NormalizedObservationRow[] = [];
  let hasFreshAnchor = false;

  for (const candidate of windowCandidates) {
    const isAnchorZone = candidate.receivedAtUnixMs >= anchorThreshold;
    const isFresh =
      candidate.validUntilUnixMs === null || candidate.validUntilUnixMs > evaluationAsOfUnixMs;

    if (isAnchorZone && !isFresh) {
      anchorExpiredRejections.push({
        observationId: candidate.id,
        reason: `anchor_expired: validUntil=${candidate.validUntilUnixMs} <= evaluationAsOf=${evaluationAsOfUnixMs}`
      });
      continue;
    }

    if (isAnchorZone && isFresh) {
      hasFreshAnchor = true;
    }

    eligibleCandidates.push(candidate);
  }

  if (!hasFreshAnchor) {
    const allRejections = [...outsideWindowRejections, ...anchorExpiredRejections];
    for (const candidate of eligibleCandidates) {
      allRejections.push({
        observationId: candidate.id,
        reason: `no_fresh_anchor: no candidate within anchorThreshold=${anchorThreshold} is fresh`
      });
    }
    allRejections.sort((a, b) => a.observationId - b.observationId);
    return { selected: [], rejected: allRejections };
  }

  const bySlot = new Map<number, NormalizedObservationRow[]>();
  for (const candidate of eligibleCandidates) {
    const payload = candidate.payload as VolatilityPayload;
    const slot = payload?.observedSource?.slot ?? 0;
    const group = bySlot.get(slot);
    if (group) {
      group.push(candidate);
    } else {
      bySlot.set(slot, [candidate]);
    }
  }

  const duplicateRejections: CandidateRejection[] = [];
  const selected: NormalizedObservationRow[] = [];

  for (const group of bySlot.values()) {
    group.sort((a, b) => {
      if (a.receivedAtUnixMs !== b.receivedAtUnixMs) {
        return a.receivedAtUnixMs - b.receivedAtUnixMs;
      }
      return b.id - a.id;
    });
    selected.push(group[0]!);
    for (const duplicate of group.slice(1)) {
      duplicateRejections.push({
        observationId: duplicate.id,
        reason: `duplicate_slot: slot=${(duplicate.payload as VolatilityPayload)?.observedSource?.slot ?? 0}`
      });
    }
  }

  selected.sort((a, b) => a.receivedAtUnixMs - b.receivedAtUnixMs);

  const allRejections = [
    ...outsideWindowRejections,
    ...anchorExpiredRejections,
    ...duplicateRejections
  ];
  allRejections.sort((a, b) => a.observationId - b.observationId);

  return {
    selected,
    rejected: allRejections
  };
}

export function selectWithExpiryCheck(
  candidates: readonly NormalizedObservationRow[],
  evaluationAsOfUnixMs: number
): Selection<NormalizedObservationRow> {
  if (candidates.length === 0) {
    return { selected: [], rejected: [] };
  }

  const rejections: CandidateRejection[] = [];
  const validCandidates: NormalizedObservationRow[] = [];

  for (const candidate of candidates) {
    if (candidate.validUntilUnixMs !== null && candidate.validUntilUnixMs <= evaluationAsOfUnixMs) {
      rejections.push({
        observationId: candidate.id,
        reason: `expired: validUntil=${candidate.validUntilUnixMs} <= evaluationAsOf=${evaluationAsOfUnixMs}`
      });
    } else {
      validCandidates.push(candidate);
    }
  }

  rejections.sort((a, b) => a.observationId - b.observationId);

  return {
    selected: validCandidates,
    rejected: rejections
  };
}
