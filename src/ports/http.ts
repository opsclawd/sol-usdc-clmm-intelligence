export interface HttpRequestOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
}

export type HttpFailureKind = "timeout" | "network" | "http_status" | "invalid_json";

export class HttpRequestError extends Error {
  constructor(
    readonly kind: HttpFailureKind,
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "HttpRequestError";
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
