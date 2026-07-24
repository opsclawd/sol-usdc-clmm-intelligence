import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../../../src/ports/http.js";
import { HttpRequestError } from "../../../src/ports/http.js";
import type { NewsSourceError } from "../../../src/ports/news-source.js";

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

describe("HttpNewsSource", () => {
  describe("bounded-request-with-optional-auth", () => {
    it("fetches SOL/USDC news with bounded request options and optional bearer credential", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({
        body: {
          source: "crypto-news-api",
          providerId: "test-provider",
          providerRunId: "run-123",
          retrievedAtUnixMs: 1700000000000,
          records: [
            {
              id: "news-1",
              headline: "SOL surges on regulatory news",
              publishedAtUnixMs: 1699990000000,
              source: "CryptoNews",
              url: "https://example.com/news/1",
              categories: ["regulatory", "solana"],
              license: "MIT",
              reference: "https://example.com/source",
              compliance: { isSponsored: false, isAffiliate: false }
            }
          ]
        }
      });

      const source = new HttpNewsSource({
        http: mockHttp,
        url: "https://api.example.com/news",
        apiKey: "secret-key-12345",
        timeoutMs: 5000,
        maxAttempts: 2
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        source: "crypto-news-api",
        fromUnixMs: 1699900000000,
        toUnixMs: 1700000000000
      });

      expect(result.providerId).toBe("test-provider");
      expect(result.source).toBe("crypto-news-api");
      expect(mockHttp.getJson).toHaveBeenCalledTimes(1);
      expect(mockHttp.getJson).toHaveBeenCalledWith(
        "https://api.example.com/news",
        expect.objectContaining({
          timeoutMs: 5000,
          maxAttempts: 1,
          headers: expect.objectContaining({
            Authorization: "Bearer secret-key-12345"
          })
        })
      );
    });

    it("sends no Authorization header when apiKey is not provided", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({
        body: {
          source: "crypto-news-api",
          providerId: "test-provider",
          providerRunId: "run-123",
          retrievedAtUnixMs: 1700000000000,
          records: []
        }
      });

      const source = new HttpNewsSource({
        http: mockHttp,
        url: "https://api.example.com/news",
        timeoutMs: 5000,
        maxAttempts: 2
      });

      await source.collect({
        pair: "SOL/USDC",
        source: "crypto-news-api",
        fromUnixMs: 1699900000000,
        toUnixMs: 1700000000000
      });

      expect(mockHttp.getJson).toHaveBeenCalledWith(
        "https://api.example.com/news",
        expect.objectContaining({
          headers: expect.not.objectContaining({
            Authorization: expect.anything()
          })
        })
      );
    });

    it("validates source in request matches configured source", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({
        body: {
          source: "crypto-news-api",
          providerId: "test-provider",
          providerRunId: "run-123",
          retrievedAtUnixMs: 1700000000000,
          records: []
        }
      });

      const source = new HttpNewsSource({
        http: mockHttp,
        url: "https://api.example.com/news",
        source: "crypto-news-api"
      });

      await source.collect({
        pair: "SOL/USDC",
        source: "crypto-news-api",
        fromUnixMs: 1699900000000,
        toUnixMs: 1700000000000
      });

      expect(mockHttp.getJson).toHaveBeenCalledTimes(1);
    });

    it("rejects mismatched source in request vs configured source", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({
        body: {
          source: "crypto-news-api",
          providerId: "test-provider",
          providerRunId: "run-123",
          retrievedAtUnixMs: 1700000000000,
          records: []
        }
      });

      const source = new HttpNewsSource({
        http: mockHttp,
        url: "https://api.example.com/news",
        source: "crypto-news-api"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          source: "regulatory-monitor-api",
          fromUnixMs: 1699900000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as NewsSourceError;
        expect(error.kind).toBe("malformed");
      }
    });
  });

  describe("projects provider responses to bounded records without full text", () => {
    it("returns only the validated bounded snapshot and never retains unknown provider fields", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({
        body: {
          source: "crypto-news-api",
          providerId: "test-provider",
          providerRunId: "run-123",
          retrievedAtUnixMs: 1700000000000,
          records: [
            {
              id: "news-1",
              headline: "SOL surges on regulatory news",
              publishedAtUnixMs: 1699990000000,
              source: "CryptoNews",
              url: "https://example.com/news/1",
              categories: ["regulatory", "solana"],
              license: "MIT",
              reference: "https://example.com/source",
              compliance: { isSponsored: false, isAffiliate: false },
              unknownField: "should be dropped",
              anotherUnknown: 12345
            }
          ],
          unknownTopLevelField: "should be dropped",
          unknownArray: [1, 2, 3]
        }
      });

      const source = new HttpNewsSource({
        http: mockHttp,
        url: "https://api.example.com/news"
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        source: "crypto-news-api",
        fromUnixMs: 1699900000000,
        toUnixMs: 1700000000000
      });

      expect(result.providerId).toBe("test-provider");
      expect(result.providerRunId).toBe("run-123");
      expect(result.source).toBe("crypto-news-api");
      expect(result.retrievedAtUnixMs).toBe(1700000000000);
      expect(result.records).toHaveLength(1);
      expect(result.records[0]).toEqual({
        id: "news-1",
        headline: "SOL surges on regulatory news",
        publishedAtUnixMs: 1699990000000,
        source: "CryptoNews",
        url: "https://example.com/news/1",
        categories: ["regulatory", "solana"],
        license: "MIT",
        reference: "https://example.com/source",
        compliance: { isSponsored: false, isAffiliate: false }
      });

      expect(result).not.toHaveProperty("unknownTopLevelField");
      expect(result.records[0] as unknown as Record<string, unknown>).not.toHaveProperty(
        "unknownField"
      );
      expect(result.records[0] as unknown as Record<string, unknown>).not.toHaveProperty(
        "anotherUnknown"
      );
    });

    it("rejects records missing required license or reference fields", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({
        body: {
          source: "crypto-news-api",
          providerId: "test-provider",
          providerRunId: "run-123",
          retrievedAtUnixMs: 1700000000000,
          records: [
            {
              id: "news-1",
              headline: "SOL surges",
              publishedAtUnixMs: 1699990000000,
              source: "CryptoNews"
            }
          ]
        }
      });

      const source = new HttpNewsSource({
        http: mockHttp,
        url: "https://api.example.com/news"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          source: "crypto-news-api",
          fromUnixMs: 1699900000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as NewsSourceError;
        expect(error.kind).toBe("malformed");
      }
    });

    it("rejects records missing compliance flags", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({
        body: {
          source: "crypto-news-api",
          providerId: "test-provider",
          providerRunId: "run-123",
          retrievedAtUnixMs: 1700000000000,
          records: [
            {
              id: "news-1",
              headline: "SOL surges",
              publishedAtUnixMs: 1699990000000,
              source: "CryptoNews",
              url: "https://example.com/news/1",
              categories: ["regulatory"]
            }
          ]
        }
      });

      const source = new HttpNewsSource({
        http: mockHttp,
        url: "https://api.example.com/news"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          source: "crypto-news-api",
          fromUnixMs: 1699900000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as NewsSourceError;
        expect(error.kind).toBe("malformed");
      }
    });

    it("rejects records containing prohibited full-text fields", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({
        body: {
          source: "crypto-news-api",
          providerId: "test-provider",
          providerRunId: "run-123",
          retrievedAtUnixMs: 1700000000000,
          records: [
            {
              id: "news-1",
              headline: "SOL surges on regulatory news",
              publishedAtUnixMs: 1699990000000,
              source: "CryptoNews",
              url: "https://example.com/news/1",
              categories: ["regulatory"],
              license: "MIT",
              reference: "https://example.com/source",
              compliance: { isSponsored: false, isAffiliate: false },
              fullText: "This should not be in the bounded projection",
              body: "This is the full article body that should be rejected"
            }
          ]
        }
      });

      const source = new HttpNewsSource({
        http: mockHttp,
        url: "https://api.example.com/news"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          source: "crypto-news-api",
          fromUnixMs: 1699900000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as NewsSourceError;
        expect(error.kind).toBe("malformed");
      }
    });
  });

  describe("safe-failure-classification", () => {
    it("retries transient failures but not malformed responses", async () => {
      const secretKey = "super-secret-api-key-12345";

      const timeoutHttp = createMockHttpClient({ shouldTimeout: true });
      const source1 = new (
        await import("../../../src/adapters/node/http-news-source.js")
      ).HttpNewsSource({
        http: timeoutHttp,
        url: "https://api.example.com/news",
        apiKey: secretKey
      });

      try {
        await source1.collect({
          pair: "SOL/USDC",
          source: "crypto-news-api",
          fromUnixMs: 1699900000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as NewsSourceError;
        expect(error.kind).toBe("timeout");
        expect(error.diagnostic).not.toContain(secretKey);
      }

      const networkHttp = createMockHttpClient({ networkError: true });
      const source2 = new (
        await import("../../../src/adapters/node/http-news-source.js")
      ).HttpNewsSource({
        http: networkHttp,
        url: "https://api.example.com/news",
        apiKey: secretKey
      });

      try {
        await source2.collect({
          pair: "SOL/USDC",
          source: "crypto-news-api",
          fromUnixMs: 1699900000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as NewsSourceError;
        expect(error.kind).toBe("network");
        expect(error.diagnostic).not.toContain(secretKey);
      }

      const notFoundHttp = createMockHttpClient({ httpStatus: 404 });
      const source3 = new (
        await import("../../../src/adapters/node/http-news-source.js")
      ).HttpNewsSource({
        http: notFoundHttp,
        url: "https://api.example.com/news",
        apiKey: secretKey
      });

      try {
        await source3.collect({
          pair: "SOL/USDC",
          source: "crypto-news-api",
          fromUnixMs: 1699900000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as NewsSourceError;
        expect(error.kind).toBe("unavailable");
        expect(error.diagnostic).not.toContain(secretKey);
      }

      const rateLimitHttp = createMockHttpClient({ httpStatus: 429 });
      const source4 = new (
        await import("../../../src/adapters/node/http-news-source.js")
      ).HttpNewsSource({
        http: rateLimitHttp,
        url: "https://api.example.com/news",
        apiKey: secretKey
      });

      try {
        await source4.collect({
          pair: "SOL/USDC",
          source: "crypto-news-api",
          fromUnixMs: 1699900000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as NewsSourceError;
        expect(error.kind).toBe("unavailable");
      }

      const serverErrorHttp = createMockHttpClient({ httpStatus: 500 });
      const source5 = new (
        await import("../../../src/adapters/node/http-news-source.js")
      ).HttpNewsSource({
        http: serverErrorHttp,
        url: "https://api.example.com/news",
        apiKey: secretKey
      });

      try {
        await source5.collect({
          pair: "SOL/USDC",
          source: "crypto-news-api",
          fromUnixMs: 1699900000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as NewsSourceError;
        expect(error.kind).toBe("unavailable");
      }

      const malformedHttp = createMockHttpClient({ invalidJson: true });
      const source6 = new (
        await import("../../../src/adapters/node/http-news-source.js")
      ).HttpNewsSource({
        http: malformedHttp,
        url: "https://api.example.com/news",
        apiKey: secretKey
      });

      try {
        await source6.collect({
          pair: "SOL/USDC",
          source: "crypto-news-api",
          fromUnixMs: 1699900000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as NewsSourceError;
        expect(error.kind).toBe("malformed");
      }

      const validationErrorHttp = createMockHttpClient({
        body: { providerId: 123, invalid: "structure" }
      });
      const source7 = new (
        await import("../../../src/adapters/node/http-news-source.js")
      ).HttpNewsSource({
        http: validationErrorHttp,
        url: "https://api.example.com/news",
        apiKey: secretKey
      });

      try {
        await source7.collect({
          pair: "SOL/USDC",
          source: "crypto-news-api",
          fromUnixMs: 1699900000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as NewsSourceError;
        expect(error.kind).toBe("malformed");
      }
    });

    it("maps HTTP 503 to unavailable kind", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({ httpStatus: 503 });
      const source = new HttpNewsSource({
        http: mockHttp,
        url: "https://api.example.com/news"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          source: "crypto-news-api",
          fromUnixMs: 1699900000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as NewsSourceError;
        expect(error.kind).toBe("unavailable");
      }
    });

    it("never exposes or persists auth headers in errors", async () => {
      const secretKey = "super-secret-api-key-12345";

      const mockHttp = createMockHttpClient({ networkError: true });
      const source = new (
        await import("../../../src/adapters/node/http-news-source.js")
      ).HttpNewsSource({
        http: mockHttp,
        url: "https://api.example.com/news",
        apiKey: secretKey
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          source: "crypto-news-api",
          fromUnixMs: 1699900000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as NewsSourceError;
        expect(error.kind).toBe("network");
        expect(error.diagnostic).not.toContain(secretKey);
        expect(error.diagnostic).not.toContain("Bearer");
      }
    });
  });

  describe("retry-loop", () => {
    it("retries transient network errors up to maxAttempts before throwing", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({ networkError: true });
      const source = new HttpNewsSource({
        http: mockHttp,
        url: "https://api.example.com/news",
        maxAttempts: 3
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          source: "crypto-news-api",
          fromUnixMs: 1699900000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as NewsSourceError;
        expect(error.kind).toBe("network");
        expect(mockHttp.getJson).toHaveBeenCalledTimes(3);
      }
    });

    it("retries timeout errors up to maxAttempts before throwing", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({ shouldTimeout: true });
      const source = new HttpNewsSource({
        http: mockHttp,
        url: "https://api.example.com/news",
        maxAttempts: 3
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          source: "crypto-news-api",
          fromUnixMs: 1699900000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as NewsSourceError;
        expect(error.kind).toBe("timeout");
        expect(mockHttp.getJson).toHaveBeenCalledTimes(3);
      }
    });

    it("retries 5xx server errors up to maxAttempts before throwing", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({ httpStatus: 503 });
      const source = new HttpNewsSource({
        http: mockHttp,
        url: "https://api.example.com/news",
        maxAttempts: 3
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          source: "crypto-news-api",
          fromUnixMs: 1699900000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as NewsSourceError;
        expect(error.kind).toBe("unavailable");
        expect(mockHttp.getJson).toHaveBeenCalledTimes(3);
      }
    });

    it("retries on 429 rate limit errors up to maxAttempts before throwing", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({ httpStatus: 429 });
      const source = new HttpNewsSource({
        http: mockHttp,
        url: "https://api.example.com/news",
        maxAttempts: 2
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          source: "crypto-news-api",
          fromUnixMs: 1699900000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as NewsSourceError;
        expect(error.kind).toBe("unavailable");
        expect(mockHttp.getJson).toHaveBeenCalledTimes(2);
      }
    });

    it("throws immediately on non-retryable 404 error without retrying", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({ httpStatus: 404 });
      const source = new HttpNewsSource({
        http: mockHttp,
        url: "https://api.example.com/news",
        maxAttempts: 3
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          source: "crypto-news-api",
          fromUnixMs: 1699900000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as NewsSourceError;
        expect(error.kind).toBe("unavailable");
        expect(mockHttp.getJson).toHaveBeenCalledTimes(1);
      }
    });

    it("throws immediately on non-retryable 4xx error without retrying", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({ httpStatus: 400 });
      const source = new HttpNewsSource({
        http: mockHttp,
        url: "https://api.example.com/news",
        maxAttempts: 3
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          source: "crypto-news-api",
          fromUnixMs: 1699900000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as NewsSourceError;
        expect(error.kind).toBe("network");
        expect(mockHttp.getJson).toHaveBeenCalledTimes(1);
      }
    });

    it("throws immediately on malformed response without retrying", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({ invalidJson: true });
      const source = new HttpNewsSource({
        http: mockHttp,
        url: "https://api.example.com/news",
        maxAttempts: 3
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          source: "crypto-news-api",
          fromUnixMs: 1699900000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as NewsSourceError;
        expect(error.kind).toBe("malformed");
        expect(mockHttp.getJson).toHaveBeenCalledTimes(1);
      }
    });

    it("succeeds on successful response after previous failed attempts", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      let callCount = 0;
      const mockHttp = {
        getJson: vi.fn().mockImplementation(async (): Promise<unknown> => {
          callCount++;
          if (callCount < 3) {
            throw new TypeError("transient network error");
          }
          return {
            source: "crypto-news-api",
            providerId: "test-provider",
            providerRunId: "run-123",
            retrievedAtUnixMs: 1700000000000,
            records: []
          };
        }),
        postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
      } as unknown as HttpClient;

      const source = new HttpNewsSource({
        http: mockHttp,
        url: "https://api.example.com/news",
        maxAttempts: 3
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        source: "crypto-news-api",
        fromUnixMs: 1699900000000,
        toUnixMs: 1700000000000
      });

      expect(result.providerId).toBe("test-provider");
      expect(mockHttp.getJson).toHaveBeenCalledTimes(3);
    });

    it("caps exponential backoff at 400ms plus jitter", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");
      const { FakeRetry } = await import("../../../tests/fakes/index.js");

      const fakeRetry = new FakeRetry([0, 0]);
      const mockHttp = createMockHttpClient({ networkError: true });
      const source = new HttpNewsSource({
        http: mockHttp,
        url: "https://api.example.com/news",
        maxAttempts: 2,
        retryControl: fakeRetry
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          source: "crypto-news-api",
          fromUnixMs: 1699900000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have thrown");
      } catch (e) {
        expect(mockHttp.getJson).toHaveBeenCalledTimes(2);
        expect(fakeRetry.delays).toHaveLength(1);
        expect(fakeRetry.delays[0]).toBeLessThanOrEqual(480);
      }
    });
  });
});

describe("FakeNewsSource", () => {
  it("returns configured response on collect", async () => {
    const { FakeNewsSource } = await import("../../../tests/fakes/fake-news-source.js");

    const fake = new FakeNewsSource();
    fake.setResponse({
      source: "crypto-news-api",
      providerId: "test-provider",
      providerRunId: "run-123",
      retrievedAtUnixMs: 1700000000000,
      records: []
    });

    const result = await fake.collect({
      pair: "SOL/USDC",
      source: "crypto-news-api",
      fromUnixMs: 1699900000000,
      toUnixMs: 1700000000000
    });

    expect(result.providerId).toBe("test-provider");
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.request.pair).toBe("SOL/USDC");
  });

  it("throws configured error on collect", async () => {
    const { FakeNewsSource } = await import("../../../tests/fakes/fake-news-source.js");

    const fake = new FakeNewsSource();
    fake.setError({ kind: "network", diagnostic: "test error" });

    try {
      await fake.collect({
        pair: "SOL/USDC",
        source: "crypto-news-api",
        fromUnixMs: 1699900000000,
        toUnixMs: 1700000000000
      });
      expect.fail("Should have thrown");
    } catch (e) {
      const error = e as NewsSourceError;
      expect(error.kind).toBe("network");
    }
  });
});

describe("NewsSourcePort interface", () => {
  it("can be used with a fake implementation for testing", async () => {
    const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");
    type NewsSourcePortType = import("../../../src/ports/news-source.js").NewsSourcePort;

    const mockHttp = createMockHttpClient({
      body: {
        source: "crypto-news-api",
        providerId: "test-provider",
        providerRunId: "run-123",
        retrievedAtUnixMs: 1700000000000,
        records: []
      }
    });

    const httpSource = new HttpNewsSource({
      http: mockHttp,
      url: "https://api.example.com/news"
    });

    const port: NewsSourcePortType = httpSource;

    const result = await port.collect({
      pair: "SOL/USDC",
      source: "crypto-news-api",
      fromUnixMs: 1699900000000,
      toUnixMs: 1700000000000
    });

    expect(result.providerId).toBe("test-provider");
  });

  it("can swap between HTTP and fake implementations", async () => {
    type NewsSourcePortType = import("../../../src/ports/news-source.js").NewsSourcePort;
    const { FakeNewsSource } = await import("../../../tests/fakes/fake-news-source.js");

    const fake = new FakeNewsSource();
    fake.setResponse({
      source: "regulatory-monitor-api",
      providerId: "regulatory-provider",
      providerRunId: "run-456",
      retrievedAtUnixMs: 1700000000000,
      records: []
    });

    const port: NewsSourcePortType = fake;

    const result = await port.collect({
      pair: "SOL/USDC",
      source: "regulatory-monitor-api",
      fromUnixMs: 1699900000000,
      toUnixMs: 1700000000000
    });

    expect(result.providerId).toBe("regulatory-provider");
    expect(result.source).toBe("regulatory-monitor-api");
  });
});
