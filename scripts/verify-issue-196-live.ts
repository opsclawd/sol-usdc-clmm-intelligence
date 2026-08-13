import type {
  OnChainFlowSourcePort,
  OnChainFlowSourceRequest
} from "../src/ports/on-chain-flow-source.js";
import type { RawObservationRepo } from "../src/ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../src/ports/normalized-observation-repo.js";
import type { CollectionRunContext } from "../src/contracts/collection-run.js";
import type { OnChainFlowThresholds } from "../src/contracts/on-chain-flow.js";
import { collectOnChainFlow } from "../src/application/collect-on-chain-flow.js";
import { createNodeRuntime } from "../src/adapters/node/composition-root.js";
import {
  DEFAULT_ON_CHAIN_FLOW_LOOKBACK_MS,
  DEFAULT_ON_CHAIN_FLOW_THRESHOLDS
} from "../src/domain/on-chain-flow/defaults.js";
import { HttpHeliusFlowSource } from "../src/adapters/node/http-helius-flow-source.js";
import { HttpBirdeyeFlowSource } from "../src/adapters/node/http-birdeye-flow-source.js";
import { cleanupObservationRows } from "../src/adapters/node/dev-cleanup.js";

export interface VerifyIssue196LiveDeps {
  heliusSource: OnChainFlowSourcePort;
  birdeyeSource: OnChainFlowSourcePort;
  rawObservationRepo: RawObservationRepo;
  normalizedObservationRepo: NormalizedObservationRepo;
  thresholds: OnChainFlowThresholds;
  lookbackMs: number;
  poolAddress: string;
  context1: CollectionRunContext;
  context2: CollectionRunContext;
  cleanupAcceptedRows: (ids: readonly number[]) => Promise<void>;
}

export interface VerificationReport {
  status: "success";
  fromUnixMs: number;
  toUnixMs: number;
  lookbackMs: number;
  helius: {
    read1Status: string;
    read2Status: string;
    aggregate1Outcome: string;
    aggregate2Outcome: string;
  };
  birdeye: {
    read1Status: string;
    read2Status: string;
    aggregate1Outcome: string;
    aggregate2Outcome: string;
  };
  cleanedUpObservationIds: readonly number[];
}

