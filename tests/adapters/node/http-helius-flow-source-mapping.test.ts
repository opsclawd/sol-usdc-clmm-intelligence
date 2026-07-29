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
  describe("maps a captured inbound USDC transfer without using native lamports", () => {
    it("maps a captured inbound USDC transfer without using native lamports", async () => {
      const inboundTx = (heliusTransactionsFixture as HeliusRawTransaction[]).find(
        (t) => t.signature === "captured-inbound-signature"
      )!;

      const mockHttp = createMockHttpClient({
        body: [inboundTx]
      });

      const source = new HttpHeliusFlowSource({
        http: mockHttp,
        url: "https://api.helius.com/v0/addresses/{address}/transactions",
        apiKey: "test-api-key"
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        walletAddress: WATCHED_WALLET,
        fromUnixMs: FROM_UNIX_MS,
        toUnixMs: TO_UNIX_MS
      });

      expect(result.events).toHaveLength(1);
      const event = result.events[0]!;
      expect(event.eventKind).toBe("whale_transfer");
      expect((event as { amountUsdc: string }).amountUsdc).toBe("1250000.25");
      expect((event as { addressContext: { address: string } }).addressContext.address).toBe(
        WATCHED_WALLET
      );
      expect((event as { transactionSignature: string }).transactionSignature).toBe(
        "captured-inbound-signature"
      );
      expect((event as { direction: string }).direction).toBe("inbound");
      expect((event as { slot: number }).slot).toBe(24681012);
    });
  });

  describe("maps an outbound USDC transfer with deterministic per-transfer identity", () => {
    it("maps an outbound USDC transfer with deterministic per-transfer identity", async () => {
      const outboundTx = (heliusTransactionsFixture as HeliusRawTransaction[]).find(
        (t) => t.signature === "captured-outbound-signature"
      )!;

      const mockHttp = createMockHttpClient({
        body: [outboundTx]
      });

      const source = new HttpHeliusFlowSource({
        http: mockHttp,
        url: "https://api.helius.com/v0/addresses/{address}/transactions",
        apiKey: "test-api-key"
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        walletAddress: WATCHED_WALLET,
        fromUnixMs: FROM_UNIX_MS,
        toUnixMs: TO_UNIX_MS
      });

      expect(result.events).toHaveLength(1);
      const event = result.events[0]!;
      expect(event.eventKind).toBe("whale_transfer");
      expect((event as { direction: string }).direction).toBe("outbound");
      expect((event as { sourceEventId: string }).sourceEventId).toBe(
        "captured-outbound-signature:0"
      );
      expect((event as { transactionSignature: string }).transactionSignature).toBe(
        "captured-outbound-signature"
      );
      expect((event as { eventIndex: number }).eventIndex).toBe(0);
    });
  });

  describe("ignores non-transfer non-USDC unrelated and self-transfer records", () => {
    it("ignores non-transfer non-USDC unrelated and self-transfer records", async () => {
      const nonTransferTx = (heliusTransactionsFixture as HeliusRawTransaction[]).find(
        (t) => t.signature === "non-transfer-signature"
      )!;
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
        body: [nonTransferTx, nonUsdcTx, unrelatedTx, selfTransferTx]
      });

      const source = new HttpHeliusFlowSource({
        http: mockHttp,
        url: "https://api.helius.com/v0/addresses/{address}/transactions",
        apiKey: "test-api-key"
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        walletAddress: WATCHED_WALLET,
        fromUnixMs: FROM_UNIX_MS,
        toUnixMs: TO_UNIX_MS
      });

      expect(result.events).toHaveLength(0);
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
        url: "https://api.helius.com/v0/addresses/{address}/transactions",
        apiKey: "test-api-key"
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        walletAddress: WATCHED_WALLET,
        fromUnixMs: FROM_UNIX_MS,
        toUnixMs: TO_UNIX_MS
      });

      expect(result.events).toHaveLength(1);
      expect((result.events[0] as { transactionSignature: string }).transactionSignature).toBe(
        "captured-inbound-signature"
      );
    });
  });

  describe("calls the legacy address-history endpoint with bounded query parameters", () => {
    it("calls the legacy address-history endpoint with bounded query parameters", async () => {
      const mockHttp = createMockHttpClient({
        body: []
      });

      const source = new HttpHeliusFlowSource({
        http: mockHttp,
        url: "https://api.helius.com/v0/addresses/{address}/transactions",
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
        url: "https://api.helius.com/v0/addresses/{address}/transactions",
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
        url: "https://api.helius.com/v0/addresses/{address}/transactions",
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
        url: "https://api.helius.com/v0/addresses/{address}/transactions",
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
        url: "https://api.helius.com/v0/addresses/{address}/transactions",
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
        url: "https://api.helius.com/v0/addresses/{address}/transactions",
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
        url: "https://api.helius.com/v0/addresses/{address}/transactions",
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
        url: "https://api.helius.com/v0/addresses/{address}/transactions",
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
});
