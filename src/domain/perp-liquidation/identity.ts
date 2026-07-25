import { canonicalHash } from "../content-hash.js";
import type { PerpObservationPayloadV1 } from "../../contracts/perp-liquidation.js";

export interface PerpObservationIdentityInput {
  readonly venue: string;
  readonly kind: string;
  readonly instrument: string;
  readonly observedAtUnixMs: number;
  readonly sourceEventId: string;
}

export async function derivePerpObservationKey(
  payload: PerpObservationPayloadV1 | PerpObservationIdentityInput,
  _providerRunId?: string | null
): Promise<string> {
  // Never include provider run ID in observation identity
  void _providerRunId;

  const identityTuple = {
    source: payload.venue,
    kind: payload.kind,
    instrument: payload.instrument,
    observedAtUnixMs: payload.observedAtUnixMs,
    sourceEventId: payload.sourceEventId
  };

  return canonicalHash(identityTuple);
}
