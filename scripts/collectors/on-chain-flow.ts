import { createNodeRuntime } from "../../src/adapters/node/composition-root.js";
import { HttpBirdeyeFlowSource } from "../../src/adapters/node/http-birdeye-flow-source.js";
import { HttpHeliusFlowSource } from "../../src/adapters/node/http-helius-flow-source.js";
import {
  runOnChainFlowJob,
  type ConfiguredOnChainFlowSource
} from "../../src/jobs/on-chain-flow-job.js";
import { redactSecretMentions, secretRedactingReplacer } from "../../src/domain/redact-secrets.js";
import { parseOnChainFlowThresholds } from "../../src/domain/on-chain-flow/threshold.js";
import type { OnChainFlowThresholds } from "../../src/contracts/on-chain-flow.js";

import {
  DEFAULT_ON_CHAIN_FLOW_LOOKBACK_MS,
  DEFAULT_ON_CHAIN_FLOW_THRESHOLDS
} from "../../src/domain/on-chain-flow/defaults.js";

function parseThreshold(
  value: string | undefined,
  name: keyof typeof DEFAULT_ON_CHAIN_FLOW_THRESHOLDS
): string {
  if (value === undefined || value.length === 0) {
    return DEFAULT_ON_CHAIN_FLOW_THRESHOLDS[name] as string;
  }
  return value;
}

function parseConfidence(
  value: string | undefined,
  name: keyof typeof DEFAULT_ON_CHAIN_FLOW_THRESHOLDS
): number {
  if (value === undefined || value.length === 0) {
    return DEFAULT_ON_CHAIN_FLOW_THRESHOLDS[name] as number;
  }
  const parsed = parseFloat(value);
  if (isNaN(parsed)) {
    throw new Error(`Invalid ${name}: must be a number`);
  }
  return parsed;
}

