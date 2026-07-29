export interface HttpRequestOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
}

export type HttpFailureKind = "timeout" | "network" | "http_status" | "invalid_json";

export interface HttpRequestErrorOptions extends ErrorOptions {
  readonly responseHeaders?: Readonly<Record<string, string>>;
}

export class HttpRequestError extends Error {
  readonly responseHeaders?: Readonly<Record<string, string>>;

  constructor(
    readonly kind: HttpFailureKind,
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    options?: HttpRequestErrorOptions
  ) {
    super(message, options);
    this.name = "HttpRequestError";
    if (options?.responseHeaders) {
      this.responseHeaders = options.responseHeaders;
    }
  }
}

export interface HttpResponse<T = unknown> {
  readonly status: number;
  readonly ok: boolean;
  readonly body: T;
  readonly headers: Readonly<Record<string, string>>;
}

export interface HttpClient {
  getJson<T>(url: string, options?: HttpRequestOptions): Promise<T>;
  postJsonRaw<T = unknown>(
    url: string,
    body: unknown,
    options?: HttpRequestOptions
  ): Promise<HttpResponse<T>>;
}
