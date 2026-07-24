export interface ProtocolIncidentSourceRequest {
  readonly network: "solana-mainnet";
}

export interface ProtocolIncidentSourceClaim {
  readonly incidentId: string;
  readonly incidentType: string;
  readonly severity: string;
  readonly sourceReferences: readonly string[];
}

export interface ProtocolIncidentSourceSnapshot {
  readonly providerId: string;
  readonly providerRunId: string;
  readonly sourceId: string;
  readonly network: "solana-mainnet";
  readonly asOfUnixMs: number;
  readonly license: string;
  readonly retention: "bounded";
  readonly confirmationLevel: "explicit";
  readonly incidents: readonly ProtocolIncidentSourceClaim[];
}

export type ProtocolIncidentSourceError =
  | { kind: "timeout"; diagnostic: string }
  | { kind: "network"; diagnostic: string }
  | { kind: "unavailable"; diagnostic: string }
  | { kind: "malformed"; diagnostic: string };

export interface ProtocolIncidentSourcePort {
  collect(request: ProtocolIncidentSourceRequest): Promise<ProtocolIncidentSourceSnapshot>;
}
