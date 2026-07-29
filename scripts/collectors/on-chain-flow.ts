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

const DEFAULT_THRESHOLDS = {
  whaleTransferMinUsdc: "1000000",
  whaleSwapMinUsdc: "1000000",
  stablecoinFlowMinUsdc: "1000000",
  dexNetFlowMinUsdc: "5000000",
  cexFlowProxyMinUsdc: "1000000",
  cexMinAttributionConfidence: 0.8
};

const DEFAULT_LOOKBACK_MS = 900000;

function parseThreshold(value: string | undefined, name: keyof typeof DEFAULT_THRESHOLDS): string {
  if (value === undefined || value.length === 0) {
    return DEFAULT_THRESHOLDS[name] as string;
  }
  return value;
}

function parseConfidence(value: string | undefined, name: keyof typeof DEFAULT_THRESHOLDS): number {
  if (value === undefined || value.length === 0) {
    return DEFAULT_THRESHOLDS[name] as number;
  }
  const parsed = parseFloat(value);
  if (isNaN(parsed)) {
    throw new Error(`Invalid ${name}: must be a number`);
  }
  return parsed;
}

function parseLookbackMs(value: string | undefined): number {
  if (value === undefined || value.length === 0) {
    return DEFAULT_LOOKBACK_MS;
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
  const orcaPoolAddress = runtime.env.getOptional("ORCA_SOL_USDC_WHIRLPOOL")?.trim();
  const heliusUrl = runtime.env.getOptional("HELIUS_FLOW_API_URL")?.trim();
  const heliusApiKey = runtime.env.getOptional("HELIUS_API_KEY")?.trim();

  if (!birdeyeUrl) {
    console.error(
      JSON.stringify({
        status: "failed",
        diagnostic: "BIRDEYE_FLOW_API_URL is not configured"
      })
    );
    process.exitCode = 1;
    return;
  }

  if (!birdeyeApiKey) {
    console.error(
      JSON.stringify({
        status: "failed",
        diagnostic: "BIRDEYE_API_KEY is not configured"
      })
    );
    process.exitCode = 1;
    return;
  }

  if (!orcaPoolAddress) {
    console.error(
      JSON.stringify({
        status: "failed",
        diagnostic: "ORCA_SOL_USDC_WHIRLPOOL is not configured"
      })
    );
    process.exitCode = 1;
    return;
  }

  if (!heliusUrl) {
    console.error(
      JSON.stringify({
        status: "failed",
        diagnostic: "HELIUS_FLOW_API_URL is not configured"
      })
    );
    process.exitCode = 1;
    return;
  }

  if (!heliusApiKey) {
    console.error(
      JSON.stringify({
        status: "failed",
        diagnostic: "HELIUS_API_KEY is not configured"
      })
    );
    process.exitCode = 1;
    return;
  }

  const walletPublicKey = runtime.env.getOptional("WALLET_PUBLIC_KEY")?.trim();
  if (!walletPublicKey || walletPublicKey.length === 0) {
    console.error(
      JSON.stringify({
        status: "failed",
        diagnostic: "WALLET_PUBLIC_KEY is not configured"
      })
    );
    process.exitCode = 1;
    return;
  }

  let thresholds: OnChainFlowThresholds;
  try {
    const whaleTransferMinUsdc = parseThreshold(
      runtime.env.getOptional("ON_CHAIN_WHALE_TRANSFER_MIN_USDC"),
      "whaleTransferMinUsdc"
    );
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
      whaleTransferMinUsdc,
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

  const heliusSource = new HttpHeliusFlowSource({
    http: runtime.http,
    url: `${heliusUrl}/v0/addresses/{address}/transactions`,
    apiKey: heliusApiKey,
    retryControl: runtime.retryControl
  });

  const birdeyeSource = new HttpBirdeyeFlowSource({
    http: runtime.http,
    url: birdeyeUrl,
    apiKey: birdeyeApiKey,
    poolAddress: orcaPoolAddress,
    whaleSwapMinUsdc: thresholds.whaleSwapMinUsdc,
    retryControl: runtime.retryControl
  });

  const sources: ConfiguredOnChainFlowSource[] = [
    { source: "helius-api", adapter: heliusSource },
    { source: "birdeye-api", adapter: birdeyeSource }
  ];

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
      walletAddress: walletPublicKey
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
