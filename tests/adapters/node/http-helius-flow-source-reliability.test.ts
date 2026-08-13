import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../../../src/ports/http.js";
import { HttpRequestError } from "../../../src/ports/http.js";
import { HttpHeliusFlowSource } from "../../../src/adapters/node/http-helius-flow-source.js";
import type {
  OnChainFlowSourceError,
  OnChainFlowSourceEvent,
  HeliusDexNetFlowEvent
} from "../../../src/ports/on-chain-flow-source.js";
import { FakeRetry } from "../../fakes/fake-retry.js";

const WATCHED_WALLET = "Wallet123";
const CANONICAL_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const FROM_UNIX_MS = 1700000000000;
const TO_UNIX_MS = 1700000100000;
const SECRET_API_KEY = "helius-secret-api-key-999";

function createTx(sig: string, timestampSeconds: number) {
  return {
    signature: sig,
    slot: 24681012,
    timestamp: timestampSeconds,
    type: "TRANSFER",
    nativeTransfers: [],
    tokenTransfers: [
      {
        fromUserAccount: "SenderWallet",
        toUserAccount: WATCHED_WALLET,
        mint: CANONICAL_USDC_MINT,
        tokenAmount: 500
      }
    ]
  };
}

function heliusEvents(result: {
  events: readonly OnChainFlowSourceEvent[];
}): HeliusDexNetFlowEvent[] {
  return result.events.filter((e): e is HeliusDexNetFlowEvent => e.eventKind === "dex_net_flow");
}

