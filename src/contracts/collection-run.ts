import type { Source, ConfidenceLevel, Freshness } from "./taxonomy.js";

export interface CollectionRunContext {
  readonly runId: string;
  readonly startedAtUnixMs: number;
}

export type CoreSourceKey = "clmm-v2" | "pyth" | "jupiter" | "orca";

export type SourceOutcomeStatus =
  | "accepted"
  | "identical_replay"
  | "degraded"
  | "stale"
  | "timeout"
  | "network"
  | "unavailable"
  | "malformed"
  | "no_route"
  | "conflict"
  | "failed";

export type CoreCollectionStatus = "COMPLETE" | "PARTIAL" | "UNAVAILABLE" | "FAILED";

export interface SourceWarning {
  readonly source: CoreSourceKey;
  readonly code: string;
  readonly message: string | null;
}

export interface SourceCollectionOutcome {
  readonly sourceKey: CoreSourceKey;
  readonly source: Source;
  readonly status: SourceOutcomeStatus;
  readonly hasUsableEvidence: boolean;
  readonly rawObservationId: number | null;
  readonly normalizedCount: number;
  readonly warnings: readonly SourceWarning[];
  readonly freshness: Freshness | null;
  readonly confidenceLevel: ConfidenceLevel | null;
  readonly diagnostic: string | null;
}

export interface CoreCollectionCounts {
  readonly complete: number;
  readonly partial: number;
  readonly stale: number;
  readonly absentOrFailed: number;
}

export interface CoreCollectionResult {
  readonly context: CollectionRunContext;
  readonly clmmV2: SourceCollectionOutcome;
  readonly pyth: SourceCollectionOutcome;
  readonly jupiter: SourceCollectionOutcome;
  readonly orca: SourceCollectionOutcome;
  readonly warnings: readonly SourceWarning[];
  readonly counts: CoreCollectionCounts;
  readonly status: CoreCollectionStatus;
  readonly shouldFailCommand: boolean;
}
