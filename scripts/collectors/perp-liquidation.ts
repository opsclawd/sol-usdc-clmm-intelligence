import { createNodeRuntime } from "../../src/adapters/node/composition-root.js";
import { runPerpLiquidationJob } from "../../src/jobs/perp-liquidation-job.js";
import { redactSecretMentions, secretRedactingReplacer } from "../../src/domain/redact-secrets.js";

const DEFAULT_BINANCE_BASE_URL = "https://fapi.binance.com";
const DEFAULT_LOOKBACK_MS = 14_400_000; // 4 hours minimum

function parseLookbackMs(value: string | undefined): number {
  if (value === undefined || value.length === 0) {
    return DEFAULT_LOOKBACK_MS;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < DEFAULT_LOOKBACK_MS) {
    throw new Error(
      `Invalid PERP_LIQUIDATION_LOOKBACK_MS: must be a positive integer >= ${DEFAULT_LOOKBACK_MS}`
    );
  }
  return parsed;
}

export async function runPerpLiquidationCollect(): Promise<void> {
  const runtime = createNodeRuntime();
  let persistence;
  try {
    persistence = await runtime.getPersistence();
  } catch (err) {
    console.error(
      JSON.stringify({
        status: "failed",
        diagnostic: "Failed to initialize persistence"
      })
    );
    process.exitCode = 1;
    return;
  }

  try {
    const binanceBaseUrl =
      runtime.env.getOptional("BINANCE_FAPI_BASE_URL")?.trim() || DEFAULT_BINANCE_BASE_URL;
    const binanceSymbol = runtime.env.getOptional("BINANCE_SOL_PERP_SYMBOL")?.trim();
    const driftBaseUrl = runtime.env.getOptional("DRIFT_DATA_API_BASE_URL")?.trim();
    const driftSymbol = runtime.env.getOptional("DRIFT_SOL_PERP_SYMBOL")?.trim();
    const driftMarketIndexStr = runtime.env.getOptional("DRIFT_SOL_PERP_MARKET_INDEX")?.trim();

    if (!binanceSymbol) {
      console.error(
        JSON.stringify({
          status: "failed",
          diagnostic: "BINANCE_SOL_PERP_SYMBOL is not configured"
        })
      );
      process.exitCode = 1;
      return;
    }

    if (!driftBaseUrl) {
      console.error(
        JSON.stringify({
          status: "failed",
          diagnostic: "DRIFT_DATA_API_BASE_URL is not configured"
        })
      );
      process.exitCode = 1;
      return;
    }

    if (!driftSymbol) {
      console.error(
        JSON.stringify({
          status: "failed",
          diagnostic: "DRIFT_SOL_PERP_SYMBOL is not configured"
        })
      );
      process.exitCode = 1;
      return;
    }

    if (driftMarketIndexStr === undefined || driftMarketIndexStr === "") {
      console.error(
        JSON.stringify({
          status: "failed",
          diagnostic: "DRIFT_SOL_PERP_MARKET_INDEX is not configured"
        })
      );
      process.exitCode = 1;
      return;
    }

    const driftMarketIndex = parseInt(driftMarketIndexStr, 10);
    if (isNaN(driftMarketIndex)) {
      console.error(
        JSON.stringify({
          status: "failed",
          diagnostic: "DRIFT_SOL_PERP_MARKET_INDEX must be a valid integer"
        })
      );
      process.exitCode = 1;
      return;
    }

    const pricePrecisionStr = runtime.env.getOptional("DRIFT_PRICE_PRECISION")?.trim() || "1000000";
    const basePrecisionStr =
      runtime.env.getOptional("DRIFT_BASE_PRECISION")?.trim() || "1000000000";
    const quotePrecisionStr = runtime.env.getOptional("DRIFT_QUOTE_PRECISION")?.trim() || "1000000";

    const pricePrecisionExp = Math.round(Math.log10(parseFloat(pricePrecisionStr))) || 6;
    const basePrecisionExp = Math.round(Math.log10(parseFloat(basePrecisionStr))) || 9;
    const quotePrecisionExp = Math.round(Math.log10(parseFloat(quotePrecisionStr))) || 6;

    const lookbackMs = parseLookbackMs(runtime.env.getOptional("PERP_LIQUIDATION_LOOKBACK_MS"));

    if (!runtime.getPerpLiquidationSources) {
      throw new Error("runtime.getPerpLiquidationSources is not implemented");
    }

    const sources = await runtime.getPerpLiquidationSources({
      binanceBaseUrl,
      binanceSymbol,
      driftBaseUrl,
      driftSymbol,
      driftMarketIndex,
      driftPrecisions: {
        pricePrecisionExp,
        basePrecisionExp,
        quotePrecisionExp
      }
    });

    const result = await runPerpLiquidationJob({
      sources,
      rawObservationRepo: persistence.rawObservationRepo,
      normalizedObservationRepo: persistence.normalizedObservationRepo,
      derivedFeatureRepo: persistence.featureRepo,
      env: runtime.env,
      clock: runtime.clock,
      runIdFactory: runtime.runIdFactory,
      binanceSymbol,
      driftMarketIndex,
      driftPrecision: {
        pricePrecision: pricePrecisionStr,
        basePrecision: basePrecisionStr,
        quotePrecision: quotePrecisionStr
      },
      lookbackMs
    });

    const outputJson = JSON.stringify(result, secretRedactingReplacer, 2);
    console.log(outputJson);

    if (result.shouldFailCommand) {
      process.exitCode = 1;
    } else {
      process.exitCode = 0;
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const redactedMsg = redactSecretMentions(errorMsg);
    console.error(
      JSON.stringify({
        status: "failed",
        diagnostic: redactedMsg
      })
    );
    process.exitCode = 1;
  } finally {
    try {
      await persistence.connection.close();
    } catch (closeErr) {
      const closeErrMsg = closeErr instanceof Error ? closeErr.message : String(closeErr);
      console.error("Failed to close database connection:", redactSecretMentions(closeErrMsg));
      process.exitCode = 1;
    }
  }
}

if (
  process.argv[1]?.endsWith("perp-liquidation.ts") ||
  process.argv[1]?.endsWith("perp-liquidation.js")
) {
  runPerpLiquidationCollect().catch((err) => {
    console.error("Unhandled error in perp liquidation collector:", err);
    process.exitCode = 1;
  });
}