function parseLookbackMs(value: string | undefined): number {
  if (value === undefined || value.length === 0) {
    return DEFAULT_ON_CHAIN_FLOW_LOOKBACK_MS;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid ON_CHAIN_FLOW_LOOKBACK_MS: must be a positive integer`);
  }
  return parsed;
}

export async function runOnChainFlowCollect(): Promise<void> {
  const runtime = createNodeRuntime();

  const birdeyeUrl = runtime.env.getOptional("BIRDEYE_FLOW_API_URL")?.trim();
  const birdeyeApiKey = runtime.env.getOptional("BIRDEYE_API_KEY")?.trim();
  const orcaPoolAddress = runtime.env.getOptional("WHIRLPOOL_ADDRESS")?.trim();
  const heliusUrl = runtime.env.getOptional("HELIUS_FLOW_API_URL")?.trim();
  const heliusApiKey = runtime.env.getOptional("HELIUS_API_KEY")?.trim();

  if (!orcaPoolAddress) {
    console.error(
      JSON.stringify({
        status: "failed",
        diagnostic: "WHIRLPOOL_ADDRESS is not configured"
      })
    );
    process.exitCode = 1;
    return;
  }

  if (heliusUrl && !heliusApiKey) {
    console.error(
      JSON.stringify({
        status: "failed",
        diagnostic: "HELIUS_API_KEY is not configured"
      })
    );
    process.exitCode = 1;
    return;
  }

  if (!heliusUrl && heliusApiKey) {
    console.error(
      JSON.stringify({
        status: "failed",
        diagnostic: "HELIUS_FLOW_API_URL is not configured"
      })
    );
    process.exitCode = 1;
    return;
  }

  if (birdeyeUrl && !birdeyeApiKey) {
    console.error(
      JSON.stringify({
        status: "failed",
        diagnostic: "BIRDEYE_API_KEY is not configured"
      })
    );
    process.exitCode = 1;
    return;
  }

  if (!birdeyeUrl && birdeyeApiKey) {
    console.error(
      JSON.stringify({
        status: "failed",
        diagnostic: "BIRDEYE_FLOW_API_URL is not configured"
      })
    );
    process.exitCode = 1;
    return;
  }

  if (!heliusUrl && !heliusApiKey && !birdeyeUrl && !birdeyeApiKey) {
    console.error(
      JSON.stringify({
        status: "failed",
        diagnostic: "No on-chain flow source is configured"
      })
    );
    process.exitCode = 1;
    return;
  }

  let thresholds: OnChainFlowThresholds;
  try {
    const whaleSwapMinUsdc = parseThreshold(
      runtime.env.getOptional("ON_CHAIN_WHALE_SWAP_MIN_USDC"),
      "whaleSwapMinUsdc"
    );
    const stablecoinFlowMinUsdc = parseThreshold(
      runtime.env.getOptional("ON_CHAIN_STABLECOIN_FLOW_MIN_USDC"),
      "stablecoinFlowMinUsdc"
    );
    const dexNetFlowMinUsdc = parseThreshold(
      runtime.env.getOptional("ON_CHAIN_DEX_NET_FLOW_MIN_USDC"),
      "dexNetFlowMinUsdc"
    );
    const cexFlowProxyMinUsdc = parseThreshold(
      runtime.env.getOptional("ON_CHAIN_CEX_PROXY_MIN_USDC"),
      "cexFlowProxyMinUsdc"
    );
    const cexMinAttributionConfidence = parseConfidence(
      runtime.env.getOptional("ON_CHAIN_CEX_MIN_ATTRIBUTION_CONFIDENCE"),
      "cexMinAttributionConfidence"
    );

    thresholds = {
      whaleSwapMinUsdc,
      stablecoinFlowMinUsdc,
      dexNetFlowMinUsdc,
      cexFlowProxyMinUsdc,
      cexMinAttributionConfidence
    };

    parseOnChainFlowThresholds(thresholds);
  } catch (err) {
    console.error(
      JSON.stringify({
        status: "failed",
        diagnostic: err instanceof Error ? err.message : "Invalid threshold configuration"
      })
    );
    process.exitCode = 1;
    return;
  }

  const lookbackMs = parseLookbackMs(runtime.env.getOptional("ON_CHAIN_FLOW_LOOKBACK_MS"));

  const sources: ConfiguredOnChainFlowSource[] = [];

  if (heliusUrl && heliusApiKey) {
    const heliusSource = new HttpHeliusFlowSource({
      http: runtime.http,
      url: heliusUrl,
      apiKey: heliusApiKey,
      retryControl: runtime.retryControl
    });
    sources.push({ source: "helius-api", adapter: heliusSource });
  }

  if (birdeyeUrl && birdeyeApiKey) {
    const birdeyeSource = new HttpBirdeyeFlowSource({
      http: runtime.http,
      url: birdeyeUrl,
      apiKey: birdeyeApiKey,
      poolAddress: orcaPoolAddress,
      whaleSwapMinUsdc: thresholds.whaleSwapMinUsdc,
      retryControl: runtime.retryControl
    });
    sources.push({ source: "birdeye-api", adapter: birdeyeSource });
  }

  if (sources.length === 0) {
    console.error(
      JSON.stringify({
        status: "failed",
        diagnostic: "No on-chain flow source is configured"
      })
    );
    process.exitCode = 1;
    return;
  }

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

  let result;
  try {
    result = await runOnChainFlowJob({
      sources,
      rawObservationRepo: persistence.rawObservationRepo,
      normalizedObservationRepo: persistence.normalizedObservationRepo,
      env: runtime.env,
      clock: runtime.clock,
      runIdFactory: runtime.runIdFactory,
      thresholds,
      lookbackMs,
      walletAddress: orcaPoolAddress,
      addressType: "contract" as const
    });

    console.log(JSON.stringify(result, secretRedactingReplacer, 2));

    if (result.shouldFailCommand) {
      process.exitCode = 1;
    } else {
      process.exitCode = 0;
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        status: "failed",
        diagnostic: err instanceof Error ? err.message : "Unknown error"
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
  process.argv[1]?.endsWith("on-chain-flow.ts") ||
  process.argv[1]?.endsWith("on-chain-flow.js") ||
  process.argv[1]?.endsWith("on-chain-flow")
) {
  runOnChainFlowCollect().catch((error) => {
    console.error(JSON.stringify({ status: "failed", diagnostic: error.message }));
    process.exitCode = 1;
  });
}
