import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../../../src/ports/http.js";
import { HttpRequestError } from "../../../src/ports/http.js";
import type {
  SupportResistanceSourcePort,
  SupportResistanceSourceError
} from "../../../src/ports/support-resistance-source.js";
import { HttpSupportResistanceSource } from "../../../src/adapters/node/http-support-resistance-source.js";

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

describe("HttpSupportResistanceSource", () => {
  describe("bounded-request-with-optional-auth", () => {
    it("fetches SOL/USDC claims with bounded request options and an optional bearer credential", async () => {
      const mockHttp = createMockHttpClient({
        body: {
          providerId: "test-provider",
          providerRunId: "run-123",
          pair: "SOL/USDC",
          asOfUnixMs: 1700000000000,
          claims: [
            {
              levelType: "point",
              levelUsdcPerSol: 100.5,
              evidenceSide: "SUPPORT",
              timeframe: "4h",
              sourceReferences: ["src1"]
            }
          ]
        }
      });

      const source = new HttpSupportResistanceSource({
        http: mockHttp,
        url: "https://api.example.com/sr",
        apiKey: "secret-key-12345",
        timeoutMs: 5000,
        maxAttempts: 2
      });

      const result = await source.collect({ pair: "SOL/USDC" });

      expect(result.providerId).toBe("test-provider");
      expect(result.pair).toBe("SOL/USDC");
      expect(mockHttp.getJson).toHaveBeenCalledTimes(1);
      expect(mockHttp.getJson).toHaveBeenCalledWith(
        "https://api.example.com/sr",
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
      const mockHttp = createMockHttpClient({
        body: {
          providerId: "test-provider",
          providerRunId: "run-123",
          pair: "SOL/USDC",
          asOfUnixMs: 1700000000000,
          claims: []
        }
      });

      const source = new HttpSupportResistanceSource({
        http: mockHttp,
        url: "https://api.example.com/sr",
        timeoutMs: 5000,
        maxAttempts: 2
      });

      await source.collect({ pair: "SOL/USDC" });

      expect(mockHttp.getJson).toHaveBeenCalledWith(
        "https://api.example.com/sr",
        expect.objectContaining({
          headers: expect.not.objectContaining({
            Authorization: expect.anything()
          })
        })
      );
    });
  });

  describe("validated-projection-only", () => {
    it("returns only the validated bounded snapshot and never retains unknown provider fields", async () => {
      const mockHttp = createMockHttpClient({
        body: {
          providerId: "test-provider",
          providerRunId: "run-123",
          pair: "SOL/USDC",
          asOfUnixMs: 1700000000000,
          claims: [
            {
              levelType: "point",
              levelUsdcPerSol: 100.5,
              evidenceSide: "SUPPORT",
              timeframe: "4h",
              sourceReferences: ["src1"],
              unknownField: "should be dropped",
              anotherUnknown: 12345
            }
          ],
          unknownTopLevelField: "should be dropped",
          unknownArray: [1, 2, 3]
        }
      });

      const source = new HttpSupportResistanceSource({
        http: mockHttp,
        url: "https://api.example.com/sr"
      });

      const result = await source.collect({ pair: "SOL/USDC" });

      expect(result).toEqual({
        providerId: "test-provider",
        providerRunId: "run-123",
        pair: "SOL/USDC",
        asOfUnixMs: 1700000000000,
        claims: [
          {
            levelType: "point",
            levelUsdcPerSol: 100.5,
            evidenceSide: "SUPPORT",
            timeframe: "4h",
            sourceReferences: ["src1"]
          }
        ]
      });

      expect(result).not.toHaveProperty("unknownTopLevelField");
      expect(result.claims[0] as unknown as Record<string, unknown>).not.toHaveProperty(
        "unknownField"
      );
      expect(result.claims[0] as unknown as Record<string, unknown>).not.toHaveProperty(
        "anotherUnknown"
      );
    });

    it("accepts zone-level claims with proper structure", async () => {
      const mockHttp = createMockHttpClient({
        body: {
          providerId: "test-provider",
          providerRunId: "run-123",
          pair: "SOL/USDC",
          asOfUnixMs: 1700000000000,
          claims: [
            {
              levelType: "zone",
              zoneLowerUsdcPerSol: 95.0,
              zoneUpperUsdcPerSol: 105.0,
              evidenceSide: "RESISTANCE",
              timeframe: "1d",
              sourceReferences: ["src1", "src2"]
            }
          ]
        }
      });

      const source = new HttpSupportResistanceSource({
        http: mockHttp,
        url: "https://api.example.com/sr"
      });

      const result = await source.collect({ pair: "SOL/USDC" });

      expect(result.claims[0]).toEqual({
        levelType: "zone",
        zoneLowerUsdcPerSol: 95.0,
        zoneUpperUsdcPerSol: 105.0,
        evidenceSide: "RESISTANCE",
        timeframe: "1d",
        sourceReferences: ["src1", "src2"]
      });
    });
  });

  describe("safe-failure-classification", () => {
    it("classifies timeout network http status and malformed payload failures without leaking credentials", async () => {
      const secretKey = "super-secret-api-key-12345";

      const timeoutHttp = createMockHttpClient({ shouldTimeout: true });
      const source1 = new HttpSupportResistanceSource({
        http: timeoutHttp,
        url: "https://api.example.com/sr",
        apiKey: secretKey
      });

      try {
        await source1.collect({ pair: "SOL/USDC" });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as SupportResistanceSourceError;
        expect(error.kind).toBe("timeout");
        expect(error.diagnostic).not.toContain(secretKey);
      }

      const networkHttp = createMockHttpClient({ networkError: true });
      const source2 = new HttpSupportResistanceSource({
        http: networkHttp,
        url: "https://api.example.com/sr",
        apiKey: secretKey
      });

      try {
        await source2.collect({ pair: "SOL/USDC" });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as SupportResistanceSourceError;
        expect(error.kind).toBe("network");
        expect(error.diagnostic).not.toContain(secretKey);
      }

      const notFoundHttp = createMockHttpClient({ httpStatus: 404 });
      const source3 = new HttpSupportResistanceSource({
        http: notFoundHttp,
        url: "https://api.example.com/sr",
        apiKey: secretKey
      });

      try {
        await source3.collect({ pair: "SOL/USDC" });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as SupportResistanceSourceError;
        expect(error.kind).toBe("unavailable");
        expect(error.diagnostic).not.toContain(secretKey);
      }

      const rateLimitHttp = createMockHttpClient({ httpStatus: 429 });
      const source4 = new HttpSupportResistanceSource({
        http: rateLimitHttp,
        url: "https://api.example.com/sr",
        apiKey: secretKey
      });

      try {
        await source4.collect({ pair: "SOL/USDC" });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as SupportResistanceSourceError;
        expect(error.kind).toBe("unavailable");
      }

      const serverErrorHttp = createMockHttpClient({ httpStatus: 500 });
      const source5 = new HttpSupportResistanceSource({
        http: serverErrorHttp,
        url: "https://api.example.com/sr",
        apiKey: secretKey
      });

      try {
        await source5.collect({ pair: "SOL/USDC" });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as SupportResistanceSourceError;
        expect(error.kind).toBe("unavailable");
      }

      const malformedHttp = createMockHttpClient({ invalidJson: true });
      const source6 = new HttpSupportResistanceSource({
        http: malformedHttp,
        url: "https://api.example.com/sr",
        apiKey: secretKey
      });

      try {
        await source6.collect({ pair: "SOL/USDC" });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as SupportResistanceSourceError;
        expect(error.kind).toBe("malformed");
      }

      const validationErrorHttp = createMockHttpClient({
        body: { providerId: 123, invalid: "structure" }
      });
      const source7 = new HttpSupportResistanceSource({
        http: validationErrorHttp,
        url: "https://api.example.com/sr",
        apiKey: secretKey
      });

      try {
        await source7.collect({ pair: "SOL/USDC" });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as SupportResistanceSourceError;
        expect(error.kind).toBe("malformed");
      }
    });

    it("maps HTTP 503 to unavailable kind", async () => {
      const mockHttp = createMockHttpClient({ httpStatus: 503 });
      const source = new HttpSupportResistanceSource({
        http: mockHttp,
        url: "https://api.example.com/sr"
      });

      try {
        await source.collect({ pair: "SOL/USDC" });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as SupportResistanceSourceError;
        expect(error.kind).toBe("unavailable");
      }
    });
  });
});

describe("retry-loop", () => {
  it("retries up to maxAttempts on transient network errors before throwing", async () => {
    const mockHttp = createMockHttpClient({ networkError: true });
    const source = new HttpSupportResistanceSource({
      http: mockHttp,
      url: "https://api.example.com/sr",
      maxAttempts: 3
    });

    try {
      await source.collect({ pair: "SOL/USDC" });
      expect.fail("Should have thrown");
    } catch (e) {
      const error = e as SupportResistanceSourceError;
      expect(error.kind).toBe("network");
      expect(mockHttp.getJson).toHaveBeenCalledTimes(3);
    }
  });

  it("retries up to maxAttempts on timeout errors before throwing", async () => {
    const mockHttp = createMockHttpClient({ shouldTimeout: true });
    const source = new HttpSupportResistanceSource({
      http: mockHttp,
      url: "https://api.example.com/sr",
      maxAttempts: 3
    });

    try {
      await source.collect({ pair: "SOL/USDC" });
      expect.fail("Should have thrown");
    } catch (e) {
      const error = e as SupportResistanceSourceError;
      expect(error.kind).toBe("timeout");
      expect(mockHttp.getJson).toHaveBeenCalledTimes(3);
    }
  });

  it("retries up to maxAttempts on 5xx server errors before throwing", async () => {
    const mockHttp = createMockHttpClient({ httpStatus: 503 });
    const source = new HttpSupportResistanceSource({
      http: mockHttp,
      url: "https://api.example.com/sr",
      maxAttempts: 3
    });

    try {
      await source.collect({ pair: "SOL/USDC" });
      expect.fail("Should have thrown");
    } catch (e) {
      const error = e as SupportResistanceSourceError;
      expect(error.kind).toBe("unavailable");
      expect(mockHttp.getJson).toHaveBeenCalledTimes(3);
    }
  });

  it("retries on 429 rate limit errors up to maxAttempts before throwing", async () => {
    const mockHttp = createMockHttpClient({ httpStatus: 429 });
    const source = new HttpSupportResistanceSource({
      http: mockHttp,
      url: "https://api.example.com/sr",
      maxAttempts: 2
    });

    try {
      await source.collect({ pair: "SOL/USDC" });
      expect.fail("Should have thrown");
    } catch (e) {
      const error = e as SupportResistanceSourceError;
      expect(error.kind).toBe("unavailable");
      expect(mockHttp.getJson).toHaveBeenCalledTimes(2);
    }
  });

  it("throws immediately on non-retryable 404 error without retrying", async () => {
    const mockHttp = createMockHttpClient({ httpStatus: 404 });
    const source = new HttpSupportResistanceSource({
      http: mockHttp,
      url: "https://api.example.com/sr",
      maxAttempts: 3
    });

    try {
      await source.collect({ pair: "SOL/USDC" });
      expect.fail("Should have thrown");
    } catch (e) {
      const error = e as SupportResistanceSourceError;
      expect(error.kind).toBe("unavailable");
      expect(mockHttp.getJson).toHaveBeenCalledTimes(1);
    }
  });

  it("succeeds on successful response after previous failed attempts", async () => {
    let callCount = 0;
    const mockHttp = {
      getJson: vi.fn().mockImplementation(async (): Promise<unknown> => {
        callCount++;
        if (callCount < 3) {
          throw new TypeError("transient network error");
        }
        return {
          providerId: "test-provider",
          providerRunId: "run-123",
          pair: "SOL/USDC",
          asOfUnixMs: 1700000000000,
          claims: []
        };
      }),
      postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
    } as unknown as HttpClient;

    const source = new HttpSupportResistanceSource({
      http: mockHttp,
      url: "https://api.example.com/sr",
      maxAttempts: 3
    });

    const result = await source.collect({ pair: "SOL/USDC" });
    expect(result.providerId).toBe("test-provider");
    expect(mockHttp.getJson).toHaveBeenCalledTimes(3);
  });
});

describe("SupportResistanceSourcePort interface", () => {
  it("can be used with a fake implementation for testing", async () => {
    const mockHttp = createMockHttpClient({
      body: {
        providerId: "test-provider",
        providerRunId: "run-123",
        pair: "SOL/USDC",
        asOfUnixMs: 1700000000000,
        claims: []
      }
    });

    const httpSource = new HttpSupportResistanceSource({
      http: mockHttp,
      url: "https://api.example.com/sr"
    });

    const port: SupportResistanceSourcePort = httpSource;

    const result = await port.collect({ pair: "SOL/USDC" });

    expect(result.providerId).toBe("test-provider");
  });
});
