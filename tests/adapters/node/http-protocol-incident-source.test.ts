import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../../../src/ports/http.js";
import { HttpRequestError } from "../../../src/ports/http.js";
import type {
  ProtocolIncidentSourcePort,
  ProtocolIncidentSourceError
} from "../../../src/ports/protocol-incident-source.js";
import { HttpProtocolIncidentSource } from "../../../src/adapters/node/http-protocol-incident-source.js";

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

describe("HttpProtocolIncidentSource", () => {
  describe("solana-mainnet-request", () => {
    it("fetches protocol incidents for solana-mainnet with optional bearer credential", async () => {
      const mockHttp = createMockHttpClient({
        body: {
          providerId: "test-provider",
          providerRunId: "run-123",
          sourceId: "protocol-incidents-1",
          asOfUnixMs: 1700000000000,
          license: "CC0-1.0",
          retention: "bounded",
          confirmationLevel: "explicit",
          incidents: [
            {
              incidentId: "inc-1",
              incidentType: "downtime",
              severity: "high",
              sourceReferences: ["src1"]
            }
          ]
        }
      });

      const source = new HttpProtocolIncidentSource({
        http: mockHttp,
        url: "https://api.example.com/incidents",
        apiKey: "secret-key-12345",
        timeoutMs: 5000,
        maxAttempts: 2
      });

      const result = await source.collect({ network: "solana-mainnet" });

      expect(result.providerId).toBe("test-provider");
      expect(result.network).toBe("solana-mainnet");
      expect(mockHttp.getJson).toHaveBeenCalledTimes(1);
      expect(mockHttp.getJson).toHaveBeenCalledWith(
        "https://api.example.com/incidents",
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
          sourceId: "protocol-incidents-1",
          asOfUnixMs: 1700000000000,
          license: "CC0-1.0",
          retention: "bounded",
          confirmationLevel: "explicit",
          incidents: []
        }
      });

      const source = new HttpProtocolIncidentSource({
        http: mockHttp,
        url: "https://api.example.com/incidents",
        timeoutMs: 5000,
        maxAttempts: 2
      });

      await source.collect({ network: "solana-mainnet" });

      expect(mockHttp.getJson).toHaveBeenCalledWith(
        "https://api.example.com/incidents",
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
          sourceId: "protocol-incidents-1",
          asOfUnixMs: 1700000000000,
          license: "CC0-1.0",
          retention: "bounded",
          confirmationLevel: "explicit",
          incidents: [
            {
              incidentId: "inc-1",
              incidentType: "downtime",
              severity: "high",
              sourceReferences: ["src1"],
              unknownField: "should be dropped",
              anotherUnknown: 12345
            }
          ],
          unknownTopLevelField: "should be dropped",
          unknownArray: [1, 2, 3]
        }
      });

      const source = new HttpProtocolIncidentSource({
        http: mockHttp,
        url: "https://api.example.com/incidents"
      });

      const result = await source.collect({ network: "solana-mainnet" });

      expect(result).toEqual({
        providerId: "test-provider",
        providerRunId: "run-123",
        sourceId: "protocol-incidents-1",
        network: "solana-mainnet",
        asOfUnixMs: 1700000000000,
        license: "CC0-1.0",
        retention: "bounded",
        confirmationLevel: "explicit",
        incidents: [
          {
            incidentId: "inc-1",
            incidentType: "downtime",
            severity: "high",
            sourceReferences: ["src1"]
          }
        ]
      });

      expect(result).not.toHaveProperty("unknownTopLevelField");
      expect(result.incidents[0] as unknown as Record<string, unknown>).not.toHaveProperty(
        "unknownField"
      );
      expect(result.incidents[0] as unknown as Record<string, unknown>).not.toHaveProperty(
        "anotherUnknown"
      );
    });
  });

  describe("safe-failure-classification", () => {
    it("classifies timeout network http status and malformed payload failures without leaking credentials", async () => {
      const secretKey = "super-secret-api-key-12345";

      const timeoutHttp = createMockHttpClient({ shouldTimeout: true });
      const source1 = new HttpProtocolIncidentSource({
        http: timeoutHttp,
        url: "https://api.example.com/incidents",
        apiKey: secretKey
      });

      try {
        await source1.collect({ network: "solana-mainnet" });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as ProtocolIncidentSourceError;
        expect(error.kind).toBe("timeout");
        expect(error.diagnostic).not.toContain(secretKey);
      }

      const networkHttp = createMockHttpClient({ networkError: true });
      const source2 = new HttpProtocolIncidentSource({
        http: networkHttp,
        url: "https://api.example.com/incidents",
        apiKey: secretKey
      });

      try {
        await source2.collect({ network: "solana-mainnet" });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as ProtocolIncidentSourceError;
        expect(error.kind).toBe("network");
        expect(error.diagnostic).not.toContain(secretKey);
      }

      const notFoundHttp = createMockHttpClient({ httpStatus: 404 });
      const source3 = new HttpProtocolIncidentSource({
        http: notFoundHttp,
        url: "https://api.example.com/incidents",
        apiKey: secretKey
      });

      try {
        await source3.collect({ network: "solana-mainnet" });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as ProtocolIncidentSourceError;
        expect(error.kind).toBe("unavailable");
        expect(error.diagnostic).not.toContain(secretKey);
      }

      const rateLimitHttp = createMockHttpClient({ httpStatus: 429 });
      const source4 = new HttpProtocolIncidentSource({
        http: rateLimitHttp,
        url: "https://api.example.com/incidents",
        apiKey: secretKey
      });

      try {
        await source4.collect({ network: "solana-mainnet" });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as ProtocolIncidentSourceError;
        expect(error.kind).toBe("unavailable");
      }

      const serverErrorHttp = createMockHttpClient({ httpStatus: 500 });
      const source5 = new HttpProtocolIncidentSource({
        http: serverErrorHttp,
        url: "https://api.example.com/incidents",
        apiKey: secretKey
      });

      try {
        await source5.collect({ network: "solana-mainnet" });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as ProtocolIncidentSourceError;
        expect(error.kind).toBe("unavailable");
      }

      const malformedHttp = createMockHttpClient({ invalidJson: true });
      const source6 = new HttpProtocolIncidentSource({
        http: malformedHttp,
        url: "https://api.example.com/incidents",
        apiKey: secretKey
      });

      try {
        await source6.collect({ network: "solana-mainnet" });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as ProtocolIncidentSourceError;
        expect(error.kind).toBe("malformed");
      }

      const validationErrorHttp = createMockHttpClient({
        body: { providerId: 123, invalid: "structure" }
      });
      const source7 = new HttpProtocolIncidentSource({
        http: validationErrorHttp,
        url: "https://api.example.com/incidents",
        apiKey: secretKey
      });

      try {
        await source7.collect({ network: "solana-mainnet" });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as ProtocolIncidentSourceError;
        expect(error.kind).toBe("malformed");
      }
    });
  });

  describe("bounded-retention", () => {
    it("rejects source snapshots without bounded retention permission", async () => {
      const mockHttp = createMockHttpClient({
        body: {
          providerId: "test-provider",
          providerRunId: "run-123",
          sourceId: "protocol-incidents-1",
          asOfUnixMs: 1700000000000,
          license: "CC0-1.0",
          retention: "unbounded",
          confirmationLevel: "explicit",
          incidents: []
        }
      });

      const source = new HttpProtocolIncidentSource({
        http: mockHttp,
        url: "https://api.example.com/incidents"
      });

      try {
        await source.collect({ network: "solana-mainnet" });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as ProtocolIncidentSourceError;
        expect(error.kind).toBe("malformed");
        expect(error.diagnostic).toContain("bounded");
      }
    });

    it("rejects source snapshots without a license", async () => {
      const mockHttp = createMockHttpClient({
        body: {
          providerId: "test-provider",
          providerRunId: "run-123",
          sourceId: "protocol-incidents-1",
          asOfUnixMs: 1700000000000,
          license: "",
          retention: "bounded",
          confirmationLevel: "explicit",
          incidents: []
        }
      });

      const source = new HttpProtocolIncidentSource({
        http: mockHttp,
        url: "https://api.example.com/incidents"
      });

      try {
        await source.collect({ network: "solana-mainnet" });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as ProtocolIncidentSourceError;
        expect(error.kind).toBe("malformed");
        expect(error.diagnostic).toContain("license");
      }
    });
  });
});

