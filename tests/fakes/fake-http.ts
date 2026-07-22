import type { HttpClient, HttpRequestOptions, HttpResponse } from "../../src/ports/http.js";

export interface FakeHttpResponse {
  body?: unknown;
  error?: Error;
  promise?: Promise<unknown>;
}

export interface FakeHttpPostCall {
  url: string;
  body: unknown;
  options?: HttpRequestOptions;
}

export class FakeHttp implements HttpClient {
  readonly calls: Array<{ url: string; options?: HttpRequestOptions }> = [];
  readonly postCalls: FakeHttpPostCall[] = [];
  private readonly responses = new Map<string, FakeHttpResponse>();
  private readonly postResponses = new Map<string, FakeHttpResponse>();

  setResponse(url: string, response: FakeHttpResponse): void {
    this.responses.set(url, response);
  }

  setPostResponse(url: string, response: FakeHttpResponse): void {
    this.postResponses.set(url, response);
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

  async postJsonRaw<T = unknown>(
    url: string,
    body: unknown,
    options?: HttpRequestOptions
  ): Promise<HttpResponse<T>> {
    this.postCalls.push({ url, body, options: options ?? {} });
    const response = this.postResponses.get(url);
    if (!response) throw new Error(`FakeHttp: no POST response configured for ${url}`);
    if (response.promise) {
      await response.promise;
    }
    if (response.error) throw response.error;
    const resp = response.body as HttpResponse<T>;
    return resp;
  }
}
