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

export interface HttpClient {
  getJson<T>(url: string, options?: HttpRequestOptions): Promise<T>;
}
