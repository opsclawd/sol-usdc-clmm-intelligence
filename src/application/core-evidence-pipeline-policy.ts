import type { DerivedFeatureRow } from "../ports/feature-repo.js";

export const REQUIRED_POSITION_FEATURE_KINDS = [
  "range_location",
  "distance_to_lower",
  "distance_to_upper"
] as const;

export type PositionPipelineStatus = "complete" | "degraded" | "failed";
export type CoreEvidencePipelineStatus =
  | "complete"
  | "degraded"
  | "partial_failure"
  | "failed"
  | "skipped_already_running";

export interface PositionGateResult {
  readonly usable: boolean;
  readonly reasons: readonly string[];
}

export function buildPositionCorrelationId(pipelineRunId: string, positionId: string): string {
  if (!pipelineRunId || !pipelineRunId.trim()) {
    throw new Error("pipelineRunId must not be empty");
  }
  if (!positionId || !positionId.trim()) {
    throw new Error("positionId must not be empty");
  }
  return `run:${pipelineRunId}:position:${positionId}`;
}

export function evaluatePositionFeatureGate(input: {
  rows: readonly DerivedFeatureRow[];
  poolId: string;
  positionId: string;
  evaluationTimeUnixMs: number;
}): PositionGateResult {
  const reasons: string[] = [];

  for (const kind of REQUIRED_POSITION_FEATURE_KINDS) {
    const candidates = input.rows.filter((r) => r.featureKind === kind);
    if (candidates.length === 0) {
      reasons.push(`missing:${kind}`);
      continue;
    }
    if (candidates.length > 1) {
      reasons.push(`duplicate:${kind}`);
      continue;
    }

    const row = candidates[0]!;
    if (row.poolId !== input.poolId || row.positionId !== input.positionId) {
      reasons.push(`wrong_scope:${kind}`);
    }
    if (row.asOfUnixMs !== input.evaluationTimeUnixMs) {
      reasons.push(`wrong_evaluation_time:${kind}`);
    }
    if (row.validUntilUnixMs === null || row.validUntilUnixMs <= input.evaluationTimeUnixMs) {
      reasons.push(`stale:${kind}`);
    }
    if (row.status !== "AVAILABLE" && row.status !== "PARTIAL") {
      reasons.push(`unusable:${kind}`);
    }
    if (!row.inputObservationIds || row.inputObservationIds.length === 0) {
      reasons.push(`missing_input:${kind}`);
    }
  }

  reasons.sort();
  Object.freeze(reasons);

  return {
    usable: reasons.length === 0,
    reasons
  };
}

export function aggregatePipelineStatus(
  collectionStatus: "COMPLETE" | "PARTIAL",
  positions: readonly { status: PositionPipelineStatus }[]
): Exclude<CoreEvidencePipelineStatus, "skipped_already_running"> {
  const publishedCount = positions.filter(
    (p) => p.status === "complete" || p.status === "degraded"
  ).length;
  const failedCount = positions.filter((p) => p.status === "failed").length;

  if (publishedCount === 0) {
    return "failed";
  }

  if (failedCount > 0) {
    return "partial_failure";
  }

  const degradedCount = positions.filter((p) => p.status === "degraded").length;
  if (collectionStatus === "PARTIAL" || degradedCount > 0) {
    return "degraded";
  }

  return "complete";
}
