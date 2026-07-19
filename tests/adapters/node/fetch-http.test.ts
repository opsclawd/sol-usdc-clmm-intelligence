import { describe, expect, it, vi } from "vitest";
import { FetchHttpClient } from "../../../src/adapters/node/fetch-http.js";

type FetchFn = typeof fetch;

function createMockFetch(behavior: {
  shouldTimeout?: boolean;
  httpStatus?: number;
  body?: unknown;
  networkError?: boolean;
  invalidJson?: boolean;
}) {
  return vi.fn().mockImplementation(async (): Promise<Response> => {
    if (behavior.networkError) {
      throw new TypeError("network error");
    }

    if (behavior.shouldTimeout) {
      throw new DOMException("Aborted", "AbortError");
    }

    const bodyStr = JSON.stringify(behavior.body);

    return {
      ok:
        behavior.httpStatus !== undefined &&
        behavior.httpStatus >= 200 &&
        behavior.httpStatus < 300,
      status: behavior.httpStatus ?? 200,
      statusText: behavior.httpStatus ? `${behavior.httpStatus}` : "OK",
      json: async (): Promise<unknown> => {
        if (behavior.invalidJson) {
          throw new SyntaxError("Unexpected end of JSON input");
        }
        return behavior.body;
      },
      text: async (): Promise<string> => {
        if (behavior.invalidJson) {
          throw new SyntaxError("Unexpected end of JSON input");
        }
        return bodyStr;
      }
    } as unknown as Response;
  }) as FetchFn;
}

