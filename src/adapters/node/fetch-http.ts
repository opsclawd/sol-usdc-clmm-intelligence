import type { HttpClient, HttpRequestOptions, HttpFailureKind } from "../../ports/http.js";
import { HttpRequestError } from "../../ports/http.js";

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_ATTEMPTS = 2;

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
}
