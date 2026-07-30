import http from "node:http";
import { execSync } from "node:child_process";
import { createNodeRuntime } from "../src/adapters/node/composition-root.js";
import { runCoreEvidencePipelineScript } from "./collectors/core-evidence-pipeline.js";

async function main() {
  const dbUrl = process.env.DATABASE_URL || "postgres://postgres@localhost:5432/intelligence_test";
  process.env.DATABASE_URL = dbUrl;
  process.env.PG_SSL = "false";

  console.log(`[Verify Task 4] Ensuring schema migrated at ${dbUrl}...`);
  execSync("pnpm db:migrate", {
    env: { ...process.env, DATABASE_URL: dbUrl, PG_SSL: "false" },
    stdio: "inherit"
  });

  // Start mock endpoints for external APIs required by core pipeline run
  const clmmServer = http.createServer((req, res) => {
    const now = Date.now();
    const body = JSON.stringify({
      bundle: {
        pair: "SOL/USDC",
        source: "orca",
        observedAtUnixMs: now,
        pool: {
          poolId: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
          pair: "SOL/USDC",
          source: "orca",
          observedAtUnixMs: now,
          tokenPairLabel: "SOL/USDC",
          currentPrice: 150.5,
          currentPriceLabel: "150.50",
          sqrtPrice: "1000000",
          tickCurrentIndex: 0,
          tickSpacing: 64,
          feeRate: 0.0005,
          feeRateLabel: "0.05%",
          poolLiquidity: "1000000",
          priceSource: "orca_whirlpool_sqrt_price"
        },
        srLevels: null,
        positions: [
          {
            walletId: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            positionId: "pos-sol-usdc-01",
            poolId: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
            pair: "SOL/USDC",
            source: "orca",
            observedAtUnixMs: now,
            rangeState: "in-range",
            lowerTick: -100,
            upperTick: 100,
            currentTick: 0,
            lowerPriceLabel: "140.00",
            upperPriceLabel: "160.00",
            currentPrice: 150.5,
            currentPriceLabel: "150.50",
            rangeDistance: {
              belowLowerTickPercent: 0,
              aboveUpperTickPercent: 0,
              belowLowerPricePercent: 0,
              aboveUpperPricePercent: 0
            },
            feeRateLabel: "0.05%",
            unclaimedFees: {
              feeOwedA: {
                raw: "100",
                decimals: 9,
                symbol: "SOL",
                mint: "So11111111111111111111111111111111111111112"
              },
              feeOwedB: {
                raw: "1000",
                decimals: 6,
                symbol: "USDC",
                mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
              }
            },
            unclaimedRewards: [],
            unclaimedFeesUsd: 10.5,
            unclaimedRewardsUsd: 0,
            positionLiquidity: "500000",
            poolLiquidity: "1000000",
            hasActionableTrigger: false
          },
          {
            walletId: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            positionId: "pos-sol-usdc-02",
            poolId: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
            pair: "SOL/USDC",
            source: "orca",
            observedAtUnixMs: now,
            rangeState: "in-range",
            lowerTick: -200,
            upperTick: 200,
            currentTick: 0,
            lowerPriceLabel: "130.00",
            upperPriceLabel: "170.00",
            currentPrice: 150.5,
            currentPriceLabel: "150.50",
            rangeDistance: {
              belowLowerTickPercent: 0,
              aboveUpperTickPercent: 0,
              belowLowerPricePercent: 0,
              aboveUpperPricePercent: 0
            },
            feeRateLabel: "0.05%",
            unclaimedFees: {
              feeOwedA: {
                raw: "200",
                decimals: 9,
                symbol: "SOL",
                mint: "So11111111111111111111111111111111111111112"
              },
              feeOwedB: {
                raw: "2000",
                decimals: 6,
                symbol: "USDC",
                mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
              }
            },
            unclaimedRewards: [],
            unclaimedFeesUsd: 21.0,
            unclaimedRewardsUsd: 0,
            positionLiquidity: "500000",
            poolLiquidity: "1000000",
            hasActionableTrigger: false
          }
        ],
        alerts: [],
        dataQuality: { warnings: [], partial: false }
      },
      status: "ok"
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body);
  });

  const orcaServer = http.createServer((req, res) => {
    const body = JSON.stringify({
      address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
      whirlpoolData: {
        price: 150.5,
        liquidity: "1000000",
        feeRate: 500,
        protocolFeeRate: 300,
        tokenMintA: "So11111111111111111111111111111111111111112",
        tokenMintB: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
      }
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body);
  });

  const llmServer = http.createServer((req, res) => {
    let reqBody = "";
    req.on("data", (chunk) => (reqBody += chunk));
    req.on("end", () => {
      const response = {
        id: "chatcmpl-test",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({
                summary: "Live test research brief summary: SOL/USDC position in range.",
                keyTakeaways: [
                  "Liquidity is balanced around 150.50",
                  "Price oracle and DEX quote are aligned"
                ],
                supportsCurrentRegime: "supports",
                regimeAssessmentReasoning:
                  "Current market conditions and pool liquidity support maintaining position range.",
                confidenceScore: 0.9,
                confidenceReasoning:
                  "High confidence based on complete position state and price telemetry.",
                sourceEvidenceIds: [],
                unsupportedOrMissingInputs: []
              })
            },
            finish_reason: "stop"
          }
        ]
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
    });
  });

  const regimeServer = http.createServer((req, res) => {
    let reqBody = "";
    req.on("data", (chunk) => (reqBody += chunk));
    req.on("end", () => {
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "created", id: "pub-123" }));
    });
  });

  await new Promise<void>((resolve) => clmmServer.listen(3001, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => orcaServer.listen(3003, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => llmServer.listen(3002, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => regimeServer.listen(4000, "127.0.0.1", resolve));

  process.env.INTELLIGENCE_POSITION_IDS = "pos-sol-usdc-01,pos-sol-usdc-02";
  process.env.WHIRLPOOL_ADDRESS = "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE";
  process.env.WALLET_PUBLIC_KEY = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  process.env.INTELLIGENCE_CODE_VERSION = "development";
  process.env.INTELLIGENCE_GIT_COMMIT =
    "573757728a08567e517e9a605b7794bb4aac8301000000000000000000000000";
  process.env.INTELLIGENCE_ENVIRONMENT = "development";
  process.env.CLMM_DATA_API_BASE = "http://127.0.0.1:3001";
  process.env.CLMM_INSIGHTS_API_KEY = "dummy_key";
  process.env.ORCA_API_BASE = "http://127.0.0.1:3003";
  process.env.PYTH_HERMES_BASE_URL = "https://hermes.pyth.network";
  process.env.PYTH_SOL_USD_FEED_ID =
    "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
  process.env.SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
  process.env.LLM_BASE_URL = "http://127.0.0.1:3002/v1";
  process.env.LLM_API_KEY = "dummy_key";
  process.env.LLM_MODEL = "gpt-4o";
  process.env.REGIME_ENGINE_BASE_URL = "http://127.0.0.1:4000";
  process.env.REGIME_ENGINE_AUTH_TOKEN = "dummy_token";

  console.log("[Verify Task 4] Executing core evidence pipeline live...");
  const runtime = createNodeRuntime();
  await runCoreEvidencePipelineScript(runtime);

  clmmServer.close();
  orcaServer.close();
  llmServer.close();
  regimeServer.close();
}

main().catch((err) => {
  console.error("Task 4 Live Execution failed:", err);
  process.exit(1);
});
