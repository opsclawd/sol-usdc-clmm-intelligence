import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../../src/ports/http.js";
import { HttpRequestError } from "../../src/ports/http.js";
import { HttpHeliusFlowSource } from "../../src/adapters/node/http-helius-flow-source.js";
import { FakeRetry } from "../fakes/fake-retry.js";

const POOL_ADDRESS = "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE";
const CANONICAL_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const FROM_UNIX_MS = 1700000000000;
const TO_UNIX_MS = 1700000900000;

interface HeliusRawTransaction {
  signature: string;
  slot: number;
  timestamp: number;
  type: string;
  nativeTransfers: Array<{ amount: number }>;
  tokenTransfers: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    mint: string;
    tokenAmount: number;
  }>;
}

const capturedWindowTransactions: HeliusRawTransaction[] = [
  // 1. Inbound 300000.1
  {
    signature: "tx-inbound-300k",
    slot: 24681001,
    timestamp: 1700000100,
    type: "TRANSFER",
    nativeTransfers: [],
    tokenTransfers: [
      {
        fromUserAccount: "UserAccount111",
        toUserAccount: POOL_ADDRESS,
        mint: CANONICAL_USDC_MINT,
        tokenAmount: 300000.1
      }
    ]
  },
  // 2. Inbound 0.2
  {
    signature: "tx-inbound-small",
    slot: 24681002,
    timestamp: 1700000200,
    type: "TRANSFER",
    nativeTransfers: [],
    tokenTransfers: [
      {
        fromUserAccount: "UserAccount222",
        toUserAccount: POOL_ADDRESS,
        mint: CANONICAL_USDC_MINT,
        tokenAmount: 0.2
      }
    ]
  },
  // 3. Outbound 50000.3
  {
    signature: "tx-outbound-50k",
    slot: 24681003,
    timestamp: 1700000300,
    type: "TRANSFER",
    nativeTransfers: [],
    tokenTransfers: [
      {
        fromUserAccount: POOL_ADDRESS,
        toUserAccount: "UserAccount333",
        mint: CANONICAL_USDC_MINT,
        tokenAmount: 50000.3
      }
    ]
  },
  // 4. Unrelated transfer
  {
    signature: "tx-unrelated",
    slot: 24681004,
    timestamp: 1700000400,
    type: "TRANSFER",
    nativeTransfers: [],
    tokenTransfers: [
      {
        fromUserAccount: "UnrelatedAccountA",
        toUserAccount: "UnrelatedAccountB",
        mint: CANONICAL_USDC_MINT,
        tokenAmount: 100000
      }
    ]
  },
  // 5. Self-transfer
  {
    signature: "tx-self-transfer",
    slot: 24681005,
    timestamp: 1700000500,
    type: "TRANSFER",
    nativeTransfers: [],
    tokenTransfers: [
      {
        fromUserAccount: POOL_ADDRESS,
        toUserAccount: POOL_ADDRESS,
        mint: CANONICAL_USDC_MINT,
        tokenAmount: 100000
      }
    ]
  },
  // 6. Non-USDC transfer
  {
    signature: "tx-non-usdc",
    slot: 24681006,
    timestamp: 1700000600,
    type: "TRANSFER",
    nativeTransfers: [],
    tokenTransfers: [
      {
        fromUserAccount: "UserAccount111",
        toUserAccount: POOL_ADDRESS,
        mint: "So11111111111111111111111111111111111111112",
        tokenAmount: 5000
      }
    ]
  },
  // 7. Duplicate signature
  {
    signature: "tx-inbound-300k",
    slot: 24681001,
    timestamp: 1700000100,
    type: "TRANSFER",
    nativeTransfers: [],
    tokenTransfers: [
      {
        fromUserAccount: "UserAccount111",
        toUserAccount: POOL_ADDRESS,
        mint: CANONICAL_USDC_MINT,
        tokenAmount: 300000.1
      }
    ]
  },
  // 8. Transaction just outside lower boundary
  {
    signature: "tx-outside-lower",
    slot: 24680999,
    timestamp: 1699999999,
    type: "TRANSFER",
    nativeTransfers: [],
    tokenTransfers: [
      {
        fromUserAccount: "UserAccount111",
        toUserAccount: POOL_ADDRESS,
        mint: CANONICAL_USDC_MINT,
        tokenAmount: 999999
      }
    ]
  },
  // 9. Transaction just outside upper boundary
  {
    signature: "tx-outside-upper",
    slot: 24681009,
    timestamp: 1700000901,
    type: "TRANSFER",
    nativeTransfers: [],
    tokenTransfers: [
      {
        fromUserAccount: "UserAccount111",
        toUserAccount: POOL_ADDRESS,
        mint: CANONICAL_USDC_MINT,
        tokenAmount: 888888
      }
    ]
  }
];

