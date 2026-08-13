import { describe, expect, it } from "vitest";
import type { OnChainFlowThresholds } from "../../src/contracts/on-chain-flow.js";
import type { CollectionRunContext } from "../../src/contracts/collection-run.js";
import type {
  OnChainFlowSourcePort,
  OnChainFlowSourceRequest,
  OnChainFlowSourceSnapshot,
  OnChainFlowSourceEvent
} from "../../src/ports/on-chain-flow-source.js";
import { FakeObservationRepo } from "../fakes/fake-observation-repo.js";
import { FakeNormalizedObservationRepo } from "../fakes/fake-normalized-observation-repo.js";
import { collectOnChainFlow } from "../../src/application/collect-on-chain-flow.js";

const CADENCE_MS = 15 * 60 * 1000;
const BOUNDARY_UNIX_MS = 1_700_010_000_000; // Aligned to 15-minute boundary (1700010000000 % 900000 === 0)

const VALID_THRESHOLDS: OnChainFlowThresholds = Object.freeze({
  whaleSwapMinUsdc: "100000",
  stablecoinFlowMinUsdc: "1000",
  cexFlowProxyMinUsdc: "50000",
  cexMinAttributionConfidence: 0.5
});

class WindowEchoSource implements OnChainFlowSourcePort {
  public readonly recordedRequests: OnChainFlowSourceRequest[] = [];

  constructor(private readonly provider: "helius-api" | "birdeye-api") {}

  async collect(request: OnChainFlowSourceRequest): Promise<OnChainFlowSourceSnapshot> {
    this.recordedRequests.push(request);

    const providerId = `${this.provider}-echo`;
    const providerRunId = `run-${request.fromUnixMs}-${request.toUnixMs}`;
    const poolAddress = request.walletAddress ?? "Whirlpool1111111111111111111111111111111111";

    const event = Object.freeze({
      eventKind: "dex_net_flow" as const,
      sourceEventId: `${this.provider}:${poolAddress}:${request.fromUnixMs}:${request.toUnixMs}`,
      observedAtUnixMs: request.toUnixMs,
      amountUsdc: "1000",
      direction: "inbound" as const,
      venue: "solana" as const,
      addressContext: {
        addressType: (request.addressType ?? "contract") as "contract",
        address: poolAddress
      },
      sourceReferences: [`https://api.example.com/${this.provider}`],
      sourceQuality: {
        provider: this.provider,
        freshness: "windowed" as const,
        completeness: "full" as const
      },
      freshnessContext: { blockTimestampUnixMs: request.toUnixMs },
      windowStartUnixMs: request.fromUnixMs,
      windowEndUnixMs: request.toUnixMs,
      buyVolumeUsdc: "500",
      sellVolumeUsdc: "500",
      netFlowUsdc: "0"
    });

    return {
      source: this.provider,
      providerId,
      providerRunId,
      asOfUnixMs: request.toUnixMs,
      license: "CC0-1.0",
      retention: "bounded",
      events: [event as unknown as OnChainFlowSourceEvent]
    };
  }
}

