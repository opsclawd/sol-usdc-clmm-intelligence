import type {
  PerpCoverageRecordV1,
  PerpObservationKind,
  PerpObservationPayloadV1,
  PerpVenue
} from "../contracts/perp-liquidation.js";

export interface PerpLiquidationSourceRequest {
  readonly pair: "SOL/USDC";
  readonly fromUnixMs: number;
  readonly toUnixMs: number;
}

export type PerpMetricCoverage = PerpCoverageRecordV1;

export interface PerpLiquidationSourceFact {
  readonly venue: PerpVenue;
  readonly kind: PerpObservationKind;
  readonly payload: PerpObservationPayloadV1;
}

export interface PerpLiquidationSourceSnapshot {
  readonly source: PerpVenue;
  readonly providerRunId: string;
  readonly asOfUnixMs: number;
  readonly coverage: Readonly<Record<PerpObservationKind, PerpMetricCoverage>>;
  readonly facts: readonly PerpLiquidationSourceFact[];
}

export interface PerpLiquidationSourcePort {
  collect(request: PerpLiquidationSourceRequest): Promise<PerpLiquidationSourceSnapshot>;
}

export class PerpLiquidationSourceError extends Error {
  readonly code: "timeout" | "network" | "unavailable" | "malformed";

  constructor(code: "timeout" | "network" | "unavailable" | "malformed", message: string) {
    super(message);
    this.name = "PerpLiquidationSourceError";
    this.code = code;
  }
}
