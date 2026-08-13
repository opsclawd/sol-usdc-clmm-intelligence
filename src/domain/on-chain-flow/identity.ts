import { canonicalHash } from "../content-hash.js";
import type {
  OnChainFlowPayloadV1,
  WhaleSwapPayloadV1,
  StablecoinFlowPayloadV1,
  DexNetFlowPayloadV1
} from "../../contracts/on-chain-flow.js";
import type { Source } from "../../contracts/taxonomy.js";

export interface OnChainFlowSourceObservationIdentity {
  readonly source: Source;
  readonly eventKind: string;
  readonly transactionSignature?: string;
  readonly eventIndex?: number;
  readonly venue?: string;
  readonly windowStartUnixMs?: number;
  readonly windowEndUnixMs?: number;
}

function isDexFlow(payload: OnChainFlowPayloadV1): payload is DexNetFlowPayloadV1 {
  return payload.eventType === "dex_net_flow";
}

function isTransactionFlow(
  payload: OnChainFlowPayloadV1
): payload is WhaleSwapPayloadV1 | StablecoinFlowPayloadV1 {
  return payload.eventType === "whale_swap" || payload.eventType === "stablecoin_flow";
}

export async function deriveOnChainFlowSourceObservationKey(
  payload: OnChainFlowPayloadV1,
  source: Source,
  _providerRunId: string | null
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void _providerRunId;
  if (isTransactionFlow(payload)) {
    const identityTuple = {
      source,
      eventKind: payload.eventType,
      transactionSignature: payload.transactionSignature,
      eventIndex: payload.eventIndex
    };
    return canonicalHash(identityTuple);
  }

  if (isDexFlow(payload)) {
    const identityTuple = {
      source,
      eventKind: payload.eventType,
      venue: payload.venue,
      windowStartUnixMs: payload.windowStartUnixMs,
      windowEndUnixMs: payload.windowEndUnixMs
    };
    return canonicalHash(identityTuple);
  }

  if (payload.eventType === "cex_flow_proxy") {
    const identityTuple = {
      source,
      eventKind: payload.eventType,
      sourceEventId: payload.sourceEventId
    };
    return canonicalHash(identityTuple);
  }

  const exhaustiveCheck: never = payload;
  throw new Error(`Unknown on-chain flow event type: ${JSON.stringify(exhaustiveCheck)}`);
}
