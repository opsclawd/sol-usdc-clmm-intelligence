import { describe, expect, it, vi } from "vitest";
import { FetchHttpClient } from "../../../src/adapters/node/fetch-http.js";
import { HttpRequestError } from "../../../src/ports/http.js";

describe("FetchHttpClient failed-response headers", () => {
  it("preserves cause and explicitly supplied response headers on HttpRequestError", () => {
    const cause = new Error("root cause");
    const error = new HttpRequestError("http_status", "limited", 429, true, {
      cause,
      responseHeaders: { "Retry-After": "12" }
    });

    expect(error.cause).toBe(cause);
    expect(error.responseHeaders).toEqual({ "Retry-After": "12" });
  });

  it("propagates non-2xx response headers on HttpRequestError", async () => {
    const fetchFn = vi.fn(async () =>
      Promise.resolve(
        new Response('{"success":false}', {
          status: 429,
          statusText: "Too Many Requests",
          headers: {
            "Retry-After": "12",
            "X-RateLimit-Reset": "1785280012"
          }
        })
      )
    );
    const client = new FetchHttpClient(fetchFn);

    const thrown = await client
      .getJson("https://example.test/data", { maxAttempts: 1 })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(HttpRequestError);
    expect((thrown as HttpRequestError).responseHeaders).toMatchObject({
      "retry-after": "12",
      "x-ratelimit-reset": "1785280012"
    });
  });
});
