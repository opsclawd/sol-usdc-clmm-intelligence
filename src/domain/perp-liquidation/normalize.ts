import type { PerpObservationPayloadV1 } from "../../contracts/perp-liquidation.js";
import { validatePerpObservation } from "./validate.js";

export function normalizePerpObservation(raw: unknown): PerpObservationPayloadV1 {
  if (typeof raw !== "object" || raw === null) {
    return validatePerpObservation(raw);
  }

  const obj = raw as Record<string, unknown>;

  const base = {
    schemaVersion: 1,
    evidenceFamily: "perp_liquidation",
    pair: "SOL/USDC",
    venue: obj.venue,
    instrument: obj.instrument,
    sourceEventId: obj.sourceEventId,
    observedAtUnixMs: obj.observedAtUnixMs,
    kind: obj.kind
  };

  let candidate: unknown;

  switch (obj.kind) {
    case "funding_rate":
      candidate = {
        ...base,
        fundingRate: obj.fundingRate,
        fundingIntervalHours: obj.fundingIntervalHours
      };
      break;

    case "open_interest":
      candidate = {
        ...base,
        openInterestBase: obj.openInterestBase,
        openInterestUsdc: obj.openInterestUsdc,
        sampleWindowSeconds: obj.sampleWindowSeconds
      };
      break;

    case "perp_basis":
      candidate = {
        ...base,
        perpPriceUsdc: obj.perpPriceUsdc,
        spotPriceUsdc: obj.spotPriceUsdc
      };
      break;

    case "liquidation_event":
      candidate = {
        ...base,
        side: obj.side,
        amountBase: obj.amountBase,
        notionalUsdc: obj.notionalUsdc
      };
      break;

    case "leverage_proxy":
      candidate = {
        ...base,
        longShortRatio: obj.longShortRatio,
        methodology: obj.methodology
      };
      break;

    default:
      candidate = raw;
  }

  return validatePerpObservation(candidate);
}
