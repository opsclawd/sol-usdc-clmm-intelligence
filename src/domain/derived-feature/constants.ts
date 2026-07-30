import type { FeatureKind } from "../../contracts/taxonomy.js";
import { RANGE_CALCULATOR_VERSIONS } from "./range.js";
import { MARKET_CALCULATOR_VERSIONS } from "./market.js";
import { REALIZED_VOLATILITY_1H_VERSION } from "./volatility.js";
import { PERP_CALCULATOR_VERSIONS } from "../perp-liquidation/derive.js";

export const MVP_ACCEPTED_CALCULATOR_VERSIONS: Readonly<Record<FeatureKind, string>> =
  Object.freeze({
    ...RANGE_CALCULATOR_VERSIONS,
    ...MARKET_CALCULATOR_VERSIONS,
    realized_volatility_1h: REALIZED_VOLATILITY_1H_VERSION,
    ...PERP_CALCULATOR_VERSIONS
  });
