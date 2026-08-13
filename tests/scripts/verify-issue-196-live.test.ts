import { describe, it, expect, vi, type Mock } from "vitest";
import { verifyIssue196Live, runLiveVerificationCLI } from "../../scripts/verify-issue-196-live.js";
import type {
  OnChainFlowSourcePort,
  OnChainFlowSourceSnapshot,
  BirdeyeDexNetFlowEvent,
  HeliusDexNetFlowEvent
} from "../../src/ports/on-chain-flow-source.js";
import type {
  RawObservationRepo,
  RawObservationInsert,
  RawInsertOutcome,
  RawObservationRow
} from "../../src/ports/observation-repo.js";
import type {
  NormalizedObservationRepo,
  NormalizedObservationInsert
} from "../../src/ports/normalized-observation-repo.js";
import type { NormalizedObservationRow } from "../../src/contracts/normalized-observation.js";
import type { CollectionRunContext } from "../../src/contracts/collection-run.js";
import type { ParseStatus } from "../../src/contracts/taxonomy.js";
import {
  DEFAULT_ON_CHAIN_FLOW_THRESHOLDS,
  DEFAULT_ON_CHAIN_FLOW_LOOKBACK_MS
} from "../../src/domain/on-chain-flow/defaults.js";

function createMemoryRawRepo(): RawObservationRepo {
  let nextId = 100;
  const rows = new Map<string, RawObservationRow>();
  return {
    async insertOrClassify(data: RawObservationInsert): Promise<RawInsertOutcome> {
      const key = `${data.source}:${data.sourceObservationKey}`;
      const existing = rows.get(key);
      if (existing) {
        if (existing.payloadHash === data.payloadHash) {
          return { outcome: "identical_replay", row: existing };
        }
        return {
          outcome: "conflict",
          row: existing,
          incomingPayloadHash: data.payloadHash
        };
      }
      const id = ++nextId;
      const row: RawObservationRow = {
        id,
        source: data.source,
        sourceObservationKey: data.sourceObservationKey,
        observedAtUnixMs: data.observedAtUnixMs,
        fetchedAtUnixMs: data.fetchedAtUnixMs,
        payloadHash: data.payloadHash,
        payloadCanonical: data.payloadCanonical,
        parseStatus: data.parseStatus ?? "pending",
        sourceRequestMeta: data.sourceRequestMeta ?? null,
        receivedAtUnixMs: data.receivedAtUnixMs
      };
      rows.set(key, row);
      return { outcome: "inserted", row };
    },
    async updateParseStatus(id: number, status: ParseStatus): Promise<RawObservationRow> {
      for (const r of rows.values()) {
        if (r.id === id) {
          (r as unknown as { parseStatus: ParseStatus }).parseStatus = status;
          return r;
        }
      }
      throw new Error(`Row ${id} not found`);
    },
    async findById(id: number) {
      for (const r of rows.values()) if (r.id === id) return r;
      return undefined;
    },
    async findByIds(ids: number[]) {
      const idSet = new Set(ids);
      const res: RawObservationRow[] = [];
      for (const r of rows.values()) if (idSet.has(r.id)) res.push(r);
      return res;
    },
    async findByIdentity(source, key) {
      return rows.get(`${source}:${key}`);
    },
    async findByHash() {
      return undefined;
    },
    async findBySource() {
      return [];
    },
    async getLatestReceivedAt() {
      return new Map();
    }
  };
}

