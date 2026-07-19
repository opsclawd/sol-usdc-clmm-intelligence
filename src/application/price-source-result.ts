import type { Freshness } from "../contracts/taxonomy.js";
import type { ConfidenceLevel } from "../contracts/taxonomy.js";
import type { PriceObservationWarning } from "../contracts/normalized-price-observation.js";

export type AcceptedResult = Readonly<{
  status: "accepted";
  rawObservationId: number;
  normalizedCount: number;
  warnings: readonly PriceObservationWarning[];
  freshness: Freshness;
  confidenceLevel: ConfidenceLevel;
}>;

export type IdenticalReplayResult = Readonly<{
  status: "identical_replay";
  rawObservationId: number;
  normalizedCount: number;
  warnings: readonly PriceObservationWarning[];
  freshness: Freshness;
  confidenceLevel: ConfidenceLevel;
}>;

export type StaleResult = Readonly<{
  status: "stale";
  rawObservationId: number;
  normalizedCount: number;
  warnings: readonly PriceObservationWarning[];
  freshness: Freshness;
  confidenceLevel: ConfidenceLevel;
}>;

export type DegradedResult = Readonly<{
  status: "degraded";
  rawObservationId: number;
  normalizedCount: number;
  warnings: readonly PriceObservationWarning[];
  freshness: Freshness;
  confidenceLevel: ConfidenceLevel;
  reason: string;
}>;

export type TimeoutResult = Readonly<{
  status: "timeout";
  summary: string;
}>;

export type UnavailableResult = Readonly<{
  status: "unavailable";
  summary: string;
  httpStatus: number | null;
}>;

export type MalformedResult = Readonly<{
  status: "malformed";
  summary: string;
}>;

export type NoRouteResult = Readonly<{
  status: "no_route";
  summary: string;
}>;

export type ConflictResult = Readonly<{
  status: "conflict";
  summary: string;
  existingPayloadHash: string;
  incomingPayloadHash: string;
}>;

export type FailedResult = Readonly<{
  status: "failed";
  summary: string;
}>;

export type PriceSourceResult =
  | AcceptedResult
  | IdenticalReplayResult
  | StaleResult
  | DegradedResult
  | TimeoutResult
  | UnavailableResult
  | MalformedResult
  | NoRouteResult
  | ConflictResult
  | FailedResult;

function redactSecrets(text: string): string {
  return text
    .replace(/api[_-]?key/gi, "[REDACTED]")
    .replace(/bearer/gi, "[REDACTED]")
    .replace(/token/gi, "[REDACTED]")
    .replace(/auth/gi, "[REDACTED]")
    .replace(/secret/gi, "[REDACTED]");
}

export function safeSummary(result: PriceSourceResult): string {
  switch (result.status) {
    case "accepted":
      return `accepted|id=${result.rawObservationId}|norm=${result.normalizedCount}|fresh=${result.freshness.isStale}|level=${result.confidenceLevel}`;
    case "identical_replay":
      return `identical_replay|id=${result.rawObservationId}|norm=${result.normalizedCount}|fresh=${result.freshness.isStale}`;
    case "stale":
      return `stale|id=${result.rawObservationId}|norm=${result.normalizedCount}|reasons=${result.freshness.reasons.join(",")}`;
    case "degraded":
      return `degraded|id=${result.rawObservationId}|reason=${result.reason}|warnings=${result.warnings.join(",")}`;
    case "timeout":
      return `timeout|${redactSecrets(result.summary)}`;
    case "unavailable":
      return `unavailable|${redactSecrets(result.summary)}|status=${result.httpStatus}`;
    case "malformed":
      return `malformed|${redactSecrets(result.summary)}`;
    case "no_route":
      return `no_route|${redactSecrets(result.summary)}`;
    case "conflict":
      return `conflict|existing=${result.existingPayloadHash.slice(0, 8)}|incoming=${result.incomingPayloadHash.slice(0, 8)}`;
    case "failed":
      return `failed|${redactSecrets(result.summary)}`;
    default:
      return `unknown`;
  }
}

export const PriceSourceResult = {
  safeSummary
} as const;