export async function verifyIssue196Live(
  deps: VerifyIssue196LiveDeps
): Promise<VerificationReport> {
  const acceptedIds: number[] = [];

  try {
    const capturedRequests: { provider: string; request: OnChainFlowSourceRequest }[] = [];

    const wrappedHelius: OnChainFlowSourcePort = {
      collect: async (req) => {
        capturedRequests.push({ provider: "helius", request: req });
        return deps.heliusSource.collect(req);
      }
    };

    const wrappedBirdeye: OnChainFlowSourcePort = {
      collect: async (req) => {
        capturedRequests.push({ provider: "birdeye", request: req });
        return deps.birdeyeSource.collect(req);
      }
    };

    // First context read: Helius
    const heliusRes1 = await collectOnChainFlow(
      {
        source: wrappedHelius,
        rawObservationRepo: deps.rawObservationRepo,
        normalizedObservationRepo: deps.normalizedObservationRepo
      },
      deps.context1,
      {
        source: "helius-api",
        thresholds: deps.thresholds,
        lookbackMs: deps.lookbackMs,
        walletAddress: deps.poolAddress,
        addressType: "contract"
      }
    );
    if (heliusRes1.results[0]?.outcome === "failed") {
      throw new Error(`Helius read 1 failed: ${heliusRes1.results[0].diagnostic}`);
    }
    for (const r of heliusRes1.results) {
      if (
        r.outcome === "accepted" &&
        typeof r.sourceObservationId === "number" &&
        r.sourceObservationId > 0
      ) {
        acceptedIds.push(r.sourceObservationId);
      }
    }

    // First context read: Birdeye
    const birdeyeRes1 = await collectOnChainFlow(
      {
        source: wrappedBirdeye,
        rawObservationRepo: deps.rawObservationRepo,
        normalizedObservationRepo: deps.normalizedObservationRepo
      },
      deps.context1,
      {
        source: "birdeye-api",
        thresholds: deps.thresholds,
        lookbackMs: deps.lookbackMs,
        walletAddress: deps.poolAddress,
        addressType: "contract"
      }
    );
    if (birdeyeRes1.results[0]?.outcome === "failed") {
      throw new Error(`Birdeye read 1 failed: ${birdeyeRes1.results[0].diagnostic}`);
    }
    for (const r of birdeyeRes1.results) {
      if (
        r.outcome === "accepted" &&
        typeof r.sourceObservationId === "number" &&
        r.sourceObservationId > 0
      ) {
        acceptedIds.push(r.sourceObservationId);
      }
    }

    // Second context read: Helius
    const heliusRes2 = await collectOnChainFlow(
      {
        source: wrappedHelius,
        rawObservationRepo: deps.rawObservationRepo,
        normalizedObservationRepo: deps.normalizedObservationRepo
      },
      deps.context2,
      {
        source: "helius-api",
        thresholds: deps.thresholds,
        lookbackMs: deps.lookbackMs,
        walletAddress: deps.poolAddress,
        addressType: "contract"
      }
    );
    if (heliusRes2.results[0]?.outcome === "failed") {
      throw new Error(`Helius read 2 failed: ${heliusRes2.results[0].diagnostic}`);
    }
    for (const r of heliusRes2.results) {
      if (
        r.outcome === "accepted" &&
        typeof r.sourceObservationId === "number" &&
        r.sourceObservationId > 0
      ) {
        acceptedIds.push(r.sourceObservationId);
      }
    }

    // Second context read: Birdeye
    const birdeyeRes2 = await collectOnChainFlow(
      {
        source: wrappedBirdeye,
        rawObservationRepo: deps.rawObservationRepo,
        normalizedObservationRepo: deps.normalizedObservationRepo
      },
      deps.context2,
      {
        source: "birdeye-api",
        thresholds: deps.thresholds,
        lookbackMs: deps.lookbackMs,
        walletAddress: deps.poolAddress,
        addressType: "contract"
      }
    );
    if (birdeyeRes2.results[0]?.outcome === "failed") {
      throw new Error(`Birdeye read 2 failed: ${birdeyeRes2.results[0].diagnostic}`);
    }
    for (const r of birdeyeRes2.results) {
      if (
        r.outcome === "accepted" &&
        typeof r.sourceObservationId === "number" &&
        r.sourceObservationId > 0
      ) {
        acceptedIds.push(r.sourceObservationId);
      }
    }

    // Verify window bounds across all four provider requests
    if (capturedRequests.length !== 4) {
      throw new Error(
        `Expected 4 provider collection requests, but received ${capturedRequests.length}`
      );
    }
    const firstReq = capturedRequests[0]!.request;
    const duration = firstReq.toUnixMs - firstReq.fromUnixMs;
    if (duration !== deps.lookbackMs) {
      throw new Error(
        `Window duration ${duration}ms does not match lookbackMs ${deps.lookbackMs}ms`
      );
    }
    for (let i = 1; i < capturedRequests.length; i++) {
      const req = capturedRequests[i]!.request;
      if (req.fromUnixMs !== firstReq.fromUnixMs || req.toUnixMs !== firstReq.toUnixMs) {
        throw new Error(
          `Provider window disagreement: request 0 (${capturedRequests[0]!.provider}) bounds [${firstReq.fromUnixMs}, ${firstReq.toUnixMs}] vs request ${i} (${capturedRequests[i]!.provider}) bounds [${req.fromUnixMs}, ${req.toUnixMs}]`
        );
      }
    }

    // Require first dex_net_flow member from each source to be accepted and second to be replayed
    const heliusAggregate1 = heliusRes1.results.find((r) =>
      r.sourceEventId.startsWith("helius-address-history:")
    );
    if (!heliusAggregate1 || heliusAggregate1.outcome !== "accepted") {
      throw new Error(
        `Expected first Helius aggregate to be accepted, got ${heliusAggregate1?.outcome ?? "missing"}`
      );
    }

    const birdeyeAggregate1 = birdeyeRes1.results.find((r) =>
      r.sourceEventId.startsWith("birdeye-pair:")
    );
    if (!birdeyeAggregate1 || birdeyeAggregate1.outcome !== "accepted") {
      throw new Error(
        `Expected first Birdeye aggregate to be accepted, got ${birdeyeAggregate1?.outcome ?? "missing"}`
      );
    }

    // Verify provider aggregate event bounds match each other and request bounds
    const parseBoundsFromEventId = (eventId: string) => {
      const parts = eventId.split(":");
      const fromMs = Number(parts[parts.length - 2]);
      const toMs = Number(parts[parts.length - 1]);
      return { fromMs, toMs };
    };

    const hBounds = parseBoundsFromEventId(heliusAggregate1.sourceEventId);
    const bBounds = parseBoundsFromEventId(birdeyeAggregate1.sourceEventId);

    if (
      hBounds.fromMs !== bBounds.fromMs ||
      hBounds.toMs !== bBounds.toMs ||
      hBounds.fromMs !== firstReq.fromUnixMs ||
      hBounds.toMs !== firstReq.toUnixMs
    ) {
      throw new Error(
        `Provider window disagreement: Helius aggregate bounds [${hBounds.fromMs}, ${hBounds.toMs}] vs Birdeye aggregate bounds [${bBounds.fromMs}, ${bBounds.toMs}] vs Request bounds [${firstReq.fromUnixMs}, ${firstReq.toUnixMs}]`
      );
    }

    const heliusAggregate2 = heliusRes2.results.find((r) =>
      r.sourceEventId.startsWith("helius-address-history:")
    );
    if (!heliusAggregate2 || heliusAggregate2.outcome !== "replayed") {
      throw new Error(
        `Expected second Helius aggregate to be replayed, got ${heliusAggregate2?.outcome ?? "missing"}`
      );
    }

    const birdeyeAggregate2 = birdeyeRes2.results.find((r) =>
      r.sourceEventId.startsWith("birdeye-pair:")
    );
    if (!birdeyeAggregate2 || birdeyeAggregate2.outcome !== "replayed") {
      throw new Error(
        `Expected second Birdeye aggregate to be replayed, got ${birdeyeAggregate2?.outcome ?? "missing"}`
      );
    }

    return {
      status: "success",
      fromUnixMs: firstReq.fromUnixMs,
      toUnixMs: firstReq.toUnixMs,
      lookbackMs: deps.lookbackMs,
      helius: {
        read1Status: heliusRes1.status,
        read2Status: heliusRes2.status,
        aggregate1Outcome: heliusAggregate1.outcome,
        aggregate2Outcome: heliusAggregate2.outcome
      },
      birdeye: {
        read1Status: birdeyeRes1.status,
        read2Status: birdeyeRes2.status,
        aggregate1Outcome: birdeyeAggregate1.outcome,
        aggregate2Outcome: birdeyeAggregate2.outcome
      },
      cleanedUpObservationIds: Array.from(new Set(acceptedIds))
    };
  } finally {
    const uniqueAcceptedIds = Array.from(new Set(acceptedIds));
    await deps.cleanupAcceptedRows(uniqueAcceptedIds);
  }
}

