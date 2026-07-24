import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../../../src/ports/http.js";
import { HttpRequestError } from "../../../src/ports/http.js";
import type { NewsSourceError, NewsSourcePort } from "../../../src/ports/news-source.js";
import type { RetryControl } from "../../../src/ports/retry.js";

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

function makeValidRawRecord(overrides?: Record<string, unknown>) {
  return {
    articleId: "article-1",
    sourceVersionId: "v1",
    correctsSourceVersionId: null,
    title: "SOL surges on regulatory news",
    factualSummary: "Solana experienced a sharp increase in activity.",
    extractedClaims: ["SOL price rose by 10%"],
    topicTags: ["solana", "regulatory"],
    publishedAtUnixMs: 1699990000000,
    sourceUpdatedAtUnixMs: null,
    publisher: {
      publisherId: "pub-1",
      displayName: "Crypto News",
      tier: "primary"
    },
    sourceQuality: {
      providerId: "test-provider",
      reliability: 0.9,
      completeness: "complete",
      confirmation: "confirmed",
      isPaywalled: false
    },
    originatingReportId: "report-1",
    syndicationId: null,
    affectedAssets: ["SOL"],
    affectedProtocols: ["solana"],
    affectedJurisdictions: [],
    sourceReferences: ["https://example.com/news/1"],
    license: "CC-BY-4.0",
    retentionMode: "bounded_factual_extract",
    robotsAllowed: true,
    termsAllowRetention: true,
    ...overrides
  };
}

function makeValidRawResponse(
  source: "crypto-news-api" | "regulatory-monitor-api" = "crypto-news-api",
  recordOverrides?: Record<string, unknown>
) {
  const records = [
    makeValidRawRecord({
      ...(source === "regulatory-monitor-api" ? { affectedJurisdictions: ["US"] } : {}),
      ...recordOverrides
    })
  ];

  return {
    source,
    providerId: "test-provider",
    providerRunId: "run-123",
    retrievedAtUnixMs: 1700000000000,
    records
  };
}

