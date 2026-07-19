import type {
  SourceCollectionOutcome,
  CoreCollectionStatus,
  CoreCollectionCounts,
  SourceWarning,
  CoreSourceKey
} from "../../contracts/collection-run.js";

type OutcomeCategory = "complete" | "partial" | "stale" | "absent" | "failed";

function getOutcomeCategory(outcome: SourceCollectionOutcome): OutcomeCategory {
  if (outcome.status === "conflict") {
    return "failed";
  }
  const isFresh = !outcome.freshness?.isStale;
  if ((outcome.status === "accepted" || outcome.status === "identical_replay") && isFresh) {
    return "complete";
  }
  if (outcome.status === "degraded" && outcome.hasUsableEvidence) {
    return "partial";
  }
  if (
    outcome.status === "stale" ||
    (outcome.freshness?.isStale &&
      (outcome.status === "accepted" || outcome.status === "identical_replay"))
  ) {
    return "stale";
  }
  if (
    outcome.status === "timeout" ||
    outcome.status === "network" ||
    outcome.status === "unavailable" ||
    outcome.status === "no_route"
  ) {
    return "absent";
  }
  return "failed";
}

export function reduceCoreCollectionStatus(
  outcomes: readonly SourceCollectionOutcome[]
): CoreCollectionStatus {
  if (outcomes.some((o) => o.status === "conflict")) {
    return "FAILED";
  }

  const categories = outcomes.map(getOutcomeCategory);
  const numComplete = categories.filter((c) => c === "complete").length;
  const numPartial = categories.filter((c) => c === "partial").length;
  const numStale = categories.filter((c) => c === "stale").length;
  const numAbsent = categories.filter((c) => c === "absent").length;

  if (numComplete === outcomes.length && outcomes.length > 0) {
    return "COMPLETE";
  }

  if (numComplete > 0 || numPartial > 0) {
    return "PARTIAL";
  }

  if (numAbsent + numStale === outcomes.length) {
    return "UNAVAILABLE";
  }

  return "FAILED";
}

export function countCoreCollectionOutcomes(
  outcomes: readonly SourceCollectionOutcome[]
): CoreCollectionCounts {
  let complete = 0;
  let partial = 0;
  let stale = 0;
  let absentOrFailed = 0;

  for (const o of outcomes) {
    const category = getOutcomeCategory(o);
    switch (category) {
      case "complete":
        complete++;
        break;
      case "partial":
        partial++;
        break;
      case "stale":
        stale++;
        break;
      case "absent":
      case "failed":
        absentOrFailed++;
        break;
    }
  }

  return { complete, partial, stale, absentOrFailed };
}

export function orderCoreWarnings(warnings: readonly SourceWarning[]): readonly SourceWarning[] {
  const sourceRank: Record<CoreSourceKey, number> = {
    "clmm-v2": 0,
    pyth: 1,
    jupiter: 2,
    orca: 3
  };

  return [...warnings].sort((a, b) => {
    const rankA = sourceRank[a.source] ?? 99;
    const rankB = sourceRank[b.source] ?? 99;
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    return a.code.localeCompare(b.code);
  });
}
