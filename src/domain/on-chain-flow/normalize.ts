import type {
  OnChainFlowPayloadV1,
  WhaleSwapPayloadV1,
  StablecoinFlowPayloadV1,
  DexNetFlowPayloadV1,
  CexFlowProxyPayloadV1
} from "../../contracts/on-chain-flow.js";
import type { AcceptedOnChainFlowSourceEvent } from "./validate.js";
import { parseDecimalString } from "./threshold.js";

export class OnChainFlowNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnChainFlowNormalizationError";
  }
}

function sortAndDeduplicateStrings(arr: readonly string[]): readonly string[] {
  const trimmed = arr.map((s) => s.trim()).filter((s) => s.length > 0);
  return [...new Set(trimmed)].sort();
}

function normalizeDexNetFlow(event: AcceptedOnChainFlowSourceEvent): {
  buyVolumeUsdc: string;
  sellVolumeUsdc: string;
  netFlowUsdc: string;
} {
  if (event.eventKind !== "dex_net_flow") {
    throw new OnChainFlowNormalizationError("Event is not a DEX net flow event");
  }

  const buyVolumeStr = event.buyVolumeUsdc;
  const sellVolumeStr = event.sellVolumeUsdc;
  const netFlowStr = event.netFlowUsdc;

  const buyDecimal = parseDecimalString(buyVolumeStr);
  const sellDecimal = parseDecimalString(sellVolumeStr);
  const netDecimal = parseDecimalString(netFlowStr);

  const maxScale = Math.max(buyDecimal.scale, sellDecimal.scale, netDecimal.scale);
  const scaleDiffBuy = maxScale - buyDecimal.scale;
  const scaleDiffSell = maxScale - sellDecimal.scale;
  const scaleDiffNet = maxScale - netDecimal.scale;

  const buyDigitsAligned = buyDecimal.digits + "0".repeat(scaleDiffBuy);
  const sellDigitsAligned = sellDecimal.digits + "0".repeat(scaleDiffSell);
  const netDigitsAligned = netDecimal.digits + "0".repeat(scaleDiffNet);

  const buyInt = BigInt(buyDecimal.sign < 0 ? "-" + buyDigitsAligned : buyDigitsAligned);
  const sellInt = BigInt(sellDecimal.sign < 0 ? "-" + sellDigitsAligned : sellDigitsAligned);
  const netInt = BigInt(netDecimal.sign < 0 ? "-" + netDigitsAligned : netDigitsAligned);

  const computedNet = buyInt - sellInt;

  if (computedNet !== netInt) {
    throw new OnChainFlowNormalizationError(
      `DEX net flow arithmetic mismatch: buyVolumeUsdc - sellVolumeUsdc (${computedNet}) !== netFlowUsdc (${netInt})`
    );
  }

  return {
    buyVolumeUsdc: buyVolumeStr,
    sellVolumeUsdc: sellVolumeStr,
    netFlowUsdc: netFlowStr
  };
}