describe("issue-196: on-chain flow cadence window grid regression proof", () => {
  it("replays a retry whose start time jitters within the same cadence bucket", async () => {
    const rawRepo = new FakeObservationRepo();
    const normalizedRepo = new FakeNormalizedObservationRepo();
    const source = new WindowEchoSource("helius-api");
    const deps = {
      source,
      rawObservationRepo: rawRepo,
      normalizedObservationRepo: normalizedRepo
    };

    const firstContext: CollectionRunContext = {
      runId: "run-1",
      startedAtUnixMs: BOUNDARY_UNIX_MS + 10_000
    };

    const firstResult = await collectOnChainFlow(deps, firstContext, {
      source: "helius-api",
      thresholds: VALID_THRESHOLDS,
      lookbackMs: CADENCE_MS
    });

    const secondContext: CollectionRunContext = {
      runId: "run-2",
      startedAtUnixMs: BOUNDARY_UNIX_MS + 30_000
    };

    const secondResult = await collectOnChainFlow(deps, secondContext, {
      source: "helius-api",
      thresholds: VALID_THRESHOLDS,
      lookbackMs: CADENCE_MS
    });

    expect(firstResult.status).toBe("accepted");
    expect(secondResult.status).toBe("identical_replay");
    expect(secondResult.replayed).toBe(1);

    expect(source.recordedRequests).toHaveLength(2);
    expect(source.recordedRequests[0]).toEqual({
      pair: "SOL/USDC",
      fromUnixMs: BOUNDARY_UNIX_MS - CADENCE_MS,
      toUnixMs: BOUNDARY_UNIX_MS
    });
    expect(source.recordedRequests[1]).toEqual({
      pair: "SOL/USDC",
      fromUnixMs: BOUNDARY_UNIX_MS - CADENCE_MS,
      toUnixMs: BOUNDARY_UNIX_MS
    });

    expect(normalizedRepo.count).toBe(1);
  });

  it("tiles requests from adjacent cadence buckets without gaps or overlaps", async () => {
    const source = new WindowEchoSource("helius-api");

    const firstDeps = {
      source,
      rawObservationRepo: new FakeObservationRepo(),
      normalizedObservationRepo: new FakeNormalizedObservationRepo()
    };
    const firstContext: CollectionRunContext = {
      runId: "run-bucket-1",
      startedAtUnixMs: BOUNDARY_UNIX_MS + 10_000
    };
    await collectOnChainFlow(firstDeps, firstContext, {
      source: "helius-api",
      thresholds: VALID_THRESHOLDS,
      lookbackMs: CADENCE_MS
    });

    const secondDeps = {
      source,
      rawObservationRepo: new FakeObservationRepo(),
      normalizedObservationRepo: new FakeNormalizedObservationRepo()
    };
    const secondContext: CollectionRunContext = {
      runId: "run-bucket-2",
      startedAtUnixMs: BOUNDARY_UNIX_MS + CADENCE_MS + 20_000
    };
    await collectOnChainFlow(secondDeps, secondContext, {
      source: "helius-api",
      thresholds: VALID_THRESHOLDS,
      lookbackMs: CADENCE_MS
    });

    expect(source.recordedRequests).toHaveLength(2);
    const firstRequest = source.recordedRequests[0]!;
    const secondRequest = source.recordedRequests[1]!;

    expect(secondRequest.fromUnixMs).toBe(firstRequest.toUnixMs);
    expect(firstRequest.toUnixMs - firstRequest.fromUnixMs).toBe(CADENCE_MS);
    expect(secondRequest.toUnixMs - secondRequest.fromUnixMs).toBe(CADENCE_MS);
  });

  it("passes identical window bounds to Birdeye and Helius for one run context", async () => {
    const heliusSource = new WindowEchoSource("helius-api");
    const birdeyeSource = new WindowEchoSource("birdeye-api");

    const runContext: CollectionRunContext = {
      runId: "run-agreement",
      startedAtUnixMs: BOUNDARY_UNIX_MS + 15_000
    };

    await collectOnChainFlow(
      {
        source: heliusSource,
        rawObservationRepo: new FakeObservationRepo(),
        normalizedObservationRepo: new FakeNormalizedObservationRepo()
      },
      runContext,
      {
        source: "helius-api",
        thresholds: VALID_THRESHOLDS,
        lookbackMs: CADENCE_MS
      }
    );

    await collectOnChainFlow(
      {
        source: birdeyeSource,
        rawObservationRepo: new FakeObservationRepo(),
        normalizedObservationRepo: new FakeNormalizedObservationRepo()
      },
      runContext,
      {
        source: "birdeye-api",
        thresholds: VALID_THRESHOLDS,
        lookbackMs: CADENCE_MS
      }
    );

    const heliusRequest = heliusSource.recordedRequests[0]!;
    const birdeyeRequest = birdeyeSource.recordedRequests[0]!;

    expect(heliusRequest.fromUnixMs).toBe(birdeyeRequest.fromUnixMs);
    expect(heliusRequest.toUnixMs).toBe(birdeyeRequest.toUnixMs);
  });

  it("selects only the latest closed bucket after a delay longer than one cadence", async () => {
    const source = new WindowEchoSource("helius-api");

    const normalContext: CollectionRunContext = {
      runId: "run-normal",
      startedAtUnixMs: BOUNDARY_UNIX_MS + 10_000
    };
    await collectOnChainFlow(
      {
        source,
        rawObservationRepo: new FakeObservationRepo(),
        normalizedObservationRepo: new FakeNormalizedObservationRepo()
      },
      normalContext,
      {
        source: "helius-api",
        thresholds: VALID_THRESHOLDS,
        lookbackMs: CADENCE_MS
      }
    );

    const delayedContext: CollectionRunContext = {
      runId: "run-delayed",
      startedAtUnixMs: BOUNDARY_UNIX_MS + 2 * CADENCE_MS + 10_000
    };
    await collectOnChainFlow(
      {
        source,
        rawObservationRepo: new FakeObservationRepo(),
        normalizedObservationRepo: new FakeNormalizedObservationRepo()
      },
      delayedContext,
      {
        source: "helius-api",
        thresholds: VALID_THRESHOLDS,
        lookbackMs: CADENCE_MS
      }
    );

    expect(source.recordedRequests).toHaveLength(2);
    const delayedRequest = source.recordedRequests[1]!;

    expect(delayedRequest.fromUnixMs).toBe(BOUNDARY_UNIX_MS + CADENCE_MS);
    expect(delayedRequest.toUnixMs).toBe(BOUNDARY_UNIX_MS + 2 * CADENCE_MS);
  });
});
