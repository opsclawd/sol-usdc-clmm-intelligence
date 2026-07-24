import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../../../src/ports/http.js";
import { HttpRequestError } from "../../../src/ports/http.js";
import { HttpBirdeyeFlowSource } from "../../../src/adapters/node/http-birdeye-flow-source.js";
import type {
  OnChainFlowSourceError,
  OnChainFlowSourceRequest
} from "../../../src/ports/on-chain-flow-source.js";
import { makeMalformedEnvelope } from "../../fixtures/on-chain-flow.js";
import { FakeRetry } from "../../fakes/fake-retry.js";

function createMockHttpClient(behavior: {
  shouldTimeout?: boolean;
  networkError?: boolean;
  httpStatus?: number;
  body?: unknown;
  invalidJson?: boolean;
}): HttpClient {
  return {
    getJson: vi.fn().mockImplementation(async (url: string): Promise<unknown> => {
      if (behavior.networkError) {
        throw new TypeError("network error");
      }

      if (behavior.shouldTimeout) {
        throw new DOMException(`Aborted: ${url}`, "AbortError");
      }

      if (behavior.httpStatus !== undefined && behavior.httpStatus >= 400) {
        throw new HttpRequestError(
          "http_status",
          `GET ${url} failed: ${behavior.httpStatus}`,
          behavior.httpStatus,
          behavior.httpStatus === 429 || behavior.httpStatus >= 500
        );
      }

      if (behavior.invalidJson) {
        throw new HttpRequestError("invalid_json", "Unexpected end of JSON input", null, false);
      }

      return behavior.body;
    }),
    postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
  } as unknown as HttpClient;
}

