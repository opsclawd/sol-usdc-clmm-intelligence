import type { HttpClient, HttpRequestOptions } from "../../src/ports/http.js";

export interface FakeHttpResponse {
  body?: unknown;
  error?: Error;
  promise?: Promise<unknown>;
}

export class FakeHttp implements HttpClient {
  readonly calls: Array<{ url: string; options?: HttpRequestOptions }> = [];
  private readonly responses = new Map<string, FakeHttpResponse>();

  setResponse(url: string, response: FakeHttpResponse): void {
    this.responses.set(url, response);
  }

  async getJson<T>(url: string, options?: HttpRequestOptions): Promise<T> {
    this.calls.push({ url, options: options ?? {} });
    const response = this.responses.get(url);
    if (!response) throw new Error(`FakeHttp: no response configured for ${url}`);
    if (response.promise) {
      await response.promise;
    }
    if (response.error) throw response.error;
    return response.body as T;
  }
}