function createMemoryNormalizedRepo(): NormalizedObservationRepo {
  const rows: NormalizedObservationRow[] = [];
  let nextId = 1000;
  return {
    insert: (data: NormalizedObservationInsert): Promise<NormalizedObservationRow> => {
      const row = {
        id: ++nextId,
        rawObservationId: data.rawObservationId,
        source: data.source,
        observationKind: data.observationKind,
        signalClass: data.signalClass,
        evidenceFamily: data.evidenceFamily,
        payload: data.payload,
        payloadHash: data.payloadHash,
        confidence: data.confidence,
        confidenceComposite: "1.0000",
        confidenceLevel: "high",
        validUntilUnixMs: null,
        isStale: false,
        staleBehavior: null,
        provenance: data.provenance,
        receivedAtUnixMs: data.receivedAtUnixMs
      };
      const normRow = row as unknown as NormalizedObservationRow;
      rows.push(normRow);
      return Promise.resolve(normRow);
    },
    insertMany: (
      datas: readonly NormalizedObservationInsert[]
    ): Promise<NormalizedObservationRow[]> => {
      const inserted: NormalizedObservationRow[] = [];
      for (const data of datas) {
        const row = {
          id: ++nextId,
          rawObservationId: data.rawObservationId,
          source: data.source,
          observationKind: data.observationKind,
          signalClass: data.signalClass,
          evidenceFamily: data.evidenceFamily,
          payload: data.payload,
          payloadHash: data.payloadHash,
          confidence: data.confidence,
          confidenceComposite: "1.0000",
          confidenceLevel: "high",
          validUntilUnixMs: null,
          isStale: false,
          staleBehavior: null,
          provenance: data.provenance,
          receivedAtUnixMs: data.receivedAtUnixMs
        };
        const normRow = row as unknown as NormalizedObservationRow;
        rows.push(normRow);
        inserted.push(normRow);
      }
      return Promise.resolve(inserted);
    },
    async findBySource() {
      return [];
    },
    async findFreshByKind() {
      return [];
    },
    async findLatestByKind() {
      return null;
    },
    async findByRawObservation() {
      return null;
    },
    async listCandidates() {
      return [];
    },
    async findByIds() {
      return [];
    }
  };
}

function createFakeHeliusSource(options?: {
  boundsOffsetMs?: number;
  throwOnCallIndex?: number;
}): OnChainFlowSourcePort {
  let callCount = 0;
  return {
    collect: async (req) => {
      callCount++;
      if (options?.throwOnCallIndex && callCount === options.throwOnCallIndex) {
        throw new Error(`Simulated Helius network failure on call ${callCount}`);
      }
      const offset = options?.boundsOffsetMs ?? 0;
      const fromUnixMs = req.fromUnixMs + offset;
      const toUnixMs = req.toUnixMs + offset;
      const poolAddress = req.walletAddress ?? "test-pool";
      const event: HeliusDexNetFlowEvent = {
        eventKind: "dex_net_flow",
        sourceEventId: `helius-address-history:${poolAddress}:${fromUnixMs}:${toUnixMs}`,
        observedAtUnixMs: toUnixMs,
        amountUsdc: "1000",
        direction: "inbound",
        venue: "solana",
        addressContext: { addressType: "contract", address: poolAddress },
        sourceReferences: ["https://helius.example.com"],
        sourceQuality: { provider: "helius-api", freshness: "windowed", completeness: "full" },
        freshnessContext: { blockTimestampUnixMs: toUnixMs },
        windowStartUnixMs: fromUnixMs,
        windowEndUnixMs: toUnixMs,
        buyVolumeUsdc: "1000",
        sellVolumeUsdc: "0",
        netFlowUsdc: "1000"
      };
      const snapshot: OnChainFlowSourceSnapshot = {
        source: "helius-api",
        providerId: "helius-address-history",
        providerRunId: `helius-address-history:${poolAddress}:${fromUnixMs}:${toUnixMs}`,
        asOfUnixMs: toUnixMs,
        license: "Helius API",
        retention: "bounded",
        events: [event]
      };
      return snapshot;
    }
  };
}

