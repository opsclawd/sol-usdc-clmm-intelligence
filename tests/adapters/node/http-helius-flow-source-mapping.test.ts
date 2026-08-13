import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../../../src/ports/http.js";
import { HttpRequestError } from "../../../src/ports/http.js";
import { HttpHeliusFlowSource } from "../../../src/adapters/node/http-helius-flow-source.js";
import type { OnChainFlowSourceError } from "../../../src/ports/on-chain-flow-source.js";
import heliusTransactionsFixture from "../../fixtures/helius-address-transactions.json" with { type: "json" };
import { FakeRetry } from "../../fakes/fake-retry.js";

const WATCHED_WALLET = "Wallet123";
const FROM_UNIX_MS = 1700000000000;
const TO_UNIX_MS = 1700000100000;

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

function createMockHttpClient(behavior: {
  shouldTimeout?: boolean;
  networkError?: boolean;
  httpStatus?: number;
  body?: unknown;
}): HttpClient {
  return {
    getJson: vi.fn().mockImplementation(async (): Promise<unknown> => {
      if (behavior.networkError) {
        throw new TypeError("network error");
      }

      if (behavior.shouldTimeout) {
        throw new DOMException(`Aborted: https://api.helius.com`, "AbortError");
      }

      if (behavior.httpStatus !== undefined && behavior.httpStatus >= 400) {
        throw new HttpRequestError(
          "http_status",
          `GET https://api.helius.com failed: ${behavior.httpStatus}`,
          behavior.httpStatus,
          behavior.httpStatus === 429 || behavior.httpStatus >= 500
        );
      }

      return behavior.body;
    }),
    postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
  } as unknown as HttpClient;
}

