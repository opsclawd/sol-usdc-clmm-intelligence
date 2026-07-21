import type {
  HttpClient,
  HttpRequestOptions,
  HttpFailureKind,
  HttpResponse
} from "../../ports/http.js";
import { HttpRequestError } from "../../ports/http.js";

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_ATTEMPTS = 2;
const MAX_BODY_BYTES = 10_240;

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

function classifyError(
  e: unknown,
  response: Response | null,
  responseOk: boolean
): { kind: HttpFailureKind; retryable: boolean } {
  if (e instanceof DOMException && e.name === "AbortError") {
    return { kind: "timeout", retryable: true };
  }
  if (e instanceof TypeError && (e.message.includes("network") || e.message.includes("fetch"))) {
    return { kind: "network", retryable: true };
  }
  if (e instanceof SyntaxError) {
    return { kind: "invalid_json", retryable: false };
  }
  if (!responseOk && response !== null) {
    return { kind: "http_status", retryable: isRetryableStatus(response.status) };
  }
  return { kind: "http_status", retryable: false };
}

export class FetchHttpClient implements HttpClient {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async getJson<T>(url: string, options?: HttpRequestOptions): Promise<T> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response | null = null;
      let responseOk = false;
      try {
        const fetchOptions: RequestInit = { signal: controller.signal };
        if (options?.headers) {
          fetchOptions.headers = options.headers;
        }
        response = await this.fetchFn(url, fetchOptions);
        responseOk = response.ok;

        if (!response.ok) {
          const { kind, retryable } = classifyError(null, response, false);
          const bodyText = await response.text().catch(() => "");
          const redactedBody = bodyText.length > 100 ? bodyText.slice(0, 100) + "..." : bodyText;
          throw new HttpRequestError(
            kind,
            `GET ${url} failed: ${response.status} ${response.statusText} ${redactedBody}`,
            response.status,
            retryable
          );
        }

        const text = await response.text();
        return JSON.parse(text) as T;
      } catch (e) {
        if (e instanceof HttpRequestError) {
          if (!e.retryable || attempt >= maxAttempts - 1) {
            throw e;
          }
          lastError = e;
        } else {
          const { kind, retryable } = classifyError(e, response, responseOk);
          if (!retryable || attempt >= maxAttempts - 1) {
            throw new HttpRequestError(
              kind,
              `GET ${url} failed: ${e instanceof Error ? e.message : String(e)}`,
              response?.status ?? null,
              retryable
            );
          }
          lastError = e instanceof Error ? e : new Error(String(e));
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw (
      lastError ??
      new HttpRequestError("network", `GET ${url} failed after ${maxAttempts} attempts`, null, true)
    );
  }

  async postJsonRaw<T = unknown>(
    url: string,
    body: unknown,
    options?: HttpRequestOptions
  ): Promise<HttpResponse<T>> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response | null = null;
    try {
      const fetchOptions: RequestInit = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(options?.headers ?? {})
        },
        body: JSON.stringify(body),
        signal: controller.signal
      };

      response = await this.fetchFn(url, fetchOptions);

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      let responseBody: T;
      let bodyText = "";

      try {
        const reader = response.body?.getReader();
        if (reader) {
          let totalBytes = 0;
          const chunks: Uint8Array[] = [];

          let finished = false;
          while (!finished) {
            const { done: isDone, value } = await reader.read();
            if (isDone) {
              finished = true;
              break;
            }

            totalBytes += value.length;
            if (totalBytes > MAX_BODY_BYTES) {
              await reader.cancel();
              const excessBytes = totalBytes - MAX_BODY_BYTES;
              const allowedChunks = chunks.slice(0, -1);
              const lastChunk = chunks[chunks.length - 1];
              if (lastChunk) {
                const trimEnd = lastChunk.length - excessBytes;
                allowedChunks.push(lastChunk.slice(0, Math.max(0, trimEnd)));
              }
              const combined = new Uint8Array(allowedChunks.reduce((sum, c) => sum + c.length, 0));
              let offset = 0;
              for (const chunk of allowedChunks) {
                combined.set(chunk, offset);
                offset += chunk.length;
              }
              bodyText = new TextDecoder("utf-8", { fatal: false }).decode(combined);
              break;
            }
            chunks.push(value);
          }

          if (totalBytes <= MAX_BODY_BYTES) {
            const combined = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
            let offset = 0;
            for (const chunk of chunks) {
              combined.set(chunk, offset);
              offset += chunk.length;
            }
            bodyText = new TextDecoder("utf-8", { fatal: false }).decode(combined);
          }
        } else {
          bodyText = await response.text();
          if (bodyText.length > MAX_BODY_BYTES) {
            bodyText = bodyText.slice(0, MAX_BODY_BYTES);
          }
        }

        try {
          responseBody = JSON.parse(bodyText) as T;
        } catch {
          responseBody = bodyText as unknown as T;
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          throw new HttpRequestError("timeout", `POST ${url} timed out`, null, true);
        }
        if (
          e instanceof TypeError &&
          (e.message.includes("network") || e.message.includes("fetch"))
        ) {
          throw new HttpRequestError(
            "network",
            `POST ${url} network error: ${e.message}`,
            null,
            true
          );
        }
        throw new HttpRequestError(
          "network",
          `POST ${url} body read error: ${e instanceof Error ? e.message : String(e)}`,
          response.status,
          true
        );
      }

      return {
        status: response.status,
        ok: response.ok,
        body: responseBody,
        headers
      };
    } catch (e) {
      if (e instanceof HttpRequestError) {
        throw e;
      }
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new HttpRequestError("timeout", `POST ${url} timed out`, null, true);
      }
      if (
        e instanceof TypeError &&
        (e.message.includes("network") || e.message.includes("fetch"))
      ) {
        throw new HttpRequestError(
          "network",
          `POST ${url} network error: ${e.message}`,
          null,
          true
        );
      }
      throw new HttpRequestError(
        "network",
        `POST ${url} failed: ${e instanceof Error ? e.message : String(e)}`,
        response?.status ?? null,
        true
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
