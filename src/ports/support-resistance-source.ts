export interface SupportResistanceSourceRequest {
  readonly pair: "SOL/USDC";
}

export interface SupportResistanceSourceClaim {
  readonly levelType: "point" | "zone";
  readonly levelUsdcPerSol?: number;
  readonly zoneLowerUsdcPerSol?: number;
  readonly zoneUpperUsdcPerSol?: number;
  readonly evidenceSide: "SUPPORT" | "RESISTANCE";
  readonly timeframe: string;
  readonly sourceReferences: readonly string[];
}

export interface SupportResistanceSourceSnapshot {
  readonly providerId: string;
  readonly providerRunId: string;
  readonly pair: "SOL/USDC";
  readonly asOfUnixMs: number;
  readonly claims: readonly SupportResistanceSourceClaim[];
}

export type SupportResistanceSourceError =
  | { kind: "timeout"; diagnostic: string }
  | { kind: "network"; diagnostic: string }
  | { kind: "unavailable"; diagnostic: string }
  | { kind: "malformed"; diagnostic: string };

export interface SupportResistanceSourcePort {
  collect(request: SupportResistanceSourceRequest): Promise<SupportResistanceSourceSnapshot>;
}