describe("HttpHeliusFlowSource mapping", () => {
  describe("maps inbound and outbound pool transfers to buy and sell gross legs", () => {
    it("maps inbound and outbound pool transfers to buy and sell gross legs", async () => {
      const inboundTx = (heliusTransactionsFixture as HeliusRawTransaction[]).find(
        (t) => t.signature === "captured-inbound-signature"
      )!;
      const outboundTx = (heliusTransactionsFixture as HeliusRawTransaction[]).find(
        (t) => t.signature === "captured-outbound-signature"
      )!;

      const mockHttp = createMockHttpClient({
        body: [inboundTx, outboundTx]
      });

      const source = new HttpHeliusFlowSource({
        http: mockHttp,
        url: "https://api.helius.com",
        apiKey: "test-api-key"
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        walletAddress: WATCHED_WALLET,
        fromUnixMs: FROM_UNIX_MS,
        toUnixMs: TO_UNIX_MS
      });

      expect(result.events).toHaveLength(1);
      const event = result.events[0] as unknown as Record<string, unknown>;
      expect(event["eventKind"]).toBe("dex_net_flow");
      expect(event["buyVolumeUsdc"]).toBe("1250000.25");
      expect(event["sellVolumeUsdc"]).toBe("2500000.5");
      expect(event["netFlowUsdc"]).toBe("-1250000.25");
      expect(event["amountUsdc"]).toBe("1250000.25");
      expect(event["direction"]).toBe("outbound");
    });
  });

  describe("aggregates fractional USDC with exact six-decimal arithmetic", () => {
    it("aggregates fractional USDC with exact six-decimal arithmetic", async () => {
      const tx1: HeliusRawTransaction = {
        signature: "frac-1",
        slot: 100,
        timestamp: 1700000050,
        type: "TRANSFER",
        nativeTransfers: [],
        tokenTransfers: [
          {
            fromUserAccount: "TraderA",
            toUserAccount: WATCHED_WALLET,
            mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            tokenAmount: 0.100001
          }
        ]
      };
      const tx2: HeliusRawTransaction = {
        signature: "frac-2",
        slot: 101,
        timestamp: 1700000060,
        type: "TRANSFER",
        nativeTransfers: [],
        tokenTransfers: [
          {
            fromUserAccount: "TraderB",
            toUserAccount: WATCHED_WALLET,
            mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            tokenAmount: 0.200002
          }
        ]
      };
      const tx3: HeliusRawTransaction = {
        signature: "frac-3",
        slot: 102,
        timestamp: 1700000070,
        type: "TRANSFER",
        nativeTransfers: [],
        tokenTransfers: [
          {
            fromUserAccount: WATCHED_WALLET,
            toUserAccount: "TraderC",
            mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            tokenAmount: 0.000001
          }
        ]
      };

      const mockHttp = createMockHttpClient({
        body: [tx1, tx2, tx3]
      });

      const source = new HttpHeliusFlowSource({
        http: mockHttp,
        url: "https://api.helius.com",
        apiKey: "test-api-key"
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        walletAddress: WATCHED_WALLET,
        fromUnixMs: FROM_UNIX_MS,
        toUnixMs: TO_UNIX_MS
      });

      expect(result.events).toHaveLength(1);
      const event = result.events[0] as unknown as Record<string, unknown>;
      expect(event["buyVolumeUsdc"]).toBe("0.300003");
      expect(event["sellVolumeUsdc"]).toBe("0.000001");
      expect(event["netFlowUsdc"]).toBe("0.300002");
      expect(event["amountUsdc"]).toBe("0.300002");
    });
  });

  describe("ignores non-USDC, self-transfer, and unrelated records", () => {
    it("ignores non-USDC, self-transfer, and unrelated records", async () => {
      const nonUsdcTx = (heliusTransactionsFixture as HeliusRawTransaction[]).find(
        (t) => t.signature === "non-usdc-signature"
      )!;
      const unrelatedTx = (heliusTransactionsFixture as HeliusRawTransaction[]).find(
        (t) => t.signature === "unrelated-wallet-signature"
      )!;
      const selfTransferTx = (heliusTransactionsFixture as HeliusRawTransaction[]).find(
        (t) => t.signature === "self-transfer-signature"
      )!;

      const mockHttp = createMockHttpClient({
        body: [nonUsdcTx, unrelatedTx, selfTransferTx]
      });

      const source = new HttpHeliusFlowSource({
        http: mockHttp,
        url: "https://api.helius.com",
        apiKey: "test-api-key"
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        walletAddress: WATCHED_WALLET,
        fromUnixMs: FROM_UNIX_MS,
        toUnixMs: TO_UNIX_MS
      });

      expect(result.events).toHaveLength(1);
      const event = result.events[0] as unknown as Record<string, unknown>;
      expect(event["buyVolumeUsdc"]).toBe("0");
      expect(event["sellVolumeUsdc"]).toBe("0");
      expect(event["netFlowUsdc"]).toBe("0");
    });
  });

  describe("keeps only transfers inside the inclusive requested window", () => {
    it("keeps only transfers inside the inclusive requested window", async () => {
      const inWindowTx = (heliusTransactionsFixture as HeliusRawTransaction[]).find(
        (t) => t.signature === "captured-inbound-signature"
      )!;
      const outOfWindowTx = (heliusTransactionsFixture as HeliusRawTransaction[]).find(
        (t) => t.signature === "out-of-window-signature"
      )!;

      const mockHttp = createMockHttpClient({
        body: [inWindowTx, outOfWindowTx]
      });

      const source = new HttpHeliusFlowSource({
        http: mockHttp,
        url: "https://api.helius.com",
        apiKey: "test-api-key"
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        walletAddress: WATCHED_WALLET,
        fromUnixMs: FROM_UNIX_MS,
        toUnixMs: TO_UNIX_MS
      });

      expect(result.events).toHaveLength(1);
      const event = result.events[0] as unknown as Record<string, unknown>;
      expect(event["buyVolumeUsdc"]).toBe("1250000.25");
      expect(event["sellVolumeUsdc"]).toBe("0");
    });
  });

  describe("calls the legacy address-history endpoint with bounded query parameters", () => {
    it("calls the legacy address-history endpoint with bounded query parameters", async () => {
      const mockHttp = createMockHttpClient({
        body: []
      });

      const source = new HttpHeliusFlowSource({
        http: mockHttp,
        url: "https://api.helius.com",
        apiKey: "test-api-key"
      });

      await source.collect({
        pair: "SOL/USDC",
        walletAddress: WATCHED_WALLET,
        fromUnixMs: FROM_UNIX_MS,
        toUnixMs: TO_UNIX_MS
      });

      expect(mockHttp.getJson).toHaveBeenCalledTimes(1);
      const mockFn = mockHttp.getJson as ReturnType<typeof vi.fn>;
      const calls = mockFn.mock.calls;
      expect(calls).toHaveLength(1);
      const [url, options] = calls[0] as [string, { headers: Record<string, string> }];

      const parsedUrl = new URL(url);
      expect(parsedUrl.origin).toBe("https://api.helius.com");
      expect(parsedUrl.pathname).toBe("/v0/addresses/Wallet123/transactions");
      expect(parsedUrl.searchParams.get("api-key")).toBe("test-api-key");
      expect(parsedUrl.searchParams.get("limit")).toBe("100");
      expect(options.headers).not.toHaveProperty("Authorization");
    });
  });

  describe("does not append api-key query parameter when apiKey is not provided", () => {
    it("does not append api-key query parameter when apiKey is undefined", async () => {
      const mockHttp = createMockHttpClient({
        body: []
      });

      const source = new HttpHeliusFlowSource({
        http: mockHttp,
        url: "https://api.helius.com/v0/addresses/{address}/transactions"
      });

      await source.collect({
        pair: "SOL/USDC",
        walletAddress: WATCHED_WALLET,
        fromUnixMs: FROM_UNIX_MS,
        toUnixMs: TO_UNIX_MS
      });

      expect(mockHttp.getJson).toHaveBeenCalledTimes(1);
      const mockFn = mockHttp.getJson as ReturnType<typeof vi.fn>;
      const calls = mockFn.mock.calls;
      const [url] = calls[0] as [string];

      const parsedUrl = new URL(url);
      expect(parsedUrl.searchParams.has("api-key")).toBe(false);
    });
  });

  describe("retries retryable failures up to maxAttempts", () => {
    it("retries timeout errors up to maxAttempts", async () => {
      const mockHttp = createMockHttpClient({ shouldTimeout: true });
      const fakeRetry = new FakeRetry([0, 0]);

      const source = new HttpHeliusFlowSource({
        http: mockHttp,
        url: "https://api.helius.com",
        apiKey: "test-api-key",
        maxAttempts: 3,
        retryControl: fakeRetry
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          walletAddress: WATCHED_WALLET,
          fromUnixMs: FROM_UNIX_MS,
          toUnixMs: TO_UNIX_MS
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("timeout");
        expect(mockHttp.getJson).toHaveBeenCalledTimes(3);
      }
    });

    it("retries 429 rate limit errors up to maxAttempts", async () => {
      const mockHttp = createMockHttpClient({ httpStatus: 429 });
      const fakeRetry = new FakeRetry([0, 0]);

      const source = new HttpHeliusFlowSource({
        http: mockHttp,
        url: "https://api.helius.com",
        apiKey: "test-api-key",
        maxAttempts: 3,
        retryControl: fakeRetry
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          walletAddress: WATCHED_WALLET,
          fromUnixMs: FROM_UNIX_MS,
          toUnixMs: TO_UNIX_MS
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("unavailable");
        expect(mockHttp.getJson).toHaveBeenCalledTimes(3);
      }
    });

    it("retries 5xx server errors up to maxAttempts", async () => {
      const mockHttp = createMockHttpClient({ httpStatus: 500 });
      const fakeRetry = new FakeRetry([0, 0]);

      const source = new HttpHeliusFlowSource({
        http: mockHttp,
        url: "https://api.helius.com",
        apiKey: "test-api-key",
        maxAttempts: 3,
        retryControl: fakeRetry
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          walletAddress: WATCHED_WALLET,
          fromUnixMs: FROM_UNIX_MS,
          toUnixMs: TO_UNIX_MS
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("unavailable");
        expect(mockHttp.getJson).toHaveBeenCalledTimes(3);
      }
    });

    it("does not retry non-retryable 4xx errors", async () => {
      const mockHttp = createMockHttpClient({ httpStatus: 400 });

      const source = new HttpHeliusFlowSource({
        http: mockHttp,
        url: "https://api.helius.com",
        apiKey: "test-api-key",
        maxAttempts: 3
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          walletAddress: WATCHED_WALLET,
          fromUnixMs: FROM_UNIX_MS,
          toUnixMs: TO_UNIX_MS
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("network");
        expect(mockHttp.getJson).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe("redacts configured API keys from diagnostics", () => {
    it("redacts API key from timeout error diagnostic", async () => {
      const secretKey = "helius-super-secret-key-12345";
      const mockHttp = createMockHttpClient({ shouldTimeout: true });

      const source = new HttpHeliusFlowSource({
        http: mockHttp,
        url: "https://api.helius.com",
        apiKey: secretKey
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          walletAddress: WATCHED_WALLET,
          fromUnixMs: FROM_UNIX_MS,
          toUnixMs: TO_UNIX_MS
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("timeout");
        expect(error.diagnostic).not.toContain(secretKey);
      }
    });

    it("redacts API key from network error diagnostic", async () => {
      const secretKey = "helius-super-secret-key-12345";
      const mockHttp = createMockHttpClient({ networkError: true });

      const source = new HttpHeliusFlowSource({
        http: mockHttp,
        url: "https://api.helius.com",
        apiKey: secretKey
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          walletAddress: WATCHED_WALLET,
          fromUnixMs: FROM_UNIX_MS,
          toUnixMs: TO_UNIX_MS
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("network");
        expect(error.diagnostic).not.toContain(secretKey);
      }
    });

    it("redacts API key from 503 error diagnostic", async () => {
      const secretKey = "helius-super-secret-key-12345";
      const mockHttp = createMockHttpClient({ httpStatus: 503 });

      const source = new HttpHeliusFlowSource({
        http: mockHttp,
        url: "https://api.helius.com",
        apiKey: secretKey
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          walletAddress: WATCHED_WALLET,
          fromUnixMs: FROM_UNIX_MS,
          toUnixMs: TO_UNIX_MS
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("unavailable");
        expect(error.diagnostic).not.toContain(secretKey);
      }
    });
  });

  describe("pagination", () => {
    it("stops pagination when page has fewer results than limit", async () => {
      const tx = (heliusTransactionsFixture as HeliusRawTransaction[]).find(
        (t) => t.signature === "captured-inbound-signature"
      )!;

      const mockHttp = {
        getJson: vi.fn().mockResolvedValue([tx]),
        postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
      } as unknown as HttpClient;

      const source = new HttpHeliusFlowSource({
        http: mockHttp,
        url: "https://api.helius.com",
        apiKey: "test-api-key"
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        walletAddress: WATCHED_WALLET,
        fromUnixMs: FROM_UNIX_MS,
        toUnixMs: TO_UNIX_MS
      });

      expect(mockHttp.getJson).toHaveBeenCalledTimes(1);
      expect(result.events).toHaveLength(1);
    });

    it("stops pagination when oldest transaction is before fromUnixMs", async () => {
      const outOfWindowTx = (heliusTransactionsFixture as HeliusRawTransaction[]).find(
        (t) => t.signature === "out-of-window-signature"
      )!;

      const mockHttp = {
        getJson: vi.fn().mockResolvedValue([outOfWindowTx]),
        postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
      } as unknown as HttpClient;

      const source = new HttpHeliusFlowSource({
        http: mockHttp,
        url: "https://api.helius.com",
        apiKey: "test-api-key"
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        walletAddress: WATCHED_WALLET,
        fromUnixMs: FROM_UNIX_MS,
        toUnixMs: TO_UNIX_MS
      });

      expect(mockHttp.getJson).toHaveBeenCalledTimes(1);
      expect(result.events).toHaveLength(1);
    });

    it("throws on non-array API response", async () => {
      const mockHttp = {
        getJson: vi.fn().mockResolvedValue({ error: "not an array" }),
        postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
      } as unknown as HttpClient;

      const source = new HttpHeliusFlowSource({
        http: mockHttp,
        url: "https://api.helius.com",
        apiKey: "test-api-key"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          walletAddress: WATCHED_WALLET,
          fromUnixMs: FROM_UNIX_MS,
          toUnixMs: TO_UNIX_MS
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("malformed");
      }
    });
  });
});