describe("Issue 194 Helius windowed net-flow regression proof", () => {
  it("aggregates a Helius window into one exact dex_net_flow event", async () => {
    const mockHttp = {
      getJson: vi.fn().mockResolvedValue(capturedWindowTransactions),
      postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
    } as unknown as HttpClient;

    const source = new HttpHeliusFlowSource({
      http: mockHttp,
      url: "https://api.helius.com",
      apiKey: "test-api-key",
      retryControl: new FakeRetry()
    });

    const result = await source.collect({
      pair: "SOL/USDC",
      walletAddress: POOL_ADDRESS,
      addressType: "contract",
      fromUnixMs: FROM_UNIX_MS,
      toUnixMs: TO_UNIX_MS
    });

    const expected = {
      eventKind: "dex_net_flow",
      buyVolumeUsdc: "300000.3",
      sellVolumeUsdc: "50000.3",
      netFlowUsdc: "250000",
      amountUsdc: "250000",
      direction: "inbound",
      windowStartUnixMs: FROM_UNIX_MS,
      windowEndUnixMs: TO_UNIX_MS
    };

    expect(result.events).toHaveLength(1);
    const event = result.events[0] as Record<string, unknown>;
    expect(event).toMatchObject(expected);
    expect(event["sourceQuality"]).toMatchObject({
      provider: "helius-api",
      freshness: "windowed",
      completeness: "full"
    });
    expect(event["addressContext"]).toEqual({
      addressType: "contract",
      address: POOL_ADDRESS
    });
    expect(event["venue"]).toBe("solana");
    expect(typeof event["sourceEventId"]).toBe("string");
    expect(result.providerRunId).toContain(POOL_ADDRESS);
  });

  it("returns a full zero aggregate for a quiet window but throws for a failed collection", async () => {
    const mockHttpQuiet = {
      getJson: vi.fn().mockResolvedValue([]),
      postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
    } as unknown as HttpClient;

    const sourceQuiet = new HttpHeliusFlowSource({
      http: mockHttpQuiet,
      url: "https://api.helius.com",
      apiKey: "test-api-key"
    });

    const quietResult = await sourceQuiet.collect({
      pair: "SOL/USDC",
      walletAddress: POOL_ADDRESS,
      addressType: "contract",
      fromUnixMs: FROM_UNIX_MS,
      toUnixMs: TO_UNIX_MS
    });

    expect(quietResult.events).toHaveLength(1);
    const zeroEvent = quietResult.events[0] as Record<string, unknown>;
    expect(zeroEvent).toMatchObject({
      eventKind: "dex_net_flow",
      buyVolumeUsdc: "0",
      sellVolumeUsdc: "0",
      netFlowUsdc: "0",
      amountUsdc: "0",
      direction: "inbound",
      windowStartUnixMs: FROM_UNIX_MS,
      windowEndUnixMs: TO_UNIX_MS
    });
    expect(zeroEvent["sourceQuality"]).toMatchObject({
      provider: "helius-api",
      freshness: "windowed",
      completeness: "full"
    });

    const mockHttpFail = {
      getJson: vi
        .fn()
        .mockRejectedValue(
          new HttpRequestError("http_status", "500 Internal Server Error", 500, true)
        ),
      postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
    } as unknown as HttpClient;

    const sourceFail = new HttpHeliusFlowSource({
      http: mockHttpFail,
      url: "https://api.helius.com",
      apiKey: "test-api-key",
      maxAttempts: 1
    });

    await expect(
      sourceFail.collect({
        pair: "SOL/USDC",
        walletAddress: POOL_ADDRESS,
        addressType: "contract",
        fromUnixMs: FROM_UNIX_MS,
        toUnixMs: TO_UNIX_MS
      })
    ).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("keeps a partial aggregate when pagination reaches the page cap", async () => {
    let callCount = 0;
    const mockGetJson = vi.fn().mockImplementation(async () => {
      callCount++;
      const pageIndex = callCount - 1;
      const page: HeliusRawTransaction[] = [];
      for (let i = 0; i < 100; i++) {
        const txIndex = pageIndex * 100 + i;
        page.push({
          signature: `sig-page-${pageIndex}-tx-${i}`,
          slot: 24681000 + txIndex,
          timestamp: 1700000800,
          type: "TRANSFER",
          nativeTransfers: [],
          tokenTransfers: [
            {
              fromUserAccount: "TraderAAA",
              toUserAccount: POOL_ADDRESS,
              mint: CANONICAL_USDC_MINT,
              tokenAmount: 10
            }
          ]
        });
      }
      return page;
    });

    const mockHttpCap = {
      getJson: mockGetJson,
      postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
    } as unknown as HttpClient;

    const sourceCap = new HttpHeliusFlowSource({
      http: mockHttpCap,
      url: "https://api.helius.com",
      apiKey: "test-api-key"
    });

    const result = await sourceCap.collect({
      pair: "SOL/USDC",
      walletAddress: POOL_ADDRESS,
      addressType: "contract",
      fromUnixMs: FROM_UNIX_MS,
      toUnixMs: TO_UNIX_MS
    });

    expect(mockGetJson).toHaveBeenCalledTimes(25);
    expect(result.events).toHaveLength(1);
    const event = result.events[0] as Record<string, unknown>;
    expect(event["eventKind"]).toBe("dex_net_flow");
    expect(event["buyVolumeUsdc"]).toBe("25000");
    expect(event["sellVolumeUsdc"]).toBe("0");
    expect(event["netFlowUsdc"]).toBe("25000");
    expect((event["sourceQuality"] as Record<string, unknown>)["completeness"]).toBe("partial");
  });
});
