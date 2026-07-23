export interface ScheduledEventSourceRequest {
  readonly pair: "SOL/USDC";
  readonly fromUnixMs: number;
  readonly toUnixMs: number;
}

export interface ScheduledEventSourceClaim {
  readonly eventId: string;
  readonly eventType: string;
  readonly scheduledUnixMs: number;
  readonly sourceReferences: readonly string[];
}

export interface ScheduledEventSourceSnapshot {
  readonly providerId: string;
  readonly providerRunId: string;
  readonly sourceId: string;
  readonly pair: "SOL/USDC";
  readonly asOfUnixMs: number;
  readonly license: string;
  readonly retention: "bounded";
  readonly confirmationLevel: "explicit";
  readonly events: readonly ScheduledEventSourceClaim[];
}

export type ScheduledEventSourceError =
  | { kind: "timeout"; diagnostic: string }
  | { kind: "network"; diagnostic: string }
  | { kind: "unavailable"; diagnostic: string }
  | { kind: "malformed"; diagnostic: string };

export interface ScheduledEventSourcePort {
  collect(request: ScheduledEventSourceRequest): Promise<ScheduledEventSourceSnapshot>;
}