describe("FetchHttpClient", () => {
  describe("retry behavior", () => {
    it("retries timeout and retryable failures at most once before succeeding or throwing", async () => {
      const callCount = { value: 0 };
      const mockFetch = vi.fn().mockImplementation(async (): Promise<Response> => {
        callCount.value++;
        if (callCount.value === 1) {
          throw new DOMException("Aborted", "AbortError");
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ success: true }),
          text: async () => '{"success":true}'
        } as unknown as Response;
      });

      const client = new FetchHttpClient(mockFetch);
      const result = await client.getJson("http://example.com/data");

      expect(callCount.value).toBe(2);
      expect(result).toEqual({ success: true });
    });

    it("does not retry non-retryable HTTP failures or invalid JSON", async () => {
      const callCount = { value: 0 };
      const mockFetch = vi.fn().mockImplementation(async (): Promise<Response> => {
        callCount.value++;
        return {
          ok: false,
          status: 400,
          statusText: "Bad Request",
          json: async () => {
            throw new SyntaxError("Unexpected end of JSON input");
          },
          text: async () => '{"error":"bad request"}'
        } as unknown as Response;
      });

      const client = new FetchHttpClient(mockFetch);

      await expect(client.getJson("http://example.com/data")).rejects.toThrow();
      expect(callCount.value).toBe(1);
    });

    it("retries 408 request timeout", async () => {
      const callCount = { value: 0 };
      const mockFetch = vi.fn().mockImplementation(async (): Promise<Response> => {
        callCount.value++;
        if (callCount.value === 1) {
          return {
            ok: false,
            status: 408,
            statusText: "Request Timeout",
            json: async () => ({}),
            text: async () => "Request Timeout"
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ success: true }),
          text: async () => '{"success":true}'
        } as unknown as Response;
      });

      const client = new FetchHttpClient(mockFetch);
      const result = await client.getJson("http://example.com/data");

      expect(callCount.value).toBe(2);
      expect(result).toEqual({ success: true });
    });

    it("retries 429 too many requests", async () => {
      const callCount = { value: 0 };
      const mockFetch = vi.fn().mockImplementation(async (): Promise<Response> => {
        callCount.value++;
        if (callCount.value === 1) {
          return {
            ok: false,
            status: 429,
            statusText: "Too Many Requests",
            json: async () => ({}),
            text: async () => "Rate Limited"
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ success: true }),
          text: async () => '{"success":true}'
        } as unknown as Response;
      });

      const client = new FetchHttpClient(mockFetch);
      const result = await client.getJson("http://example.com/data");

      expect(callCount.value).toBe(2);
      expect(result).toEqual({ success: true });
    });

    it("retries 5xx server errors", async () => {
      const callCount = { value: 0 };
      const mockFetch = vi.fn().mockImplementation(async (): Promise<Response> => {
        callCount.value++;
        if (callCount.value === 1) {
          return {
            ok: false,
            status: 503,
            statusText: "Service Unavailable",
            json: async () => ({}),
            text: async () => "Service Unavailable"
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ success: true }),
          text: async () => '{"success":true}'
        } as unknown as Response;
      });

      const client = new FetchHttpClient(mockFetch);
      const result = await client.getJson("http://example.com/data");

      expect(callCount.value).toBe(2);
      expect(result).toEqual({ success: true });
    });

    it("retries on network error", async () => {
      const callCount = { value: 0 };
      const mockFetch = vi.fn().mockImplementation(async (): Promise<Response> => {
        callCount.value++;
        if (callCount.value === 1) {
          throw new TypeError("network error");
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ success: true }),
          text: async () => '{"success":true}'
        } as unknown as Response;
      });

      const client = new FetchHttpClient(mockFetch);
      const result = await client.getJson("http://example.com/data");

      expect(callCount.value).toBe(2);
      expect(result).toEqual({ success: true });
    });

    it("creates a new AbortController signal for each attempt", async () => {
      const signals: AbortSignal[] = [];
      const callCount = { value: 0 };

      const mockFetch = vi
        .fn()
        .mockImplementation(async (url: string, options?: RequestInit): Promise<Response> => {
          callCount.value++;
          if (options?.signal) {
            signals.push(options.signal as AbortSignal);
          }
          if (callCount.value === 1) {
            throw new DOMException("Aborted", "AbortError");
          }
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => ({ success: true }),
            text: async () => '{"success":true}'
          } as unknown as Response;
        });

      const client = new FetchHttpClient(mockFetch);
      await client.getJson("http://example.com/data");

      expect(signals.length).toBe(2);
      expect(signals[0]).not.toBe(signals[1]);
    });

    it("truncates and redacts response body in error summaries", async () => {
      const longBody = "x".repeat(1000);
      const mockFetch = createMockFetch({
        httpStatus: 500,
        body: { error: longBody }
      });

      const client = new FetchHttpClient(mockFetch);

      await expect(client.getJson("http://example.com/data")).rejects.toThrow();
      try {
        await client.getJson("http://example.com/data");
      } catch (e) {
        const err = e as Error;
        expect(err.message).not.toContain(longBody);
      }
    });

    it("default single-attempt compatibility (no options)", async () => {
      const mockFetch = createMockFetch({
        httpStatus: 200,
        body: { data: "test" }
      });

      const client = new FetchHttpClient(mockFetch);
      const result = await client.getJson("http://example.com/data");

      expect(result).toEqual({ data: "test" });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("respects maxAttempts option", async () => {
      const mockFetch = createMockFetch({
        shouldTimeout: true
      });

      const client = new FetchHttpClient(mockFetch);

      await expect(client.getJson("http://example.com/data", { maxAttempts: 3 })).rejects.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("does not retry 404 not found", async () => {
      const callCount = { value: 0 };
      const mockFetch = vi.fn().mockImplementation(async (): Promise<Response> => {
        callCount.value++;
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: async () => ({}),
          text: async () => "Not Found"
        } as unknown as Response;
      });

      const client = new FetchHttpClient(mockFetch);

      await expect(client.getJson("http://example.com/data")).rejects.toThrow();
      expect(callCount.value).toBe(1);
    });

    it("does not retry 401 unauthorized", async () => {
      const callCount = { value: 0 };
      const mockFetch = vi.fn().mockImplementation(async (): Promise<Response> => {
        callCount.value++;
        return {
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          json: async () => ({}),
          text: async () => "Unauthorized"
        } as unknown as Response;
      });

      const client = new FetchHttpClient(mockFetch);

      await expect(client.getJson("http://example.com/data")).rejects.toThrow();
      expect(callCount.value).toBe(1);
    });
  });

  describe("HttpRequestError", () => {
    it("throws HttpRequestError with correct kind for timeout", async () => {
      const mockFetch = createMockFetch({ shouldTimeout: true });

      const client = new FetchHttpClient(mockFetch);

      await expect(client.getJson("http://example.com/data")).rejects.toMatchObject({
        kind: "timeout",
        retryable: true
      });
    });

    it("throws HttpRequestError with correct kind for network error", async () => {
      const mockFetch = createMockFetch({ networkError: true });

      const client = new FetchHttpClient(mockFetch);

      await expect(client.getJson("http://example.com/data")).rejects.toMatchObject({
        kind: "network",
        retryable: true
      });
    });

    it("throws HttpRequestError with correct kind for HTTP error", async () => {
      const mockFetch = createMockFetch({ httpStatus: 500 });

      const client = new FetchHttpClient(mockFetch);

      await expect(client.getJson("http://example.com/data")).rejects.toMatchObject({
        kind: "http_status",
        retryable: true,
        status: 500
      });
    });

    it("throws HttpRequestError with correct kind for invalid JSON", async () => {
      const mockFetch = createMockFetch({ invalidJson: true, httpStatus: 200 });

      const client = new FetchHttpClient(mockFetch);

      await expect(client.getJson("http://example.com/data")).rejects.toMatchObject({
        kind: "invalid_json",
        retryable: false
      });
    });
  });
});
