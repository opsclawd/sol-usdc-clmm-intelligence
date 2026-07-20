import type { Source, ObservationKind } from "../../contracts/taxonomy.js";
import type { NormalizedObservationRow } from "../../ports/normalized-observation-repo.js";

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

  const outsideWindowRejections: CandidateRejection[] = [];
  const anchorRejections: CandidateRejection[] = [];
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
    const allRejections = [...outsideWindowRejections, ...anchorRejections];
    allRejections.sort((a, b) => a.observationId - b.observationId);
    return { selected: [], rejected: allRejections };
  }

  const anchorThreshold = evaluationAsOfUnixMs - 300000;
  const anchorCandidates = windowCandidates.filter((c) => c.receivedAtUnixMs >= anchorThreshold);

  const freshAnchorCandidates = anchorCandidates.filter(
    (c) => c.validUntilUnixMs === null || c.validUntilUnixMs > evaluationAsOfUnixMs
  );

  if (freshAnchorCandidates.length === 0) {
    for (const c of anchorCandidates) {
      anchorRejections.push({
        observationId: c.id,
        reason: `anchor_expired: validUntil=${c.validUntilUnixMs} <= evaluationAsOf=${evaluationAsOfUnixMs}`
      });
    }
    for (const c of windowCandidates) {
      if (!anchorCandidates.includes(c)) {
        anchorRejections.push({
          observationId: c.id,
          reason: `no_fresh_anchor: candidate receipt=${c.receivedAtUnixMs} < anchorThreshold=${anchorThreshold}`
        });
      }
    }
    const allRejections = [...outsideWindowRejections, ...anchorRejections];
    allRejections.sort((a, b) => a.observationId - b.observationId);
    return { selected: [], rejected: allRejections };
  }

  freshAnchorCandidates.sort((a, b) => {
    if (b.receivedAtUnixMs !== a.receivedAtUnixMs) {
      return b.receivedAtUnixMs - a.receivedAtUnixMs;
    }
    return a.id - b.id;
  });

  const latestAnchor = freshAnchorCandidates[0]!;

  const deduplicatedMap = new Map<number, NormalizedObservationRow>();
  const duplicateRejections: CandidateRejection[] = [];

  const anchorPayload = latestAnchor.payload as VolatilityPayload;
  const anchorSlot = anchorPayload?.observedSource?.slot ?? 0;
  deduplicatedMap.set(anchorSlot, latestAnchor);

  const nonAnchorCandidates = windowCandidates.filter((c) => c.id !== latestAnchor.id);

  nonAnchorCandidates.sort((a, b) => {
    const payloadA = a.payload as VolatilityPayload;
    const payloadB = b.payload as VolatilityPayload;
    const slotA = payloadA?.observedSource?.slot ?? 0;
    const slotB = payloadB?.observedSource?.slot ?? 0;

    if (slotA !== slotB) {
      return slotB - slotA;
    }
    if (a.receivedAtUnixMs !== b.receivedAtUnixMs) {
      return b.receivedAtUnixMs - a.receivedAtUnixMs;
    }
    return a.id - b.id;
  });

  for (const candidate of nonAnchorCandidates) {
    const payload = candidate.payload as VolatilityPayload;
    const slot = payload?.observedSource?.slot ?? 0;

    if (deduplicatedMap.has(slot)) {
      duplicateRejections.push({
        observationId: candidate.id,
        reason: `duplicate_slot: slot=${slot}`
      });
    } else {
      deduplicatedMap.set(slot, candidate);
    }
  }

  const selected = Array.from(deduplicatedMap.values()).sort(
    (a, b) => a.receivedAtUnixMs - b.receivedAtUnixMs
  );

  const allRejections = [...outsideWindowRejections, ...anchorRejections, ...duplicateRejections];
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