export function normalizeOnChainFlow(
  event: AcceptedOnChainFlowSourceEvent,
  retrievedAtUnixMs: number
): OnChainFlowPayloadV1 {
  void retrievedAtUnixMs;
  const sourceReferences = sortAndDeduplicateStrings(event.sourceReferences);

  switch (event.eventKind) {
    case "whale_swap": {
      const wsEvent = event as AcceptedOnChainFlowSourceEvent & { eventKind: "whale_swap" };
      const result: WhaleSwapPayloadV1 = {
        schemaVersion: 1,
        eventFamily: "on_chain_flow",
        eventType: "whale_swap",
        sourceEventId: wsEvent.sourceEventId,
        observedAtUnixMs: wsEvent.observedAtUnixMs,
        amountUsdc: wsEvent.amountUsdc,
        direction: wsEvent.direction,
        venue: wsEvent.venue,
        addressContext: wsEvent.addressContext,
        sourceReferences,
        sourceQuality: wsEvent.sourceQuality,
        freshnessContext: {
          blockTimestampUnixMs: wsEvent.freshnessContext.blockTimestampUnixMs,
          ...(wsEvent.freshnessContext.slot !== undefined && {
            slot: wsEvent.freshnessContext.slot
          })
        },
        transactionSignature: wsEvent.transactionSignature,
        eventIndex: wsEvent.eventIndex,
        ...(wsEvent.slot !== undefined && { slot: wsEvent.slot }),
        stablecoinOperation: wsEvent.stablecoinOperation
      };
      return result;
    }

    case "stablecoin_flow": {
      const sfEvent = event as AcceptedOnChainFlowSourceEvent & { eventKind: "stablecoin_flow" };
      const result: StablecoinFlowPayloadV1 = {
        schemaVersion: 1,
        eventFamily: "on_chain_flow",
        eventType: "stablecoin_flow",
        sourceEventId: sfEvent.sourceEventId,
        observedAtUnixMs: sfEvent.observedAtUnixMs,
        amountUsdc: sfEvent.amountUsdc,
        direction: sfEvent.direction,
        venue: sfEvent.venue,
        addressContext: sfEvent.addressContext,
        sourceReferences,
        sourceQuality: sfEvent.sourceQuality,
        freshnessContext: {
          blockTimestampUnixMs: sfEvent.freshnessContext.blockTimestampUnixMs,
          ...(sfEvent.freshnessContext.slot !== undefined && {
            slot: sfEvent.freshnessContext.slot
          })
        },
        transactionSignature: sfEvent.transactionSignature,
        eventIndex: sfEvent.eventIndex,
        slot: sfEvent.slot,
        stablecoinOperation: sfEvent.stablecoinOperation
      };
      return result;
    }

    case "dex_net_flow": {
      const dnEvent = event as AcceptedOnChainFlowSourceEvent & { eventKind: "dex_net_flow" };
      const dexFlow = normalizeDexNetFlow(dnEvent);
      const result: DexNetFlowPayloadV1 = {
        schemaVersion: 1,
        eventFamily: "on_chain_flow",
        eventType: "dex_net_flow",
        sourceEventId: dnEvent.sourceEventId,
        observedAtUnixMs: dnEvent.observedAtUnixMs,
        amountUsdc: dexFlow.netFlowUsdc.replace(/^-/, ""),
        direction: dexFlow.netFlowUsdc.startsWith("-") ? "outbound" : "inbound",
        venue: dnEvent.venue,
        addressContext: dnEvent.addressContext,
        sourceReferences,
        sourceQuality: dnEvent.sourceQuality,
        freshnessContext: {
          blockTimestampUnixMs: dnEvent.freshnessContext.blockTimestampUnixMs,
          ...(dnEvent.freshnessContext.slot !== undefined && {
            slot: dnEvent.freshnessContext.slot
          })
        },
        windowStartUnixMs: dnEvent.windowStartUnixMs,
        windowEndUnixMs: dnEvent.windowEndUnixMs,
        buyVolumeUsdc: dexFlow.buyVolumeUsdc,
        sellVolumeUsdc: dexFlow.sellVolumeUsdc,
        netFlowUsdc: dexFlow.netFlowUsdc
      };
      return result;
    }

    case "cex_flow_proxy": {
      const cexEvent = event as AcceptedOnChainFlowSourceEvent & { eventKind: "cex_flow_proxy" };
      const result: CexFlowProxyPayloadV1 = {
        schemaVersion: 1,
        eventFamily: "on_chain_flow",
        eventType: "cex_flow_proxy",
        sourceEventId: cexEvent.sourceEventId,
        observedAtUnixMs: cexEvent.observedAtUnixMs,
        amountUsdc: cexEvent.amountUsdc,
        direction: cexEvent.direction,
        venue: cexEvent.venue,
        addressContext: cexEvent.addressContext,
        sourceReferences,
        sourceQuality: cexEvent.sourceQuality,
        freshnessContext: {
          blockTimestampUnixMs: cexEvent.freshnessContext.blockTimestampUnixMs,
          ...(cexEvent.freshnessContext.slot !== undefined && {
            slot: cexEvent.freshnessContext.slot
          })
        },
        quality: "proxy",
        attributionConfidence: cexEvent.attributionConfidence,
        attributionProvider: cexEvent.attributionProvider,
        caveats: sortAndDeduplicateStrings(cexEvent.caveats)
      };
      return result;
    }

    default:
      throw new OnChainFlowNormalizationError(
        `Unknown event kind: ${(event as { eventKind: string }).eventKind}`
      );
  }
}