function createFakeBirdeyeSource(options?: {
  boundsOffsetMs?: number;
  throwOnCallIndex?: number;
}): OnChainFlowSourcePort {
  let callCount = 0;
  return {
    collect: async (req) => {
      callCount++;
      if (options?.throwOnCallIndex && callCount === options.throwOnCallIndex) {
        throw new Error(`Simulated Birdeye network failure on call ${callCount}`);
      }
      const offset = options?.boundsOffsetMs ?? 0;
      const fromUnixMs = req.fromUnixMs + offset;
      const toUnixMs = req.toUnixMs + offset;
      const poolAddress = req.walletAddress ?? "test-pool";
      const event: BirdeyeDexNetFlowEvent = {
        eventKind: "dex_net_flow",
        sourceEventId: `birdeye-pair:${poolAddress}:${fromUnixMs}:${toUnixMs}`,
        observedAtUnixMs: toUnixMs,
        amountUsdc: "1000",
        direction: "inbound",
        venue: "solana",
        addressContext: { addressType: "contract", address: poolAddress },
        sourceReferences: ["https://birdeye.example.com"],
        sourceQuality: { provider: "birdeye-api", freshness: "windowed", completeness: "full" },
        freshnessContext: { blockTimestampUnixMs: toUnixMs },
        windowStartUnixMs: fromUnixMs,
        windowEndUnixMs: toUnixMs,
        buyVolumeUsdc: "1000",
        sellVolumeUsdc: "0",
        netFlowUsdc: "1000"
      };
      const snapshot: OnChainFlowSourceSnapshot = {
        source: "birdeye-api",
        providerId: "birdeye-pair-trades",
        providerRunId: `birdeye-pair:${poolAddress}:${fromUnixMs}:${toUnixMs}`,
        asOfUnixMs: toUnixMs,
        license: "Birdeye API",
        retention: "bounded",
        events: [event]
      };
      return snapshot;
    }
  };
}