describe("HttpHeliusFlowSource reliability", () => {
  it("pages back with a before cursor until the lookback is covered", async () => {
    const fromUnixSeconds = Math.floor(FROM_UNIX_MS / 1000);
    // Two saturated pages: the first stops short of the window, the second
    // reaches past it. A busy pool produces far more than one page per window,
    // so a single fetch cannot cover the lookback.
    const pageOne = Array.from({ length: 100 }, (_, i) =>
      createTx(`sig-p1-${i}`, fromUnixSeconds + 200 - i)
    );
    const pageTwo = Array.from({ length: 100 }, (_, i) =>
      createTx(`sig-p2-${i}`, fromUnixSeconds + 99 - i)
    );

    const urls: string[] = [];
    const mockHttp: HttpClient = {
      getJson: vi.fn().mockImplementation(async (url: string) => {
        urls.push(url);
        return urls.length === 1 ? pageOne : pageTwo;
      }),
      postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
    } as unknown as HttpClient;

    const source = new HttpHeliusFlowSource({
      http: mockHttp,
      url: "https://api.helius.com",
      apiKey: SECRET_API_KEY
    });

    const result = await source.collect({
      pair: "SOL/USDC",
      walletAddress: WATCHED_WALLET,
      fromUnixMs: FROM_UNIX_MS,
      toUnixMs: TO_UNIX_MS
    });

    expect(urls).toHaveLength(2);
    expect(urls[0]).not.toContain("before=");
    // The cursor must be the oldest signature of the previous page, or paging
    // would refetch the same page forever.
    expect(urls[1]).toContain("before=sig-p1-99");
    expect(result.events.length).toBeGreaterThan(0);
    expect(heliusEvents(result).every((e) => e.sourceQuality.completeness === "full")).toBe(true);
  });

  it("reports partial completeness instead of throwing when the page cap is reached", async () => {
    const fromUnixSeconds = Math.floor(FROM_UNIX_MS / 1000);
    // Every page stays newer than the window start, so the cap is what stops it.
    const mockHttp: HttpClient = {
      getJson: vi.fn().mockImplementation(async () => {
        const n = (mockHttp.getJson as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
        return Array.from({ length: 100 }, (_, i) =>
          createTx(`sig-cap-${n}-${i}`, fromUnixSeconds + 100000 - n * 100 - i)
        );
      }),
      postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
    } as unknown as HttpClient;

    const source = new HttpHeliusFlowSource({
      http: mockHttp,
      url: "https://api.helius.com",
      apiKey: SECRET_API_KEY
    });

    const result = await source.collect({
      pair: "SOL/USDC",
      walletAddress: WATCHED_WALLET,
      fromUnixMs: FROM_UNIX_MS,
      toUnixMs: TO_UNIX_MS
    });

    // A truncated view must not be presented as a complete one, and it must not
    // fail the collector the way the old saturated-page throw did.
    expect(heliusEvents(result).every((e) => e.sourceQuality.completeness === "partial")).toBe(
      true
    );
    expect((mockHttp.getJson as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(
      25
    );
  });

  it("labels dex_net_flow events with addressType contract", async () => {
    const tx = createTx("sig-pool-1", Math.floor(FROM_UNIX_MS / 1000) + 10);
    const mockHttp: HttpClient = {
      getJson: vi.fn().mockResolvedValue([tx]),
      postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
    } as unknown as HttpClient;

    const source = new HttpHeliusFlowSource({
      http: mockHttp,
      url: "https://api.helius.com",
      apiKey: SECRET_API_KEY
    });

    const pool = await source.collect({
      pair: "SOL/USDC",
      walletAddress: WATCHED_WALLET,
      addressType: "contract",
      fromUnixMs: FROM_UNIX_MS,
      toUnixMs: TO_UNIX_MS
    });
    expect(heliusEvents(pool)[0]?.addressContext.addressType).toBe("contract");
  });

  it("accepts a saturated page after it reaches the requested lookback", async () => {
    const fromUnixSeconds = Math.floor(FROM_UNIX_MS / 1000);
    // 100 items, oldest timestamp equals fromUnixSeconds
    const coveredPage = Array.from({ length: 100 }, (_, i) =>
      createTx(`sig-cov-${i}`, fromUnixSeconds + 99 - i)
    );
    // index 99 timestamp is (fromUnixSeconds + 99 - 99) = fromUnixSeconds

    const mockHttp: HttpClient = {
      getJson: vi.fn().mockResolvedValue(coveredPage),
      postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
    } as unknown as HttpClient;

    const source = new HttpHeliusFlowSource({
      http: mockHttp,
      url: "https://api.helius.com",
      apiKey: SECRET_API_KEY
    });

    const result = await source.collect({
      pair: "SOL/USDC",
      walletAddress: WATCHED_WALLET,
      fromUnixMs: FROM_UNIX_MS,
      toUnixMs: TO_UNIX_MS
    });

    expect(result.source).toBe("helius-api");
    expect(result.events.length).toBeGreaterThan(0);
  });

  it("retries retryable failures and returns the first successful snapshot", async () => {
    const validTxs = [createTx("sig-success-1", Math.floor(FROM_UNIX_MS / 1000) + 10)];
    const fakeRetry = new FakeRetry([0, 0]);

    let calls = 0;
    const mockHttp: HttpClient = {
      getJson: vi.fn().mockImplementation(async () => {
        calls++;
        if (calls === 1) {
          throw new DOMException(
            `Aborted request to https://api.helius.com?api-key=${SECRET_API_KEY}`,
            "AbortError"
          );
        }
        if (calls === 2) {
          throw new HttpRequestError(
            "http_status",
            `GET https://api.helius.com?api-key=${SECRET_API_KEY} failed: 429`,
            429,
            true
          );
        }
        return validTxs;
      }),
      postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
    } as unknown as HttpClient;

    const source = new HttpHeliusFlowSource({
      http: mockHttp,
      url: "https://api.helius.com",
      apiKey: SECRET_API_KEY,
      maxAttempts: 3,
      retryControl: fakeRetry
    });

    const result = await source.collect({
      pair: "SOL/USDC",
      walletAddress: WATCHED_WALLET,
      fromUnixMs: FROM_UNIX_MS,
      toUnixMs: TO_UNIX_MS
    });

    expect(mockHttp.getJson).toHaveBeenCalledTimes(3);
    expect(fakeRetry.delays).toHaveLength(2);
    expect(result.events).toHaveLength(1);
  });

  it("does not retry malformed responses or non-retryable client failures", async () => {
    const fakeRetry = new FakeRetry([0, 0]);

    // Case 1: Malformed JSON response
    const mockHttpMalformed: HttpClient = {
      getJson: vi.fn().mockResolvedValue({ notAnArray: true }),
      postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
    } as unknown as HttpClient;

    const sourceMalformed = new HttpHeliusFlowSource({
      http: mockHttpMalformed,
      url: "https://api.helius.com",
      apiKey: SECRET_API_KEY,
      maxAttempts: 3,
      retryControl: fakeRetry
    });

    try {
      await sourceMalformed.collect({
        pair: "SOL/USDC",
        walletAddress: WATCHED_WALLET,
        fromUnixMs: FROM_UNIX_MS,
        toUnixMs: TO_UNIX_MS
      });
      expect.fail("Should have thrown malformed error");
    } catch (e) {
      const error = e as OnChainFlowSourceError;
      expect(error.kind).toBe("malformed");
      expect(mockHttpMalformed.getJson).toHaveBeenCalledTimes(1);
    }

    // Case 2: Non-retryable client failure (e.g. 400 Bad Request)
    const mockHttp400: HttpClient = {
      getJson: vi
        .fn()
        .mockRejectedValue(
          new HttpRequestError(
            "http_status",
            `GET https://api.helius.com?api-key=${SECRET_API_KEY} failed: 400`,
            400,
            false
          )
        ),
      postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
    } as unknown as HttpClient;

    const source400 = new HttpHeliusFlowSource({
      http: mockHttp400,
      url: "https://api.helius.com",
      apiKey: SECRET_API_KEY,
      maxAttempts: 3,
      retryControl: fakeRetry
    });

    try {
      await source400.collect({
        pair: "SOL/USDC",
        walletAddress: WATCHED_WALLET,
        fromUnixMs: FROM_UNIX_MS,
        toUnixMs: TO_UNIX_MS
      });
      expect.fail("Should have thrown network error");
    } catch (e) {
      const error = e as OnChainFlowSourceError;
      expect(error.kind).toBe("network");
      expect(mockHttp400.getJson).toHaveBeenCalledTimes(1);
    }
  });

  it("maps exhausted retry states to typed source errors", async () => {
    const fakeRetry = new FakeRetry([0, 0]);

    // Timeout exhaustion -> timeout
    const mockHttpTimeout: HttpClient = {
      getJson: vi.fn().mockRejectedValue(new DOMException("Timeout", "AbortError")),
      postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
    } as unknown as HttpClient;

    const sourceTimeout = new HttpHeliusFlowSource({
      http: mockHttpTimeout,
      url: "https://api.helius.com",
      maxAttempts: 3,
      retryControl: fakeRetry
    });

    try {
      await sourceTimeout.collect({
        pair: "SOL/USDC",
        walletAddress: WATCHED_WALLET,
        fromUnixMs: FROM_UNIX_MS,
        toUnixMs: TO_UNIX_MS
      });
      expect.fail("Should have thrown timeout error");
    } catch (e) {
      const error = e as OnChainFlowSourceError;
      expect(error.kind).toBe("timeout");
      expect(mockHttpTimeout.getJson).toHaveBeenCalledTimes(3);
    }

    // Rate-limit 429 exhaustion -> unavailable
    const mockHttp429: HttpClient = {
      getJson: vi
        .fn()
        .mockRejectedValue(new HttpRequestError("http_status", "429 Rate Limit", 429, true)),
      postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
    } as unknown as HttpClient;

    const source429 = new HttpHeliusFlowSource({
      http: mockHttp429,
      url: "https://api.helius.com",
      maxAttempts: 3,
      retryControl: fakeRetry
    });

    try {
      await source429.collect({
        pair: "SOL/USDC",
        walletAddress: WATCHED_WALLET,
        fromUnixMs: FROM_UNIX_MS,
        toUnixMs: TO_UNIX_MS
      });
      expect.fail("Should have thrown unavailable error");
    } catch (e) {
      const error = e as OnChainFlowSourceError;
      expect(error.kind).toBe("unavailable");
      expect(mockHttp429.getJson).toHaveBeenCalledTimes(3);
    }

    // 503 Server error exhaustion -> unavailable
    const mockHttp503: HttpClient = {
      getJson: vi
        .fn()
        .mockRejectedValue(
          new HttpRequestError("http_status", "503 Service Unavailable", 503, true)
        ),
      postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
    } as unknown as HttpClient;

    const source503 = new HttpHeliusFlowSource({
      http: mockHttp503,
      url: "https://api.helius.com",
      maxAttempts: 3,
      retryControl: fakeRetry
    });

    try {
      await source503.collect({
        pair: "SOL/USDC",
        walletAddress: WATCHED_WALLET,
        fromUnixMs: FROM_UNIX_MS,
        toUnixMs: TO_UNIX_MS
      });
      expect.fail("Should have thrown unavailable error");
    } catch (e) {
      const error = e as OnChainFlowSourceError;
      expect(error.kind).toBe("unavailable");
      expect(mockHttp503.getJson).toHaveBeenCalledTimes(3);
    }
  });

  it("redacts the query API key from every failure diagnostic", async () => {
    const mockHttp: HttpClient = {
      getJson: vi
        .fn()
        .mockRejectedValue(
          new HttpRequestError(
            "http_status",
            `GET https://api.helius.com/v0/addresses/W/transactions?api-key=${SECRET_API_KEY}&limit=100 failed: 500`,
            500,
            true
          )
        ),
      postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
    } as unknown as HttpClient;

    const source = new HttpHeliusFlowSource({
      http: mockHttp,
      url: "https://api.helius.com",
      apiKey: SECRET_API_KEY,
      maxAttempts: 1
    });

    try {
      await source.collect({
        pair: "SOL/USDC",
        walletAddress: WATCHED_WALLET,
        fromUnixMs: FROM_UNIX_MS,
        toUnixMs: TO_UNIX_MS
      });
      expect.fail("Should have thrown unavailable error");
    } catch (e) {
      const error = e as OnChainFlowSourceError;
      expect(error.kind).toBe("unavailable");
      expect(error.diagnostic).not.toContain(SECRET_API_KEY);
      expect(error.diagnostic).toContain("[REDACTED]");
    }
  });
});
