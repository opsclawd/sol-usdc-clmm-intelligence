import type { OnChainFlowThresholds } from "../../contracts/on-chain-flow.js";
import type { AcceptedOnChainFlowSourceEvent } from "./validate.js";

export class OnChainFlowThresholdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnChainFlowThresholdError";
  }
}

export interface ParsedDecimal {
  sign: -1 | 1;
  digits: string;
  scale: number;
}

function isValidThresholdDecimalString(value: string): boolean {
  if (value === "") return false;
  if (value.startsWith("+")) return false;
  if (!/^-?[0-9]+(\.[0-9]+)?$/.test(value)) return false;
  if (/\de/i.test(value)) return false;
  return true;
}

export function parseDecimalString(value: string): ParsedDecimal {
  if (!isValidThresholdDecimalString(value)) {
    throw new OnChainFlowThresholdError(`Invalid decimal string: ${value}`);
  }

  const isNegative = value.startsWith("-");
  const absValue = isNegative ? value.slice(1) : value;

  const dotIndex = absValue.indexOf(".");
  let digits: string;
  let scale: number;

  if (dotIndex === -1) {
    digits = absValue;
    scale = 0;
  } else {
    const intPart = absValue.slice(0, dotIndex);
    const fracPart = absValue.slice(dotIndex + 1);
    digits = intPart + fracPart;
    scale = fracPart.length;
  }

  return {
    sign: isNegative ? -1 : 1,
    digits,
    scale
  };
}

function alignScales(a: ParsedDecimal, b: ParsedDecimal): [string, string] {
  const maxScale = Math.max(a.scale, b.scale);
  const scaleDiffA = maxScale - a.scale;
  const scaleDiffB = maxScale - b.scale;

  const digitsA = a.digits + "0".repeat(scaleDiffA);
  const digitsB = b.digits + "0".repeat(scaleDiffB);

  return [digitsA, digitsB];
}

function compareDecimals(a: ParsedDecimal, b: ParsedDecimal): -1 | 0 | 1 {
  const [digitsA, digitsB] = alignScales(a, b);

  const aInt = BigInt(a.sign < 0 ? "-" + digitsA : digitsA);
  const bInt = BigInt(b.sign < 0 ? "-" + digitsB : digitsB);

  if (aInt < bInt) return -1;
  if (aInt > bInt) return 1;
  return 0;
}

function decimalGreaterThanOrEqual(a: ParsedDecimal, b: ParsedDecimal): boolean {
  return compareDecimals(a, b) >= 0;
}

export interface ParsedOnChainFlowThresholds {
  whaleTransferMinUsdc: ParsedDecimal;
  whaleSwapMinUsdc: ParsedDecimal;
  stablecoinFlowMinUsdc: ParsedDecimal;
  dexNetFlowMinUsdc: ParsedDecimal;
  cexFlowProxyMinUsdc: ParsedDecimal;
  cexMinAttributionConfidence: number;
}

export function parseOnChainFlowThresholds(
  input: OnChainFlowThresholds
): ParsedOnChainFlowThresholds {
  if (!isValidThresholdDecimalString(input.whaleTransferMinUsdc)) {
    throw new OnChainFlowThresholdError(
      "whaleTransferMinUsdc must be a valid decimal string without scientific notation"
    );
  }
  if (!isValidThresholdDecimalString(input.whaleSwapMinUsdc)) {
    throw new OnChainFlowThresholdError(
      "whaleSwapMinUsdc must be a valid decimal string without scientific notation"
    );
  }
  if (!isValidThresholdDecimalString(input.stablecoinFlowMinUsdc)) {
    throw new OnChainFlowThresholdError(
      "stablecoinFlowMinUsdc must be a valid decimal string without scientific notation"
    );
  }
  if (!isValidThresholdDecimalString(input.dexNetFlowMinUsdc)) {
    throw new OnChainFlowThresholdError(
      "dexNetFlowMinUsdc must be a valid decimal string without scientific notation"
    );
  }
  if (!isValidThresholdDecimalString(input.cexFlowProxyMinUsdc)) {
    throw new OnChainFlowThresholdError(
      "cexFlowProxyMinUsdc must be a valid decimal string without scientific notation"
    );
  }

  if (
    typeof input.cexMinAttributionConfidence !== "number" ||
    input.cexMinAttributionConfidence < 0 ||
    input.cexMinAttributionConfidence > 1 ||
    !Number.isFinite(input.cexMinAttributionConfidence)
  ) {
    throw new OnChainFlowThresholdError("cexMinAttributionConfidence must be a number in [0, 1]");
  }

  return {
    whaleTransferMinUsdc: parseDecimalString(input.whaleTransferMinUsdc),
    whaleSwapMinUsdc: parseDecimalString(input.whaleSwapMinUsdc),
    stablecoinFlowMinUsdc: parseDecimalString(input.stablecoinFlowMinUsdc),
    dexNetFlowMinUsdc: parseDecimalString(input.dexNetFlowMinUsdc),
    cexFlowProxyMinUsdc: parseDecimalString(input.cexFlowProxyMinUsdc),
    cexMinAttributionConfidence: input.cexMinAttributionConfidence
  };
}

function getAmountDecimal(event: AcceptedOnChainFlowSourceEvent): ParsedDecimal {
  let amountStr: string;

  switch (event.eventKind) {
    case "helius_transaction":
      if (typeof event.nativeAmount === "string") {
        amountStr = event.nativeAmount;
      } else {
        amountStr = String(event.nativeAmount);
      }
      break;
    case "whale_transfer":
    case "whale_swap":
    case "stablecoin_flow":
    case "dex_net_flow":
    case "cex_flow_proxy":
      amountStr = event.amountUsdc;
      break;
    default:
      throw new OnChainFlowThresholdError("Unknown event kind");
  }

  return parseDecimalString(amountStr);
}

function getThresholdForEventKind(
  event: AcceptedOnChainFlowSourceEvent,
  thresholds: ParsedOnChainFlowThresholds
): ParsedDecimal {
  switch (event.eventKind) {
    case "helius_transaction":
    case "whale_transfer":
      return thresholds.whaleTransferMinUsdc;
    case "whale_swap":
      return thresholds.whaleSwapMinUsdc;
    case "stablecoin_flow":
      return thresholds.stablecoinFlowMinUsdc;
    case "dex_net_flow":
      return thresholds.dexNetFlowMinUsdc;
    case "cex_flow_proxy":
      return thresholds.cexFlowProxyMinUsdc;
    default:
      throw new OnChainFlowThresholdError("Unknown event kind for threshold");
  }
}

export function qualifiesOnChainFlow(
  event: AcceptedOnChainFlowSourceEvent,
  thresholds: ParsedOnChainFlowThresholds
): boolean {
  let amountDecimal = getAmountDecimal(event);
  const threshold = getThresholdForEventKind(event, thresholds);

  if (event.eventKind === "dex_net_flow") {
    amountDecimal = { ...amountDecimal, sign: 1 };
  }

  const amountPasses = decimalGreaterThanOrEqual(amountDecimal, threshold);
  if (!amountPasses) return false;

  if (event.eventKind === "cex_flow_proxy") {
    const confidencePasses = event.attributionConfidence >= thresholds.cexMinAttributionConfidence;
    if (!confidencePasses) return false;
  }

  return true;
}