describe("retry-loop", () => {
  it("retries a retryable source failure once without nested HTTP retries", async () => {
    let callCount = 0;
    const mockHttp = {
      getJson: vi.fn().mockImplementation(async (): Promise<unknown> => {
        callCount++;
        if (callCount === 1) {
          throw new TypeError("transient network error");
        }
        return {
          providerId: "test-provider",
          providerRunId: "run-123",
          sourceId: "protocol-incidents-1",
          asOfUnixMs: 1700000000000,
          license: "CC0-1.0",
          retention: "bounded",
          confirmationLevel: "explicit",
          incidents: []
        };
      }),
      postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
    } as unknown as HttpClient;

    const source = new HttpProtocolIncidentSource({
      http: mockHttp,
      url: "https://api.example.com/incidents",
      maxAttempts: 2
    });

    const result = await source.collect({ network: "solana-mainnet" });

    expect(result.providerId).toBe("test-provider");
    expect(mockHttp.getJson).toHaveBeenCalledTimes(2);
    expect(mockHttp.getJson).toHaveBeenCalledWith(
      "https://api.example.com/incidents",
      expect.objectContaining({
        maxAttempts: 1
      })
    );
  });

  it("does not retry malformed or non-retryable responses", async () => {
    const malformedHttp = createMockHttpClient({
      body: { providerId: 123, invalid: "structure" }
    });
    const source1 = new HttpProtocolIncidentSource({
      http: malformedHttp,
      url: "https://api.example.com/incidents",
      maxAttempts: 3
    });

    try {
      await source1.collect({ network: "solana-mainnet" });
      expect.fail("Should have thrown");
    } catch (e) {
      const error = e as ProtocolIncidentSourceError;
      expect(error.kind).toBe("malformed");
      expect(malformedHttp.getJson).toHaveBeenCalledTimes(1);
    }

    const notFoundHttp = createMockHttpClient({ httpStatus: 404 });
    const source2 = new HttpProtocolIncidentSource({
      http: notFoundHttp,
      url: "https://api.example.com/incidents",
      maxAttempts: 3
    });

    try {
      await source2.collect({ network: "solana-mainnet" });
      expect.fail("Should have thrown");
    } catch (e) {
      const error = e as ProtocolIncidentSourceError;
      expect(error.kind).toBe("unavailable");
      expect(notFoundHttp.getJson).toHaveBeenCalledTimes(1);
    }
  });

  it("retries up to maxAttempts on transient network errors before throwing", async () => {
    const mockHttp = createMockHttpClient({ networkError: true });
    const source = new HttpProtocolIncidentSource({
      http: mockHttp,
      url: "https://api.example.com/incidents",
      maxAttempts: 3
    });

    try {
      await source.collect({ network: "solana-mainnet" });
      expect.fail("Should have thrown");
    } catch (e) {
      const error = e as ProtocolIncidentSourceError;
      expect(error.kind).toBe("network");
      expect(mockHttp.getJson).toHaveBeenCalledTimes(3);
    }
  });

  it("retries up to maxAttempts on timeout errors before throwing", async () => {
    const mockHttp = createMockHttpClient({ shouldTimeout: true });
    const source = new HttpProtocolIncidentSource({
      http: mockHttp,
      url: "https://api.example.com/incidents",
      maxAttempts: 3
    });

    try {
      await source.collect({ network: "solana-mainnet" });
      expect.fail("Should have thrown");
    } catch (e) {
      const error = e as ProtocolIncidentSourceError;
      expect(error.kind).toBe("timeout");
      expect(mockHttp.getJson).toHaveBeenCalledTimes(3);
    }
  });

  it("retries up to maxAttempts on 5xx server errors before throwing", async () => {
    const mockHttp = createMockHttpClient({ httpStatus: 503 });
    const source = new HttpProtocolIncidentSource({
      http: mockHttp,
      url: "https://api.example.com/incidents",
      maxAttempts: 3
    });

    try {
      await source.collect({ network: "solana-mainnet" });
      expect.fail("Should have thrown");
    } catch (e) {
      const error = e as ProtocolIncidentSourceError;
      expect(error.kind).toBe("unavailable");
      expect(mockHttp.getJson).toHaveBeenCalledTimes(3);
    }
  });

  it("retries on 429 rate limit errors up to maxAttempts before throwing", async () => {
    const mockHttp = createMockHttpClient({ httpStatus: 429 });
    const source = new HttpProtocolIncidentSource({
      http: mockHttp,
      url: "https://api.example.com/incidents",
      maxAttempts: 2
    });

    try {
      await source.collect({ network: "solana-mainnet" });
      expect.fail("Should have thrown");
    } catch (e) {
      const error = e as ProtocolIncidentSourceError;
      expect(error.kind).toBe("unavailable");
      expect(mockHttp.getJson).toHaveBeenCalledTimes(2);
    }
  });

  it("throws immediately on non-retryable 404 error without retrying", async () => {
    const mockHttp = createMockHttpClient({ httpStatus: 404 });
    const source = new HttpProtocolIncidentSource({
      http: mockHttp,
      url: "https://api.example.com/incidents",
      maxAttempts: 3
    });

    try {
      await source.collect({ network: "solana-mainnet" });
      expect.fail("Should have thrown");
    } catch (e) {
      const error = e as ProtocolIncidentSourceError;
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
          sourceId: "protocol-incidents-1",
          asOfUnixMs: 1700000000000,
          license: "CC0-1.0",
          retention: "bounded",
          confirmationLevel: "explicit",
          incidents: []
        };
      }),
      postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
    } as unknown as HttpClient;

    const source = new HttpProtocolIncidentSource({
      http: mockHttp,
      url: "https://api.example.com/incidents",
      maxAttempts: 3
    });

    const result = await source.collect({ network: "solana-mainnet" });

    expect(result.providerId).toBe("test-provider");
    expect(mockHttp.getJson).toHaveBeenCalledTimes(3);
  });
});

describe("ProtocolIncidentSourcePort interface", () => {
  it("can be used with a fake implementation for testing", async () => {
    const mockHttp = createMockHttpClient({
      body: {
        providerId: "test-provider",
        providerRunId: "run-123",
        sourceId: "protocol-incidents-1",
        asOfUnixMs: 1700000000000,
        license: "CC0-1.0",
        retention: "bounded",
        confirmationLevel: "explicit",
        incidents: []
      }
    });

    const httpSource = new HttpProtocolIncidentSource({
      http: mockHttp,
      url: "https://api.example.com/incidents"
    });

    const port: ProtocolIncidentSourcePort = httpSource;

    const result = await port.collect({ network: "solana-mainnet" });

    expect(result.providerId).toBe("test-provider");
  });
});