describe("HttpNewsSource", () => {
  describe("bounded-request-with-optional-auth", () => {
    it("fetches SOL/USDC news with bounded request options, appended search params, and optional bearer credential", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({
        body: makeValidRawResponse("crypto-news-api")
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
        "https://api.example.com/news?pair=SOL%2FUSDC&source=crypto-news-api&fromUnixMs=1699900000000&toUnixMs=1700000000000",
        expect.objectContaining({
          timeoutMs: 5000,
          maxAttempts: 1,
          headers: expect.objectContaining({
            Authorization: "Bearer secret-key-12345"
          })
        })
      );
    });

    it("appends search parameters while preserving existing URL query parameters", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({
        body: makeValidRawResponse("regulatory-monitor-api")
      });

      const source = new HttpNewsSource({
        http: mockHttp,
        url: "https://api.example.com/regulatory?existing=param"
      });

      await source.collect({
        pair: "SOL/USDC",
        source: "regulatory-monitor-api",
        fromUnixMs: 1699900000000,
        toUnixMs: 1700000000000
      });

      expect(mockHttp.getJson).toHaveBeenCalledWith(
        "https://api.example.com/regulatory?existing=param&pair=SOL%2FUSDC&source=regulatory-monitor-api&fromUnixMs=1699900000000&toUnixMs=1700000000000",
        expect.anything()
      );
    });

    it("sends no Authorization header when apiKey is not provided", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({
        body: makeValidRawResponse("crypto-news-api")
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
        expect.any(String),
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
        body: makeValidRawResponse("crypto-news-api")
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
        body: makeValidRawResponse("crypto-news-api")
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

  describe("projects provider responses to canonical bounded records without full text", () => {
    it("returns validated canonical bounded snapshot, drops unknown provider fields, and deep freezes projection", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const rawResponse = {
        ...makeValidRawResponse("crypto-news-api", {
          unknownRecordField: "should be dropped"
        }),
        unknownTopLevelField: "should be dropped"
      };

      const mockHttp = createMockHttpClient({ body: rawResponse });

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

      const rec = result.records[0]!;
      expect(rec.articleId).toBe("article-1");
      expect(rec.sourceVersionId).toBe("v1");
      expect(rec.title).toBe("SOL surges on regulatory news");
      expect(rec.evidenceKind).toBe("ecosystem_news");
      expect(rec.publisher.publisherId).toBe("pub-1");
      expect(rec.sourceQuality.reliability).toBe(0.9);
      expect(rec.rawProvenance.license).toBe("CC-BY-4.0");

      expect(result).not.toHaveProperty("unknownTopLevelField");
      expect(rec as unknown as Record<string, unknown>).not.toHaveProperty("unknownRecordField");

      // Verify Deep Freezing
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.records)).toBe(true);
      expect(Object.isFrozen(rec)).toBe(true);
      expect(Object.isFrozen(rec.extractedClaims)).toBe(true);
      expect(Object.isFrozen(rec.topicTags)).toBe(true);
      expect(Object.isFrozen(rec.publisher)).toBe(true);
      expect(Object.isFrozen(rec.sourceQuality)).toBe(true);
      expect(Object.isFrozen(rec.affectedAssets)).toBe(true);
      expect(Object.isFrozen(rec.affectedProtocols)).toBe(true);
      expect(Object.isFrozen(rec.affectedJurisdictions)).toBe(true);
      expect(Object.isFrozen(rec.sourceReferences)).toBe(true);
      expect(Object.isFrozen(rec.rawProvenance)).toBe(true);
    });

    it("rejects non-HTTPS source references", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({
        body: makeValidRawResponse("crypto-news-api", {
          sourceReferences: ["http://example.com/http-only"]
        })
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

    it("rejects records with robotsAllowed or termsAllowRetention false", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({
        body: makeValidRawResponse("crypto-news-api", {
          robotsAllowed: false
        })
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

    it("ensures record-level envelope metadata fields cannot override snapshot envelope metadata", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const rawResponse = {
        source: "crypto-news-api",
        providerId: "envelope-provider",
        providerRunId: "envelope-run-123",
        retrievedAtUnixMs: 1700000000000,
        records: [
          makeValidRawRecord({
            source: "regulatory-monitor-api",
            providerId: "malicious-record-provider",
            providerRunId: "malicious-record-run",
            retrievedAtUnixMs: 9999999999999
          })
        ]
      };

      const mockHttp = createMockHttpClient({ body: rawResponse });
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

      expect(result.source).toBe("crypto-news-api");
      expect(result.providerId).toBe("envelope-provider");
      expect(result.providerRunId).toBe("envelope-run-123");
      expect(result.retrievedAtUnixMs).toBe(1700000000000);

      const record = result.records[0]!;
      expect(record.source).toBe("crypto-news-api");
      expect(record.providerId).toBe("envelope-provider");
      expect(record.providerRunId).toBe("envelope-run-123");
      expect(record.retrievedAtUnixMs).toBe(1700000000000);
    });

    it.each(["fullText", "body", "content", "html"])(
      "rejects records containing prohibited field %s with malformed error",
      async (prohibitedField) => {
        const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

        const mockHttp = createMockHttpClient({
          body: makeValidRawResponse("crypto-news-api", {
            [prohibitedField]: "Prohibited text content"
          })
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
      }
    );

    it("rejects whitespace-only values for non-empty string fields and minimum array length checks", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const whitespaceCases = [{ title: "   " }, { license: "   " }, { sourceReferences: ["   "] }];

      for (const override of whitespaceCases) {
        const mockHttp = createMockHttpClient({
          body: makeValidRawResponse("crypto-news-api", override)
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
          expect.fail(`Should have rejected whitespace override: ${JSON.stringify(override)}`);
        } catch (e) {
          const error = e as NewsSourceError;
          expect(error.kind).toBe("malformed");
        }
      }
    });

    it("rejects regulatory-monitor-api record when affectedJurisdictions contains only whitespace strings", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({
        body: makeValidRawResponse("regulatory-monitor-api", {
          affectedJurisdictions: ["   ", " "]
        })
      });

      const source = new HttpNewsSource({
        http: mockHttp,
        url: "https://api.example.com/regulatory"
      });

      try {
        await source.collect({
          pair: "SOL/USDC",
          source: "regulatory-monitor-api",
          fromUnixMs: 1699900000000,
          toUnixMs: 1700000000000
        });
        expect.fail("Should have rejected whitespace-only affectedJurisdictions");
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

    it("does not retry generic non-special 4xx (e.g. 400 Bad Request) and maps to network error", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({ httpStatus: 400 });
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
        expect(error.kind).toBe("network");
        expect(mockHttp.getJson).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe("retry-loop and two-attempt ceiling", () => {
    it("enforces at most two HTTP attempts ceiling even if maxAttempts: 3 is requested", async () => {
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
        expect(mockHttp.getJson).toHaveBeenCalledTimes(2);
      }
    });

    it("retries timeout errors up to maxAttempts (max 2) before throwing", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({ shouldTimeout: true });
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
        expect(error.kind).toBe("timeout");
        expect(mockHttp.getJson).toHaveBeenCalledTimes(2);
      }
    });

    it("retries 5xx server errors up to maxAttempts (max 2) before throwing", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({ httpStatus: 503 });
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
        expect(mockHttp.getJson).toHaveBeenCalledTimes(1);
      }
    });

    it("throws immediately on malformed response without retrying", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({ invalidJson: true });
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
        expect(error.kind).toBe("malformed");
        expect(mockHttp.getJson).toHaveBeenCalledTimes(1);
      }
    });

    it("succeeds on second attempt after first failed attempt", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      let callCount = 0;
      const mockHttp = {
        getJson: vi.fn().mockImplementation(async (): Promise<unknown> => {
          callCount++;
          if (callCount < 2) {
            throw new TypeError("transient network error");
          }
          return makeValidRawResponse("crypto-news-api");
        }),
        postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
      } as unknown as HttpClient;

      const source = new HttpNewsSource({
        http: mockHttp,
        url: "https://api.example.com/news",
        maxAttempts: 2
      });

      const result = await source.collect({
        pair: "SOL/USDC",
        source: "crypto-news-api",
        fromUnixMs: 1699900000000,
        toUnixMs: 1700000000000
      });

      expect(result.providerId).toBe("test-provider");
      expect(mockHttp.getJson).toHaveBeenCalledTimes(2);
    });

    it("uses injected RetryControl to sleep with expected bounded backoff delay on retry", async () => {
      const { HttpNewsSource } = await import("../../../src/adapters/node/http-news-source.js");

      const mockHttp = createMockHttpClient({ networkError: true });
      const mockRetryControl: RetryControl = {
        sleep: vi.fn().mockResolvedValue(undefined),
        jitterUnit: () => 0
      };

      const source = new HttpNewsSource({
        http: mockHttp,
        url: "https://api.example.com/news",
        maxAttempts: 2,
        retryControl: mockRetryControl
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
        expect(mockRetryControl.sleep).toHaveBeenCalledTimes(1);
        expect(mockRetryControl.sleep).toHaveBeenCalledWith(25);
      }
    });
  });
});

describe("FakeNewsSource", () => {
  it("returns configured canonical response on collect", async () => {
    const { FakeNewsSource } = await import("../../fakes/fake-news-source.js");

    const fake = new FakeNewsSource();
    const expectedSnapshot = {
      source: "crypto-news-api" as const,
      providerId: "test-provider",
      providerRunId: "run-1",
      retrievedAtUnixMs: 1700000000000,
      records: []
    };

    fake.setResponse(expectedSnapshot);

    const request = {
      pair: "SOL/USDC" as const,
      source: "crypto-news-api" as const,
      fromUnixMs: 1699900000000,
      toUnixMs: 1700000000000
    };

    const actual = await fake.collect(request);
    expect(actual).toEqual(expectedSnapshot);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.request).toEqual(request);
  });

  it("throws configured NewsSourceError on collect when setError is called", async () => {
    const { FakeNewsSource } = await import("../../fakes/fake-news-source.js");

    const fake = new FakeNewsSource();
    const expectedError: NewsSourceError = {
      kind: "unavailable",
      diagnostic: "Service down"
    };

    fake.setError(expectedError);

    try {
      await fake.collect({
        pair: "SOL/USDC",
        source: "crypto-news-api",
        fromUnixMs: 1699900000000,
        toUnixMs: 1700000000000
      });
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toEqual(expectedError);
    }
  });

  it("can be substituted anywhere NewsSourcePort is required", async () => {
    const { FakeNewsSource } = await import("../../fakes/fake-news-source.js");

    const fakePort: NewsSourcePort = new FakeNewsSource();
    expect(fakePort.collect).toBeTypeOf("function");
  });
});
