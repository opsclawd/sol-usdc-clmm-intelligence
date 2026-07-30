import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../../../src/ports/http.js";
import { HttpRequestError } from "../../../src/ports/http.js";
import type {
  ProtocolIncidentSourcePort,
  ProtocolIncidentSourceError
} from "../../../src/ports/protocol-incident-source.js";
import { HttpProtocolIncidentSource } from "../../../src/adapters/node/http-protocol-incident-source.js";
import { FakeClock, FakeRunIdFactory } from "../../fakes/index.js";

function makeStatuspageResponse(
  incidents: readonly Record<string, unknown>[] = [
    {
      id: "n5kcgs8dl9pj",
      name: "mb-020624",
      status: "resolved",
      impact: "critical",
      started_at: "2024-02-06T10:22:42.049Z",
      resolved_at: "2024-02-06T15:09:24.842Z",
      shortlink: "https://stspg.io/g277l7fp0gw3",
      incident_updates: [{ body: "Recovery complete", created_at: "2024-02-06T15:09:24.842Z" }]
    }
  ]
): Record<string, unknown> {
  return {
    page: { id: "solana", name: "Solana Status" },
    incidents
  };
}

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
  describe("solana-statuspage-mapping", () => {
    it("builds the full-history endpoint and maps a real Statuspage incident", async () => {
      const mockHttp = createMockHttpClient({
        body: makeStatuspageResponse()
      });

      const source = new HttpProtocolIncidentSource({
        http: mockHttp,
        url: "https://api.example.com/incidents/",
        apiKey: "secret-key-12345",
        timeoutMs: 5000,
        maxAttempts: 2
      });

      const result = await source.collect({ network: "solana-mainnet" });

      expect(result).toEqual({
        providerId: "solana-status-api",
        providerRunId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        ),
        sourceId: "solana-status-incidents",
        network: "solana-mainnet",
        asOfUnixMs: 1707232164842,
        license: "MIT",
        retention: "bounded",
        confirmationLevel: "explicit",
        incidents: [
          {
            incidentId: "n5kcgs8dl9pj",
            incidentType: "mb-020624",
            severity: "CRITICAL",
            sourceReferences: ["https://stspg.io/g277l7fp0gw3"]
          }
        ]
      });

      expect(mockHttp.getJson).toHaveBeenCalledWith(
        "https://api.example.com/incidents/api/v2/incidents.json",
        expect.objectContaining({
          timeoutMs: 5000,
          maxAttempts: 1,
          headers: expect.objectContaining({
            Authorization: "Bearer secret-key-12345"
          })
        })
      );
    });

    it("uses injected clock and runIdFactory ports", async () => {
      const mockHttp = createMockHttpClient({
        body: { incidents: [] }
      });
      const clock = new FakeClock("2024-05-01T12:00:00.000Z");
      const runIdFactory = new FakeRunIdFactory(["custom-run-id-123"]);

      const source = new HttpProtocolIncidentSource({
        http: mockHttp,
        url: "https://status.solana.com",
        clock,
        runIdFactory
      });

      const result = await source.collect({ network: "solana-mainnet" });

      expect(result.providerRunId).toBe("custom-run-id-123");
      expect(result.asOfUnixMs).toBe(Date.parse("2024-05-01T12:00:00.000Z"));
    });

    it("derives asOfUnixMs deterministically from payload timestamps across multiple calls", async () => {
      const mockHttp = createMockHttpClient({
        body: makeStatuspageResponse([
          {
            id: "inc-1",
            name: "Degraded Performance",
            impact: "minor",
            started_at: "2024-03-15T08:00:00.000Z",
            updated_at: "2024-03-15T09:30:00.000Z",
            shortlink: "https://stspg.io/inc-1"
          }
        ])
      });

      const source = new HttpProtocolIncidentSource({
        http: mockHttp,
        url: "https://status.solana.com"
      });

      const res1 = await source.collect({ network: "solana-mainnet" });
      const res2 = await source.collect({ network: "solana-mainnet" });

      expect(res1.asOfUnixMs).toBe(Date.parse("2024-03-15T09:30:00.000Z"));
      expect(res2.asOfUnixMs).toBe(Date.parse("2024-03-15T09:30:00.000Z"));
      expect(res1.asOfUnixMs).toBe(res2.asOfUnixMs);
    });

    it("does not duplicate path if url already ends with /api/v2/incidents.json", async () => {
      const mockHttp = createMockHttpClient({
        body: makeStatuspageResponse([])
      });

      const source = new HttpProtocolIncidentSource({
        http: mockHttp,
        url: "https://status.solana.com/api/v2/incidents.json"
      });

      await source.collect({ network: "solana-mainnet" });

      expect(mockHttp.getJson).toHaveBeenCalledWith(
        "https://status.solana.com/api/v2/incidents.json",
        expect.anything()
      );
    });

    it("normalizes every supported Statuspage impact to the internal severity enum", async () => {
      const mockHttp = createMockHttpClient({
        body: makeStatuspageResponse([
          { id: "1", name: "inc1", impact: "critical", shortlink: "https://stspg.io/1" },
          { id: "2", name: "inc2", impact: "major", shortlink: "https://stspg.io/2" },
          { id: "3", name: "inc3", impact: "minor", shortlink: "https://stspg.io/3" },
          { id: "4", name: "inc4", impact: "none", shortlink: "https://stspg.io/4" }
        ])
      });

      const source = new HttpProtocolIncidentSource({
        http: mockHttp,
        url: "https://api.example.com/incidents"
      });

      const result = await source.collect({ network: "solana-mainnet" });

      expect(result.incidents).toEqual([
        {
          incidentId: "1",
          incidentType: "inc1",
          severity: "CRITICAL",
          sourceReferences: ["https://stspg.io/1"]
        },
        {
          incidentId: "2",
          incidentType: "inc2",
          severity: "HIGH",
          sourceReferences: ["https://stspg.io/2"]
        },
        {
          incidentId: "3",
          incidentType: "inc3",
          severity: "MEDIUM",
          sourceReferences: ["https://stspg.io/3"]
        },
        {
          incidentId: "4",
          incidentType: "inc4",
          severity: "LOW",
          sourceReferences: ["https://stspg.io/4"]
        }
      ]);
    });

    it("constructs a bounded internal envelope and drops unknown vendor fields", async () => {
      const mockHttp = createMockHttpClient({
        body: {
          page: { id: "solana", name: "Solana Status" },
          unknownTopLevelField: "should be dropped",
          unknownArray: [1, 2, 3],
          incidents: [
            {
              id: "n5kcgs8dl9pj",
              name: "mb-020624",
              status: "resolved",
              impact: "critical",
              started_at: "2024-02-06T10:22:42.049Z",
              resolved_at: "2024-02-06T15:09:24.842Z",
              shortlink: "https://stspg.io/g277l7fp0gw3",
              incident_updates: [{ body: "Recovery complete" }],
              unknownField: "should be dropped"
            }
          ]
        }
      });

      const source = new HttpProtocolIncidentSource({
        http: mockHttp,
        url: "https://api.example.com/incidents"
      });

      const result = await source.collect({ network: "solana-mainnet" });

      expect(result).not.toHaveProperty("page");
      expect(result).not.toHaveProperty("unknownTopLevelField");
      expect(result).not.toHaveProperty("unknownArray");
      expect(result.incidents[0]).toEqual({
        incidentId: "n5kcgs8dl9pj",
        incidentType: "mb-020624",
        severity: "CRITICAL",
        sourceReferences: ["https://stspg.io/g277l7fp0gw3"]
      });
      expect(result.incidents[0] as unknown as Record<string, unknown>).not.toHaveProperty(
        "status"
      );
      expect(result.incidents[0] as unknown as Record<string, unknown>).not.toHaveProperty(
        "unknownField"
      );
    });

    it("generates a distinct provider run id for each successful collect call", async () => {
      const mockHttp = createMockHttpClient({
        body: makeStatuspageResponse()
      });

      const source = new HttpProtocolIncidentSource({
        http: mockHttp,
        url: "https://api.example.com/incidents"
      });

      const res1 = await source.collect({ network: "solana-mainnet" });
      const res2 = await source.collect({ network: "solana-mainnet" });

      expect(res1.providerRunId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      expect(res2.providerRunId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      expect(res1.providerRunId).not.toBe(res2.providerRunId);
    });

    it("accepts an empty incidents array", async () => {
      const mockHttp = createMockHttpClient({
        body: makeStatuspageResponse([])
      });

      const source = new HttpProtocolIncidentSource({
        http: mockHttp,
        url: "https://api.example.com/incidents"
      });

      const result = await source.collect({ network: "solana-mainnet" });
      expect(result.incidents).toEqual([]);
    });

    it("rejects a response without an incidents array as malformed", async () => {
      const mockHttp = createMockHttpClient({
        body: { page: { id: "solana" } }
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
      }
    });

    it("rejects malformed incident id name impact or shortlink fields as malformed", async () => {
      const testCases = [
        [{ name: "inc", impact: "critical", shortlink: "https://stspg.io/1" }],
        [{ id: "", name: "inc", impact: "critical", shortlink: "https://stspg.io/1" }],
        [{ id: 123, name: "inc", impact: "critical", shortlink: "https://stspg.io/1" }],
        [{ id: "1", impact: "critical", shortlink: "https://stspg.io/1" }],
        [{ id: "1", name: "", impact: "critical", shortlink: "https://stspg.io/1" }],
        [{ id: "1", name: "inc", shortlink: "https://stspg.io/1" }],
        [{ id: "1", name: "inc", impact: "critical" }],
        [{ id: "1", name: "inc", impact: "critical", shortlink: "" }]
      ];

      for (const incidents of testCases) {
        const mockHttp = createMockHttpClient({
          body: makeStatuspageResponse(incidents as unknown as readonly Record<string, unknown>[])
        });

        const source = new HttpProtocolIncidentSource({
          http: mockHttp,
          url: "https://api.example.com/incidents"
        });

        try {
          await source.collect({ network: "solana-mainnet" });
          expect.fail("Should have thrown for malformed incident fields");
        } catch (e) {
          const error = e as ProtocolIncidentSourceError;
          expect(error.kind).toBe("malformed");
        }
      }
    });

    it("rejects an unknown Statuspage impact as malformed", async () => {
      const mockHttp = createMockHttpClient({
        body: makeStatuspageResponse([
          { id: "1", name: "inc", impact: "catastrophic", shortlink: "https://stspg.io/1" }
        ])
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
      }
    });

    it("rejects unsupported networks before issuing HTTP", async () => {
      const mockHttp = createMockHttpClient({
        body: makeStatuspageResponse()
      });

      const source = new HttpProtocolIncidentSource({
        http: mockHttp,
        url: "https://api.example.com/incidents"
      });

      try {
        await source.collect({ network: "ethereum-mainnet" as unknown as "solana-mainnet" });
        expect.fail("Should have thrown");
      } catch (e) {
        const error = e as ProtocolIncidentSourceError;
        expect(error.kind).toBe("malformed");
        expect(mockHttp.getJson).toHaveBeenCalledTimes(0);
      }
    });
  });

  describe("solana-mainnet-request", () => {
    it("fetches protocol incidents for solana-mainnet with optional bearer credential", async () => {
      const mockHttp = createMockHttpClient({
        body: makeStatuspageResponse()
      });

      const source = new HttpProtocolIncidentSource({
        http: mockHttp,
        url: "https://api.example.com/incidents",
        apiKey: "secret-key-12345",
        timeoutMs: 5000,
        maxAttempts: 2
      });

      const result = await source.collect({ network: "solana-mainnet" });

      expect(result.providerId).toBe("solana-status-api");
      expect(result.network).toBe("solana-mainnet");
      expect(mockHttp.getJson).toHaveBeenCalledTimes(1);
      expect(mockHttp.getJson).toHaveBeenCalledWith(
        "https://api.example.com/incidents/api/v2/incidents.json",
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
        body: makeStatuspageResponse([])
      });

      const source = new HttpProtocolIncidentSource({
        http: mockHttp,
        url: "https://api.example.com/incidents",
        timeoutMs: 5000,
        maxAttempts: 2
      });

      await source.collect({ network: "solana-mainnet" });

      expect(mockHttp.getJson).toHaveBeenCalledWith(
        "https://api.example.com/incidents/api/v2/incidents.json",
        expect.objectContaining({
          headers: expect.not.objectContaining({
            Authorization: expect.anything()
          })
        })
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
        body: { page: { id: "solana" }, incidents: "invalid" }
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

  describe("retry-loop", () => {
    it("retries a retryable source failure once without nested HTTP retries", async () => {
      let callCount = 0;
      const mockHttp = {
        getJson: vi.fn().mockImplementation(async (): Promise<unknown> => {
          callCount++;
          if (callCount === 1) {
            throw new TypeError("transient network error");
          }
          return makeStatuspageResponse([]);
        }),
        postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
      } as unknown as HttpClient;

      const source = new HttpProtocolIncidentSource({
        http: mockHttp,
        url: "https://api.example.com/incidents",
        maxAttempts: 2
      });

      const result = await source.collect({ network: "solana-mainnet" });

      expect(result.providerId).toBe("solana-status-api");
      expect(mockHttp.getJson).toHaveBeenCalledTimes(2);
      expect(mockHttp.getJson).toHaveBeenCalledWith(
        "https://api.example.com/incidents/api/v2/incidents.json",
        expect.objectContaining({
          maxAttempts: 1
        })
      );
    });

    it("does not retry malformed or non-retryable responses", async () => {
      const malformedHttp = createMockHttpClient({
        body: { page: { id: "solana" }, incidents: "invalid" }
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
          return makeStatuspageResponse([]);
        }),
        postJsonRaw: vi.fn().mockRejectedValue(new Error("Not implemented"))
      } as unknown as HttpClient;

      const source = new HttpProtocolIncidentSource({
        http: mockHttp,
        url: "https://api.example.com/incidents",
        maxAttempts: 3
      });

      const result = await source.collect({ network: "solana-mainnet" });

      expect(result.providerId).toBe("solana-status-api");
      expect(mockHttp.getJson).toHaveBeenCalledTimes(3);
    });
  });

  describe("ProtocolIncidentSourcePort interface", () => {
    it("can be used with a fake implementation for testing", async () => {
      const mockHttp = createMockHttpClient({
        body: makeStatuspageResponse()
      });

      const httpSource = new HttpProtocolIncidentSource({
        http: mockHttp,
        url: "https://api.example.com/incidents"
      });

      const port: ProtocolIncidentSourcePort = httpSource;

      const result = await port.collect({ network: "solana-mainnet" });

      expect(result.providerId).toBe("solana-status-api");
    });
  });
});