describe("verifyIssue196Live", () => {
  const lookbackMs = DEFAULT_ON_CHAIN_FLOW_LOOKBACK_MS;
  const thresholds = DEFAULT_ON_CHAIN_FLOW_THRESHOLDS;
  const poolAddress = "test-pool-whirlpool";

  // Pick a fixed timestamp well away from cadence boundary
  const fixedNow = 1700000000000 + 100000;
  const context1: CollectionRunContext = {
    runId: "test-run-1",
    startedAtUnixMs: fixedNow
  };
  const context2: CollectionRunContext = {
    runId: "test-run-2",
    startedAtUnixMs: fixedNow + 1
  };

  it("accepts each live aggregate once and replays it on the second closed-window read", async () => {
    const heliusSource = createFakeHeliusSource();
    const birdeyeSource = createFakeBirdeyeSource();
    const rawObservationRepo = createMemoryRawRepo();
    const normalizedObservationRepo = createMemoryNormalizedRepo();
    const cleanupAcceptedRows: Mock<(ids: readonly number[]) => Promise<void>> = vi.fn(
      async () => {}
    );

    const report = await verifyIssue196Live({
      heliusSource,
      birdeyeSource,
      rawObservationRepo,
      normalizedObservationRepo,
      thresholds,
      lookbackMs,
      poolAddress,
      context1,
      context2,
      cleanupAcceptedRows
    });

    expect(report.status).toBe("success");
    expect(report.helius.aggregate1Outcome).toBe("accepted");
    expect(report.helius.aggregate2Outcome).toBe("replayed");
    expect(report.birdeye.aggregate1Outcome).toBe("accepted");
    expect(report.birdeye.aggregate2Outcome).toBe("replayed");
    expect(report.cleanedUpObservationIds.length).toBe(2);
    expect(cleanupAcceptedRows).toHaveBeenCalledWith(report.cleanedUpObservationIds);
  });

  it("rejects provider window disagreement before claiming success", async () => {
    const heliusSource = createFakeHeliusSource();
    // Birdeye source returns bounds shifted by 1000ms
    const birdeyeSource = createFakeBirdeyeSource({ boundsOffsetMs: 1000 });
    const rawObservationRepo = createMemoryRawRepo();
    const normalizedObservationRepo = createMemoryNormalizedRepo();
    const cleanupAcceptedRows: Mock<(ids: readonly number[]) => Promise<void>> = vi.fn(
      async () => {}
    );

    await expect(
      verifyIssue196Live({
        heliusSource,
        birdeyeSource,
        rawObservationRepo,
        normalizedObservationRepo,
        thresholds,
        lookbackMs,
        poolAddress,
        context1,
        context2,
        cleanupAcceptedRows
      })
    ).rejects.toThrow(/Provider window disagreement/);

    expect(cleanupAcceptedRows).toHaveBeenCalled();
  });

  it("deletes only verifier-owned accepted rows after successful verification", async () => {
    const heliusSource = createFakeHeliusSource();
    const birdeyeSource = createFakeBirdeyeSource();
    const rawObservationRepo = createMemoryRawRepo();
    const normalizedObservationRepo = createMemoryNormalizedRepo();
    const cleanupAcceptedRows: Mock<(ids: readonly number[]) => Promise<void>> = vi.fn(
      async () => {}
    );

    const report = await verifyIssue196Live({
      heliusSource,
      birdeyeSource,
      rawObservationRepo,
      normalizedObservationRepo,
      thresholds,
      lookbackMs,
      poolAddress,
      context1,
      context2,
      cleanupAcceptedRows
    });

    expect(cleanupAcceptedRows).toHaveBeenCalledTimes(1);
    const cleanedIds = cleanupAcceptedRows.mock.calls[0]?.[0];
    expect(cleanedIds).toEqual(report.cleanedUpObservationIds);
    expect(cleanedIds).toEqual([101, 102]);
  });

  it("deletes verifier-owned accepted rows when the second read fails", async () => {
    const heliusSource = createFakeHeliusSource();
    // Birdeye source fails on its second call (which is the second read)
    const birdeyeSource = createFakeBirdeyeSource({ throwOnCallIndex: 2 });
    const rawObservationRepo = createMemoryRawRepo();
    const normalizedObservationRepo = createMemoryNormalizedRepo();
    const cleanupAcceptedRows: Mock<(ids: readonly number[]) => Promise<void>> = vi.fn(
      async () => {}
    );

    await expect(
      verifyIssue196Live({
        heliusSource,
        birdeyeSource,
        rawObservationRepo,
        normalizedObservationRepo,
        thresholds,
        lookbackMs,
        poolAddress,
        context1,
        context2,
        cleanupAcceptedRows
      })
    ).rejects.toThrow(/Simulated Birdeye network failure/);

    expect(cleanupAcceptedRows).toHaveBeenCalledTimes(1);
    const cleanedIds = cleanupAcceptedRows.mock.calls[0]?.[0];
    // Rows from first read (Helius = 101, Birdeye = 102) were accepted before the failure
    expect(cleanedIds).toEqual([101, 102]);
  });

  it("never deletes a pre-existing row returned as a replay", async () => {
    const rawObservationRepo = createMemoryRawRepo();
    const normalizedObservationRepo = createMemoryNormalizedRepo();
    const cleanupAcceptedRows: Mock<(ids: readonly number[]) => Promise<void>> = vi.fn(
      async () => {}
    );

    // Pre-insert a whale_swap event into rawObservationRepo before verifyIssue196Live runs
    const toUnixMs = Math.floor(context1.startedAtUnixMs / lookbackMs) * lookbackMs;
    const preExistingTxHash = "pre-existing-tx-signature-123";

    // Compute exact observation key for whale_swap event
    const { canonicalizePayload } = await import("../../src/domain/content-hash.js");
    const { normalizeOnChainFlow, acceptOnChainFlowSourceEvent } =
      await import("../../src/domain/on-chain-flow/index.js");
    const { deriveOnChainFlowSourceObservationKey } =
      await import("../../src/domain/on-chain-flow/identity.js");

    const whaleEvent = {
      eventKind: "whale_swap" as const,
      sourceEventId: preExistingTxHash,
      observedAtUnixMs: toUnixMs,
      amountUsdc: "200000",
      direction: "inbound" as const,
      venue: "solana" as const,
      addressContext: { addressType: "wallet" as const, address: "some-wallet" },
      sourceReferences: ["https://solscan.io/tx/" + preExistingTxHash],
      sourceQuality: {
        provider: "birdeye-api" as const,
        freshness: "windowed" as const,
        completeness: "full" as const
      },
      freshnessContext: { blockTimestampUnixMs: toUnixMs },
      transactionSignature: preExistingTxHash,
      eventIndex: 0 as const,
      stablecoinOperation: "transfer" as const
    };

    const normPayload = normalizeOnChainFlow(
      acceptOnChainFlowSourceEvent(whaleEvent),
      context1.startedAtUnixMs
    );
    const preExistingKey = await deriveOnChainFlowSourceObservationKey(
      normPayload,
      "birdeye-api",
      null
    );
    const { payloadCanonical, payloadHash } = await canonicalizePayload(normPayload);

    const preInsertedResult = await rawObservationRepo.insertOrClassify({
      source: "birdeye-api",
      sourceObservationKey: preExistingKey,
      observedAtUnixMs: toUnixMs,
      fetchedAtUnixMs: toUnixMs,
      payloadHash,
      payloadCanonical,
      parseStatus: "parsed",
      receivedAtUnixMs: context1.startedAtUnixMs - 60000
    });

    const preExistingId = preInsertedResult.row.id;

    // Create Birdeye source that returns both the dex_net_flow event and the pre-existing whale_swap event
    const birdeyeSource: OnChainFlowSourcePort = {
      collect: async (req) => {
        const fromUnixMs = req.fromUnixMs;
        const toUnixMs = req.toUnixMs;
        const poolAddress = req.walletAddress ?? "test-pool";
        return {
          source: "birdeye-api",
          providerId: "birdeye-pair-trades",
          providerRunId: `birdeye-pair:${poolAddress}:${fromUnixMs}:${toUnixMs}`,
          asOfUnixMs: toUnixMs,
          license: "Birdeye API",
          retention: "bounded",
          events: [
            {
              eventKind: "dex_net_flow",
              sourceEventId: `birdeye-pair:${poolAddress}:${fromUnixMs}:${toUnixMs}`,
              observedAtUnixMs: toUnixMs,
              amountUsdc: "1000",
              direction: "inbound",
              venue: "solana",
              addressContext: { addressType: "contract", address: poolAddress },
              sourceReferences: ["https://birdeye.example.com"],
              sourceQuality: {
                provider: "birdeye-api",
                freshness: "windowed",
                completeness: "full"
              },
              freshnessContext: { blockTimestampUnixMs: toUnixMs },
              windowStartUnixMs: fromUnixMs,
              windowEndUnixMs: toUnixMs,
              buyVolumeUsdc: "1000",
              sellVolumeUsdc: "0",
              netFlowUsdc: "1000"
            },
            whaleEvent
          ]
        };
      }
    };

    const heliusSource = createFakeHeliusSource();

    const report = await verifyIssue196Live({
      heliusSource,
      birdeyeSource,
      rawObservationRepo,
      normalizedObservationRepo,
      thresholds,
      lookbackMs,
      poolAddress,
      context1,
      context2,
      cleanupAcceptedRows
    });

    expect(report.status).toBe("success");
    expect(cleanupAcceptedRows).toHaveBeenCalledTimes(1);
    const cleanedIds = cleanupAcceptedRows.mock.calls[0]?.[0];
    expect(cleanedIds).not.toContain(preExistingId);
  });

  it("refuses to run without disposable-database acknowledgement", async () => {
    await expect(
      runLiveVerificationCLI({
        ISSUE_196_LIVE_DATABASE_ACK: "wrong-ack"
      })
    ).rejects.toThrow(/isolated-disposable/);
  });
});