export async function runLiveVerificationCLI(customEnv?: Record<string, string | undefined>) {
  const env = customEnv ?? process.env;

  if (env.ISSUE_196_LIVE_DATABASE_ACK !== "isolated-disposable") {
    throw new Error(
      "CLI refused to run: missing required acknowledgement ISSUE_196_LIVE_DATABASE_ACK=isolated-disposable"
    );
  }

  const requiredVars = [
    "DATABASE_URL",
    "HELIUS_FLOW_API_URL",
    "HELIUS_API_KEY",
    "BIRDEYE_FLOW_API_URL",
    "BIRDEYE_API_KEY",
    "WHIRLPOOL_ADDRESS"
  ] as const;

  for (const varName of requiredVars) {
    if (!env[varName]) {
      throw new Error(`Missing required environment variable: ${varName}`);
    }
  }

  let lookbackMs = DEFAULT_ON_CHAIN_FLOW_LOOKBACK_MS;
  if (env.ON_CHAIN_FLOW_LOOKBACK_MS) {
    const parsed = parseInt(env.ON_CHAIN_FLOW_LOOKBACK_MS, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      lookbackMs = parsed;
    }
  }

  const now = Date.now();
  const remainder = now % lookbackMs;
  if (remainder < 5_000) {
    console.warn("Aborting verification run: current time is within 5 seconds of cadence boundary");
    return;
  }

  const startedAt1 = now;
  const startedAt2 = now + 1;

  const context1: CollectionRunContext = {
    runId: `verify-live-1-${startedAt1}`,
    startedAtUnixMs: startedAt1
  };
  const context2: CollectionRunContext = {
    runId: `verify-live-2-${startedAt2}`,
    startedAtUnixMs: startedAt2
  };

  const runtime = createNodeRuntime();
  const persistence = await runtime.getPersistence();
  const connection = persistence.connection;

  try {
    const heliusSource = new HttpHeliusFlowSource({
      http: runtime.http,
      url: env.HELIUS_FLOW_API_URL!,
      apiKey: env.HELIUS_API_KEY!,
      retryControl: runtime.retryControl
    });

    const thresholds = DEFAULT_ON_CHAIN_FLOW_THRESHOLDS;

    const birdeyeSource = new HttpBirdeyeFlowSource({
      http: runtime.http,
      url: env.BIRDEYE_FLOW_API_URL!,
      apiKey: env.BIRDEYE_API_KEY!,
      poolAddress: env.WHIRLPOOL_ADDRESS!,
      whaleSwapMinUsdc: thresholds.whaleSwapMinUsdc,
      retryControl: runtime.retryControl
    });

    const cleanupAcceptedRows = async (ids: readonly number[]): Promise<void> => {
      await cleanupObservationRows(connection, ids);
    };

    const report = await verifyIssue196Live({
      heliusSource,
      birdeyeSource,
      rawObservationRepo: persistence.rawObservationRepo,
      normalizedObservationRepo: persistence.normalizedObservationRepo,
      thresholds,
      lookbackMs,
      poolAddress: env.WHIRLPOOL_ADDRESS!,
      context1,
      context2,
      cleanupAcceptedRows
    });

    console.log("[Verify Issue 196 Live] Verification report:", JSON.stringify(report, null, 2));
    return report;
  } finally {
    await connection.close();
  }
}

const isMainScript = Boolean(process.argv[1] && process.argv[1].includes("verify-issue-196-live"));
if (isMainScript) {
  runLiveVerificationCLI().catch((err) => {
    console.error("[Verify Issue 196 Live] Verification failed:", err);
    process.exit(1);
  });
}
