import type { HttpClient } from '../../src/ports/http.js';

export interface FakeHttpResponse {
  body?: unknown;
  error?: Error;
}

export class FakeHttp implements HttpClient {
  readonly calls: Array<{ url: string; headers?: Record<string, string> }> = [];
  private readonly responses = new Map<string, FakeHttpResponse>();

  setResponse(url: string, response: FakeHttpResponse): void {
    this.responses.set(url, response);
  }

  async getJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
    this.calls.push({ url, ...(headers ? { headers } : {}) });
    const response = this.responses.get(url);
    if (!response) throw new Error(`FakeHttp: no response configured for ${url}`);
    if (response.error) throw response.error;
    return response.body as T;
  }
}