describe("HttpBirdeyeFlowSource", () => {
  describe("Birdeye adapter maps buy sell volumes and signed net flow for the requested window", () => {
    it("maps dex_net_flow event with buy, sell, and net flow values", async () => {
      const mockHttp = createMockHttpClient({
        body: {
          source: "birdeye-api",
          providerId: "birdeye-dex-api",
          providerRunId: "birdeye-run-001",
          asOfUnixMs: 1700000000000,
          license: "CC0-1.0",
          retention: "bounded",
          events: [
            {
              eventKind: "birdeye_net_flow",
              timestampUnixMs: 1700000000000,
              buyVolume: 50000000000,
              sellVolume: 30000000000,
              netFlow: 20000000000,
              sourceReferences: ["https://birdeye.xyz/token/SOL"],
              unknownField: "should be dropped"
            }
          ]
        }
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so/public/token_net_flow",
        apiKey: "birdeye-secret-key"
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        fromUnixMs: 1699999000000,
        toUnixMs: 1700000000000
      });

      expect(result.providerId).toBe("birdeye-dex-api");
      expect(result.source).toBe("birdeye-api");
      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toEqual({
        eventKind: "birdeye_net_flow",
        timestampUnixMs: 1700000000000,
        buyVolume: 50000000000,
        sellVolume: 30000000000,
        netFlow: 20000000000,
        sourceReferences: ["https://birdeye.xyz/token/SOL"]
      });
      expect((result.events[0] as unknown as Record<string, unknown>).unknownField).toBeUndefined();
    });

    it("rejects helius_transaction event kind as malformed", async () => {
      const mockHttp = createMockHttpClient({
        body: {
          source: "birdeye-api",
          providerId: "birdeye-dex-api",
          providerRunId: "birdeye-run-001",
          asOfUnixMs: 1700000000000,
          license: "CC0-1.0",
          retention: "bounded",
          events: [
            {
              eventKind: "helius_transaction",
              transactionHash: "txn_abc123",
              slot: 123456789,
              timestampUnixMs: 1700000000000,
              flowSide: "buy",
              nativeAmount: 1000000000,
              sourceReferences: ["https://helius.xyz/txn/txn_abc123"]
            }
          ]
        }
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so/public/token_net_flow",
        apiKey: "birdeye-secret-key"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1699999000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown malformed error");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("malformed");
      }
    });
  });

  describe("adapter rejects a malformed source envelope before application persistence", () => {
    it("throws malformed when providerId is missing", async () => {
      const mockHttp = createMockHttpClient({
        body: makeMalformedEnvelope({ providerId: undefined })
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so/public/token_net_flow",
        apiKey: "birdeye-secret-key"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1699999000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("malformed");
      }
    });

    it("throws malformed when providerRunId is missing", async () => {
      const mockHttp = createMockHttpClient({
        body: makeMalformedEnvelope({ providerRunId: undefined })
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so/public/token_net_flow",
        apiKey: "birdeye-secret-key"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1699999000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("malformed");
      }
    });

    it("throws malformed when asOfUnixMs is missing", async () => {
      const mockHttp = createMockHttpClient({
        body: makeMalformedEnvelope({ asOfUnixMs: undefined })
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so/public/token_net_flow",
        apiKey: "birdeye-secret-key"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1699999000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("malformed");
      }
    });

    it("throws malformed when license is missing", async () => {
      const mockHttp = createMockHttpClient({
        body: makeMalformedEnvelope({ license: undefined })
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so/public/token_net_flow",
        apiKey: "birdeye-secret-key"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1699999000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("malformed");
      }
    });

    it("throws malformed when events contain non-finite attribution quality", async () => {
      const mockHttp = createMockHttpClient({
        body: {
          source: "birdeye-api",
          providerId: "birdeye-dex-api",
          providerRunId: "birdeye-run-001",
          asOfUnixMs: 1700000000000,
          license: "CC0-1.0",
          retention: "bounded",
          events: [
            {
              eventKind: "birdeye_net_flow",
              timestampUnixMs: 1700000000000,
              buyVolume: Infinity,
              sellVolume: 30000000000,
              netFlow: 20000000000,
              sourceReferences: ["https://birdeye.xyz/token/SOL"]
            }
          ]
        }
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so/public/token_net_flow",
        apiKey: "birdeye-secret-key"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1699999000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("malformed");
      }
    });
  });

  describe("adapter retries retryable failures up to maxAttempts", () => {
    it("retries timeout errors up to maxAttempts", async () => {
      const mockHttp = createMockHttpClient({ shouldTimeout: true });
      const fakeRetry = new FakeRetry([0, 0]);

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so/public/token_net_flow",
        apiKey: "birdeye-secret-key",
        maxAttempts: 3,
        retryControl: fakeRetry
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1699999000000,
          toUnixMs: 1700000000000
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

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so/public/token_net_flow",
        apiKey: "birdeye-secret-key",
        maxAttempts: 3,
        retryControl: fakeRetry
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1699999000000,
          toUnixMs: 1700000000000
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

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so/public/token_net_flow",
        apiKey: "birdeye-secret-key",
        maxAttempts: 3,
        retryControl: fakeRetry
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1699999000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("unavailable");
        expect(mockHttp.getJson).toHaveBeenCalledTimes(3);
      }
    });

    it("does not retry invalid JSON errors", async () => {
      const mockHttp = createMockHttpClient({ invalidJson: true });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so/public/token_net_flow",
        apiKey: "birdeye-secret-key",
        maxAttempts: 3
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1699999000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("malformed");
        expect(mockHttp.getJson).toHaveBeenCalledTimes(1);
      }
    });

    it("does not retry non-retryable 4xx errors", async () => {
      const mockHttp = createMockHttpClient({ httpStatus: 400 });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so/public/token_net_flow",
        apiKey: "birdeye-secret-key",
        maxAttempts: 3
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1699999000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("network");
        expect(mockHttp.getJson).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe("adapter redacts configured API keys from diagnostics", () => {
    it("redacts API key from timeout error diagnostic", async () => {
      const secretKey = "birdeye-super-secret-key-12345";
      const mockHttp = createMockHttpClient({ shouldTimeout: true });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so/public/token_net_flow",
        apiKey: secretKey
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1699999000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("timeout");
        expect(error.diagnostic).not.toContain(secretKey);
      }
    });

    it("redacts API key from network error diagnostic", async () => {
      const secretKey = "birdeye-super-secret-key-12345";
      const mockHttp = createMockHttpClient({ networkError: true });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so/public/token_net_flow",
        apiKey: secretKey
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1699999000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("network");
        expect(error.diagnostic).not.toContain(secretKey);
      }
    });

    it("redacts API key from 503 error diagnostic", async () => {
      const secretKey = "birdeye-super-secret-key-12345";
      const mockHttp = createMockHttpClient({ httpStatus: 503 });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so/public/token_net_flow",
        apiKey: secretKey
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          fromUnixMs: 1699999000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("unavailable");
        expect(error.diagnostic).not.toContain(secretKey);
      }
    });
  });

  describe("adapter preserves an empty event list as a successful snapshot", () => {
    it("returns empty events as a valid successful snapshot", async () => {
      const mockHttp = createMockHttpClient({
        body: {
          source: "birdeye-api",
          providerId: "birdeye-dex-api",
          providerRunId: "birdeye-run-001",
          asOfUnixMs: 1700000000000,
          license: "CC0-1.0",
          retention: "bounded",
          events: []
        }
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so/public/token_net_flow",
        apiKey: "birdeye-secret-key"
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        fromUnixMs: 1699999000000,
        toUnixMs: 1700000000000
      });

      expect(result.events).toEqual([]);
      expect(result.providerId).toBe("birdeye-dex-api");
    });
  });

  describe("bounded-request-with-optional-auth", () => {
    it("appends fromUnixMs and toUnixMs as query parameters", async () => {
      const mockHttp = createMockHttpClient({
        body: {
          source: "birdeye-api",
          providerId: "birdeye-dex-api",
          providerRunId: "birdeye-run-001",
          asOfUnixMs: 1700000000000,
          license: "CC0-1.0",
          retention: "bounded",
          events: []
        }
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so/public/token_net_flow",
        apiKey: "birdeye-secret-key"
      });

      await source.collect({
        pair: "SOL/USDC",
        fromUnixMs: 1699999000000,
        toUnixMs: 1700000000000
      });

      expect(mockHttp.getJson).toHaveBeenCalledWith(
        "https://public-api.birdeye.so/public/token_net_flow?fromUnixMs=1699999000000&toUnixMs=1700000000000",
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-API-Key": "birdeye-secret-key"
          })
        })
      );
    });

    it("sends no X-API-Key header when apiKey is not provided", async () => {
      const mockHttp = createMockHttpClient({
        body: {
          source: "birdeye-api",
          providerId: "birdeye-dex-api",
          providerRunId: "birdeye-run-001",
          asOfUnixMs: 1700000000000,
          license: "CC0-1.0",
          retention: "bounded",
          events: []
        }
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so/public/token_net_flow"
      });

      await source.collect({
        pair: "SOL/USDC",
        fromUnixMs: 1699999000000,
        toUnixMs: 1700000000000
      });

      expect(mockHttp.getJson).toHaveBeenCalledWith(
        "https://public-api.birdeye.so/public/token_net_flow?fromUnixMs=1699999000000&toUnixMs=1700000000000",
        expect.objectContaining({
          headers: expect.not.objectContaining({
            "X-API-Key": expect.anything()
          })
        })
      );
    });

    it("rejects non-SOL/USDC pair", async () => {
      const mockHttp = createMockHttpClient({
        body: {
          source: "birdeye-api",
          providerId: "birdeye-dex-api",
          providerRunId: "birdeye-run-001",
          asOfUnixMs: 1700000000000,
          license: "CC0-1.0",
          retention: "bounded",
          events: []
        }
      });

      const source = new HttpBirdeyeFlowSource({
        http: mockHttp,
        url: "https://public-api.birdeye.so/public/token_net_flow",
        apiKey: "birdeye-secret-key"
      });

      try {
        await source.collect({ pair: "SOL/USDT" } as unknown as OnChainFlowSourceRequest);
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as OnChainFlowSourceError;
        expect(error.kind).toBe("malformed");
      }
    });
  });
});
